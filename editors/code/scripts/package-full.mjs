#!/usr/bin/env node
/**
 * Builds a fully self-contained vsix for the host platform: compiles the
 * ritobin-lsp server in release mode, bundles it into server/, and runs
 * `vsce package`. Mirrors the rust-packaging job in
 * .github/workflows/release-please.yml.
 *
 * Usage: npm run package:full [-- --sync-lsp-version]
 *
 * `--sync-lsp-version` sets `BUNDLED_LSP_VERSION` in `src/ctx.ts` to the
 * `ritobin-lsp` crate version for the build, then restores the file.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  extensionDir,
  repoRoot,
  ritobinLspCrateVersion,
  patchBundledVersion,
} from "./lsp-version.mjs";

const syncLspVersion = process.argv.includes("--sync-lsp-version");

// Platforms the extension actually ships for (see release-please.yml).
const SUPPORTED_VSIX_TARGETS = new Set([
  "win32-x64",
  "win32-arm64",
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
]);

function getExeExtension() {
  return process.platform === "win32" ? ".exe" : "";
}

function getVsixTarget() {
  return `${process.platform}-${process.arch}`;
}

function platformGuard() {
  if (!SUPPORTED_VSIX_TARGETS.has(vsixTarget)) {
    console.error(`Unsupported host platform/arch: ${vsixTarget}`);
    process.exit(1);
  }
}

function packageExtension() {
  run(
    process.execPath,
    [vsce, "package", "--target", vsixTarget, "--out", outFile],
    extensionDir,
  );
}

function run(command, args, cwd) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const res = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (res.error) {
    throw res.error;
  }
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}

const vsixTarget = getVsixTarget();
platformGuard();

run(
  "cargo",
  ["build", "--release", "--locked", "--package", "ritobin-lsp"],
  repoRoot,
);

const exe = getExeExtension();
const binary = path.join(repoRoot, "target", "release", `ritobin-lsp${exe}`);
const serverDir = path.join(extensionDir, "server");
fs.mkdirSync(serverDir, { recursive: true });
fs.copyFileSync(binary, path.join(serverDir, `ritobin-lsp${exe}`));
console.log(`Bundled server binary into ${serverDir}`);

// Invoke vsce's JS entry point directly with the current node executable so
// this works on Windows too (node_modules/.bin shims require a shell there).
const vsce = path.join(extensionDir, "node_modules", "@vscode", "vsce", "vsce");
const outFile = `ritobin-lsp-${vsixTarget}.vsix`;
if (syncLspVersion) {
  // Patch before `vsce package` bundles src/, and restore on exit (including
  // the process.exit() a failed `run` triggers).
  const restoreVersion = patchBundledVersion(ritobinLspCrateVersion());
  process.on("exit", restoreVersion);
}

packageExtension();

console.log(`\nDone: ${path.join(extensionDir, outFile)}`);
console.log(`Install with: code --install-extension ${outFile}`);
