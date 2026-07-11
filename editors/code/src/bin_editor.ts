import * as vscode from "vscode";

import { binToVirtual } from "./bin_fs";
import { errorMessage } from "./ide_utils";
import { log } from "./util";

export const BIN_EDITOR_VIEW_TYPE = "ritobin-lsp.binEditor";

/**
 * Custom editor for `*.bin` that immediately redirects to the virtual
 * ritobin-text document (see `bin_fs.ts`) and closes its own panel. Opening
 * the virtual document drives stat → readFile → server start, so this works
 * even in a cold folderless window launched from the Explorer verb.
 *
 * If deserialization fails the panel stays open and shows the error,
 * degrading gracefully for non-League `.bin` files.
 */
export class RitobinBinEditorProvider
  implements vscode.CustomReadonlyEditorProvider
{
  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    panel.webview.html = renderMessage(
      "Opening as Ritobin…",
      `Converting ${document.uri.fsPath} to ritobin text`,
    );

    try {
      const doc = await vscode.workspace.openTextDocument(
        binToVirtual(document.uri),
      );

      await vscode.window.showTextDocument(doc, {
        viewColumn: panel.viewColumn ?? vscode.ViewColumn.Active,
        preview: false,
      });

      panel.dispose();
    } catch (e) {
      log.error("Failed to open bin as ritobin", document.uri.fsPath, e);
      panel.webview.html = renderMessage(
        "Failed to open .bin as Ritobin",
        errorMessage(e),
      );
    }
  }
}

function renderMessage(title: string, detail: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"></head>
<body style="font-family: var(--vscode-font-family); padding: 2em;">
  <h3>${escapeHtml(title)}</h3>
  <p>${escapeHtml(detail)}</p>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
