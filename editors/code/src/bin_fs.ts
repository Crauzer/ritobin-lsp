import * as vscode from "vscode";

import type { Ctx } from "./ctx";
import { reportError, tryStat } from "./ide_utils";
import * as ra from "./lsp_ext";

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
  return virtual.with({
    scheme: "file",
    path: virtual.path.slice(0, -VIRTUAL_SUFFIX.length),
  });
}

/**
 * Marks virtual deserialized documents in the UI (tab badge + tinted label,
 * and in quick-open) so users can tell them apart from real .rito files on
 * disk.
 */
export class RitobinBinDecorationProvider
  implements vscode.FileDecorationProvider
{
  provideFileDecoration(
    uri: vscode.Uri,
  ): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme !== BIN_SCHEME) {
      return undefined;
    }

    return new vscode.FileDecoration(
      "⇄",
      "Deserialized League .bin - saving converts it back into the binary",
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
 * FileSystemProvider that exposes League `.bin` files as editable ritobin
 * text. Reads deserialize via the `ritobin-lsp/deserializeBin` request; saves
 * convert back to the binary via `ritobin-lsp/serializeBin`.
 *
 * External modification of the `.bin` while its virtual document is open is
 * not detected (`watch` is a no-op) - the text goes stale until reopen.
 */
export class RitobinBinFs implements vscode.FileSystemProvider {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly emitter = new vscode.EventEmitter<
    vscode.FileChangeEvent[]
  >();
  readonly onDidChangeFile = this.emitter.event;

  constructor(private readonly ctx: Ctx) {}

  /**
   * Evict the cache once the virtual document closes, so reopening
   * re-deserializes and picks up external changes to the `.bin`.
   */
  handleDidCloseTextDocument(doc: vscode.TextDocument) {
    if (doc.uri.scheme === BIN_SCHEME) {
      this.cache.delete(doc.uri.toString());
    }
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
    const entry = await this.ensureLoaded(uri);
    return {
      type: vscode.FileType.File,
      ctime: entry.mtime,
      mtime: entry.mtime,
      size: entry.size,
      // PTCH override bins cannot be written back yet - open them read-only.
      permissions: entry.isOverride
        ? vscode.FilePermission.Readonly
        : undefined,
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
    if (entry.isOverride) {
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
    return new vscode.Disposable(() => {});
  }

  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    throw vscode.FileSystemError.NoPermissions(uri);
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
