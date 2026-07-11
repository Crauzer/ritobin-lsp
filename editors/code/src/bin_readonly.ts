import * as vscode from "vscode";

import { BIN_SCHEME, RitobinBinFs, virtualToBin } from "./bin_fs";
import type { Ctx } from "./ctx";
import { guard, toast } from "./ide_utils";

/**
 * League `.bin` files open as read-only ritobin text by default (see
 * `bin_fs.ts`) so casual viewing never risks clobbering the binary. This
 * module wires the one-time "opened read-only" nudge plus the two escape
 * hatches it advertises:
 *
 *   - Save as .ritobin  - the encouraged path for continued work: writes the
 *     deserialized text out to a real `.ritobin` file, fully decoupled from
 *     the binary.
 *   - Enable write-back - opt in to serializing this document back into the
 *     `.bin`, for this open document only. Reopening the file is read-only
 *     again.
 */

const SAVE_AS = "Save as .ritobin…";
const WRITE_BACK = "Enable write-back";
const DISMISS = "Don't show again";

export function registerBinReadonlyFlow(ctx: Ctx, binFs: RitobinBinFs): void {
  ctx.pushExtCleanup(
    vscode.commands.registerCommand(
      "ritobin-lsp.enableBinWriteBack",
      guard("Enable .bin write-back", (uri?: vscode.Uri) =>
        enableWriteBack(binFs, resolveBinDoc(uri)),
      ),
    ),
  );
  ctx.pushExtCleanup(
    vscode.commands.registerCommand(
      "ritobin-lsp.saveBinAsRitobin",
      guard("Save .bin as Ritobin", (uri?: vscode.Uri) =>
        saveAsRitobin(resolveBinDoc(uri)),
      ),
    ),
  );

  vscode.workspace.onDidOpenTextDocument(
    (doc) => void maybePromptReadonly(ctx, binFs, doc),
    null,
    ctx.subscriptions,
  );

  // Bins restored on activation (hot-exit) won't fire onDidOpenTextDocument,
  // so prompt for any deserialized bin that is already open.
  for (const doc of vscode.workspace.textDocuments) {
    void maybePromptReadonly(ctx, binFs, doc);
  }
}

/** Resolve the deserialized-bin document a command should act on. */
function resolveBinDoc(uri?: vscode.Uri): vscode.TextDocument | undefined {
  if (uri) {
    return vscode.workspace.textDocuments.find(
      (doc) => doc.uri.toString() === uri.toString(),
    );
  }

  const active = vscode.window.activeTextEditor?.document;
  return active?.uri.scheme === BIN_SCHEME ? active : undefined;
}

async function enableWriteBack(
  binFs: RitobinBinFs,
  doc: vscode.TextDocument | undefined,
): Promise<void> {
  if (!doc) {
    toast.warn("No deserialized .bin is focused.");
    return;
  }
  if (binFs.isOverride(doc.uri)) {
    toast.warn("This is a PTCH override .bin and cannot be written back.");
    return;
  }

  binFs.enableWriteBack(doc.uri);

  // Unlock the current editor immediately. The re-stat fired by
  // `enableWriteBack` handles fresh resolves, but overriding the active
  // editor's session read-only state is what drops the lock on the open view.
  try {
    await vscode.commands.executeCommand(
      "workbench.action.files.setActiveEditorWriteableInSession",
    );
  } catch {
    // Command id may differ across VS Code versions; the re-stat is enough.
  }

  toast.info(
    "Write-back enabled - saving now converts this document back into the .bin.",
  );
}

async function saveAsRitobin(
  doc: vscode.TextDocument | undefined,
): Promise<void> {
  if (!doc) {
    toast.warn("No deserialized .bin is focused.");
    return;
  }

  const binUri = virtualToBin(doc.uri);
  const defaultUri = binUri.with({
    path: binUri.path.replace(/\.bin$/i, "") + ".ritobin",
  });
  const target = await vscode.window.showSaveDialog({
    title: "Save as Ritobin",
    defaultUri,
    filters: { Ritobin: ["ritobin", "rito"] },
  });
  if (!target) {
    return;
  }

  await vscode.workspace.fs.writeFile(
    target,
    Buffer.from(doc.getText(), "utf8"),
  );
  const saved = await vscode.workspace.openTextDocument(target);
  await vscode.window.showTextDocument(saved, { preview: false });
}

async function maybePromptReadonly(
  ctx: Ctx,
  binFs: RitobinBinFs,
  doc: vscode.TextDocument,
): Promise<void> {
  if (doc.uri.scheme !== BIN_SCHEME) {
    return;
  }
  if (ctx.persistentState.binReadonlyPrompt === "dismissed") {
    return;
  }

  const override = binFs.isOverride(doc.uri) ?? false;
  const actions = override
    ? [SAVE_AS, DISMISS]
    : [SAVE_AS, WRITE_BACK, DISMISS];
  const message = override
    ? "This is a PTCH override BIN. Save it as .ritobin to keep working on it."
    : "This .bin opened read-only. Save it as .ritobin if you want to continue editing it, " +
      "or enable write-back to save changes.";

  const choice = await vscode.window.showInformationMessage(
    message,
    ...actions,
  );
  if (choice === SAVE_AS) {
    await saveAsRitobin(doc);
  } else if (choice === WRITE_BACK) {
    await enableWriteBack(binFs, doc);
  } else if (choice === DISMISS) {
    await ctx.persistentState.updateBinReadonlyPrompt("dismissed");
  }
}
