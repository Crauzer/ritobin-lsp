import * as vscode from "vscode";

import type { Ctx } from "./ctx";
import { reportError, tryStat } from "./ide_utils";
import * as ra from "./lsp_ext";
import { log } from "./util";

export const BIN_SCHEME = "ritobin-bin";

const VIRTUAL_SUFFIX = ".rito";

/**
 * Maps a real `.bin` file uri to its virtual ritobin-text counterpart.
 * The `.rito` suffix gives the virtual document the "ritobin" languageId via
 * the languages contribution, and makes the tab read e.g. "Aatrox.bin.rito".
 */
export function binToVirtual(bin: vscode.Uri): vscode.Uri {
  return bin.with({ scheme: BIN_SCHEME, path: bin.path + VIRTUAL_SUFFIX });
}

export function virtualToBin(virtual: vscode.Uri): vscode.Uri {
  log.debug({ path: virtual.path });
  return virtual.with({
    scheme: "file",
    path: virtual.path.replace(/\.rito$/, ""),
  });
}

/**
 * Whether `uri` is the virtual ritobin-text document itself, as opposed to an
 * ancestor folder on the real filesystem that VS Code is resolving on the
 * way to it (e.g. while browsing a save dialog).
 */
function isVirtualBinUri(uri: vscode.Uri): boolean {
  return uri.path.endsWith(VIRTUAL_SUFFIX);
}

/**
 * Marks virtual deserialized documents in the UI (tab badge + tinted label,
 * and in quick-open) so users can tell them apart from real .rito files on
 * disk.
 */
export class RitobinBinDecorationProvider
  implements vscode.FileDecorationProvider {
  provideFileDecoration(
    uri: vscode.Uri,
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme !== BIN_SCHEME) {
      return undefined;
    }

    return new vscode.FileDecoration(
      "⇄",
      "Read-only League .bin - save as .rito, or enable write-back to convert changes back into the binary",
      new vscode.ThemeColor("charts.blue"),
    );
  }
}

interface CacheEntry {
  text: string;
  isOverride: boolean;
  mtime: number;
  size: number;
}

/**
 * FileSystemProvider that exposes League `.bin` files as ritobin text. Reads
 * deserialize via the `ritobin-lsp/deserializeBin` request; saves convert back
 * to the binary via `ritobin-lsp/serializeBin`.
 *
 * Bins open read-only by default so casual viewing never risks clobbering the
 * binary. Write-back is opt-in per open document via `enableWriteBack` (see
 * `bin_readonly.ts`) and is forgotten when the document closes - reopening the
 * `.bin` is read-only again.
 *
 * External modification of the `.bin` while its virtual document is open is
 * not detected (`watch` is a no-op) - the text goes stale until reopen.
 */
export class RitobinBinFs implements vscode.FileSystemProvider {
  private readonly cache = new Map<string, CacheEntry>();

  /** Virtual URIs the user has opted into saving back to the `.bin`. */
  private readonly writeBack = new Set<string>();

  private readonly emitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this.emitter.event;

  constructor(private readonly ctx: Ctx) { }

  /**
   * Evict the cache and forget any write-back opt-in once the virtual
   * document closes, so reopening re-deserializes read-only and picks up
   * external changes to the `.bin`.
   */
  handleDidCloseTextDocument(doc: vscode.TextDocument) {
    if (doc.uri.scheme === BIN_SCHEME) {
      this.cache.delete(doc.uri.toString());
      this.writeBack.delete(doc.uri.toString());
    }
  }

  /** Whether `uri` deserialized from a read-only PTCH override bin. */
  isOverride(uri: vscode.Uri): boolean | undefined {
    return this.cache.get(uri.toString())?.isOverride;
  }

  /**
   * Opt `uri` into write-back for the rest of this document's lifetime, then
   * re-stat so VS Code drops the read-only lock on the open editor.
   * No-op for override bins, which can never be written back.
   */
  enableWriteBack(uri: vscode.Uri): void {
    const key = uri.toString();
    if (this.cache.get(key)?.isOverride || this.writeBack.has(key)) {
      return;
    }

    this.writeBack.add(key);
    this.emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  private async ensureLoaded(uri: vscode.Uri): Promise<CacheEntry> {
    const key = uri.toString();
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    const binUri = virtualToBin(uri);
    try {
      const client = await this.ctx.ensureClientReady();
      const res = await client.sendRequest(ra.deserializeBin, {
        binPath: binUri.fsPath,
      });
      const stat = await tryStat(binUri);
      const entry: CacheEntry = {
        text: res.text,
        isOverride: res.isOverride,
        mtime: stat?.mtime ?? Date.now(),
        size: Buffer.byteLength(res.text, "utf8"),
      };
      this.cache.set(key, entry);
      return entry;
    } catch (e) {
      const message = reportError(
        `Failed to open '${binUri.fsPath}' as ritobin`,
        e,
      );
      throw vscode.FileSystemError.Unavailable(message);
    }
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    if (!isVirtualBinUri(uri)) {
      return vscode.workspace.fs.stat(virtualToBin(uri));
    }

    const entry = await this.ensureLoaded(uri);
    // Read-only by default; PTCH override bins can never be written back.
    // Only documents the user explicitly opted into via `enableWriteBack`
    // become writable, and only until they are closed.
    const writable = !entry.isOverride && this.writeBack.has(uri.toString());
    return {
      type: vscode.FileType.File,
      ctime: entry.mtime,
      mtime: entry.mtime,
      size: entry.size,
      permissions: writable ? undefined : vscode.FilePermission.Readonly,
    };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const entry = await this.ensureLoaded(uri);
    return Buffer.from(entry.text, "utf8");
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { readonly create: boolean; readonly overwrite: boolean },
  ): Promise<void> {
    const entry = await this.ensureLoaded(uri);
    // Refuse writes to read-only documents (override bins, or ones the user
    // hasn't opted into write-back for). The editor is read-only in that
    // state, so this is defense-in-depth against programmatic writes.
    if (entry.isOverride || !this.writeBack.has(uri.toString())) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }

    const binUri = virtualToBin(uri);
    const text = Buffer.from(content).toString("utf8");
    try {
      const client = await this.ctx.ensureClientReady();
      await client.sendRequest(ra.serializeBin, {
        binPath: binUri.fsPath,
        text,
      });
    } catch (e) {
      reportError(`Failed to save '${binUri.fsPath}'`, e);
      // Failing the save keeps the document dirty.
      throw vscode.FileSystemError.NoPermissions(uri);
    }

    entry.text = text;
    entry.size = content.byteLength;
    entry.mtime = Date.now();
  }

  watch(_uri: vscode.Uri): vscode.Disposable {
    return new vscode.Disposable(() => { });
  }

  async readDirectory(
    uri: vscode.Uri,
  ): Promise<[string, vscode.FileType][]> {
    if (isVirtualBinUri(uri)) {
      throw vscode.FileSystemError.NoPermissions(uri);
    }

    // An ancestor folder (see `stat`) - mirror the real directory listing so
    // browsing dialogs can walk through it, presenting `.bin` entries under
    // their virtual `.rito` name so they resolve back through this provider.
    const entries = await vscode.workspace.fs.readDirectory(
      virtualToBin(uri),
    );
    return entries.map(
      ([name, type]): [string, vscode.FileType] =>
        type === vscode.FileType.File && name.toLowerCase().endsWith(".bin")
          ? [name + VIRTUAL_SUFFIX, type]
          : [name, type],
    );
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(oldUri: vscode.Uri, _newUri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(oldUri);
  }
}
