import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import type { Ctx } from "./ctx";
import { askUser, toast } from "./ide_utils";
import * as registry from "./registry";
import {
  EXPLORER_EXTENSION_KEYS,
  EXPLORER_PROG_ID,
  EXPLORER_PROG_ID_KEY,
  EXPLORER_VERB_KEY,
} from "./registry/constants";
import { log } from "./util";

export function explorerIntegrationSupported(): boolean {
  return process.platform === "win32" && vscode.env.remoteName === undefined;
}

function resolveCodeExe(): string | undefined {
  // The desktop extension host is a fork of the VS Code executable itself
  // (also covers Insiders/VSCodium installs).
  const execPath = process.execPath;
  if (
    path.extname(execPath).toLowerCase() === ".exe" &&
    fs.existsSync(execPath)
  ) {
    return execPath;
  }

  // Fallback: appRoot is <install dir>\resources\app.
  const installDir = path.join(vscode.env.appRoot, "..", "..");
  for (const name of ["Code.exe", "Code - Insiders.exe", "VSCodium.exe"]) {
    const candidate = path.join(installDir, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

export async function installExplorerIntegration(): Promise<boolean> {
  if (!explorerIntegrationSupported()) {
    toast.warn(
      "Explorer integration is only available on local Windows installs.",
    );
  
    return false;
  }

  const codeExe = resolveCodeExe();
  if (!codeExe) {
    toast.error(
      "Could not locate the VS Code executable to register with Explorer.",
    );
  
    return false;
  }

  const command = `"${codeExe}" "%1"`;
  const icon = `"${codeExe}",0`;
  const results = [
    await registry.setValue(EXPLORER_VERB_KEY, undefined, "Open as Ritobin"),
    await registry.setValue(EXPLORER_VERB_KEY, "Icon", icon),
    await registry.setValue(
      `${EXPLORER_VERB_KEY}\\command`,
      undefined,
      command,
    ),
    await registry.setValue(
      EXPLORER_PROG_ID_KEY,
      undefined,
      "Ritobin Text File",
    ),
    await registry.setValue(
      `${EXPLORER_PROG_ID_KEY}\\DefaultIcon`,
      undefined,
      icon,
    ),
    await registry.setValue(
      `${EXPLORER_PROG_ID_KEY}\\shell\\open\\command`,
      undefined,
      command,
    ),
  ];

  for (const key of EXPLORER_EXTENSION_KEYS) {
    results.push(await registry.setValue(key, undefined, EXPLORER_PROG_ID));
  }

  const failures = results.filter((ok) => !ok).length;
  if (failures > 0) {
    toast.error(
      `Explorer integration install failed (${failures} registry operation(s) failed). ` +
        "See the ritobin-lsp Extension output for details.",
    );
  
    return false;
  }
  
  log.info("Explorer integration installed", { codeExe });
  toast.info(
    'Explorer integration installed: right-click a .bin file and choose "Open as Ritobin"; ' +
      ".rito/.ritobin files now open with VS Code.",
  );

  return true;
}

export async function uninstallExplorerIntegration(): Promise<boolean> {
  if (!explorerIntegrationSupported()) {
    toast.warn(
      "Explorer integration is only available on local Windows installs.",
    );

    return false;
  }

  await registry.deleteKey(EXPLORER_VERB_KEY);
  await registry.deleteKey(EXPLORER_PROG_ID_KEY);

  for (const key of EXPLORER_EXTENSION_KEYS) {
    if ((await registry.getValue(key)) === EXPLORER_PROG_ID) {
      await registry.deleteValue(key);
    }
  }

  toast.info("Explorer integration uninstalled.");
  return true;
}

export async function maybePromptExplorerIntegration(ctx: Ctx): Promise<void> {
  if (!explorerIntegrationSupported()) {
    return;
  }
  
  const state = ctx.persistentState.explorerIntegrationPrompt;
  if (state === "installed" || state === "dismissed") {
    return;
  }

  const choice = await askUser(
    'Add "Open as Ritobin" to the Windows Explorer context menu for .bin files, ' +
      "and open .rito/.ritobin files with VS Code by default?",
    "Yes",
    "No",
    "Don't ask again",
  );
  if (choice === "Yes") {
    if (await installExplorerIntegration()) {
      await ctx.persistentState.updateExplorerIntegrationPrompt("installed");
    }
  } else if (choice === "Don't ask again") {
    await ctx.persistentState.updateExplorerIntegrationPrompt("dismissed");
  }
  // "No" (or dismissing the toast) → ask again next session.
}
