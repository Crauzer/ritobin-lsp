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
import { fileURLToPath } from "node:url";

const extensionDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.dirname(path.dirname(extensionDir));

const syncLspVersion = process.argv.includes("--sync-lsp-version");

// Trailing comment on the BUNDLED_LSP_VERSION line in src/ctx.ts.
const BUNDLED_VERSION_MARKER = "//#[__auto(VSCODE_LSP_BUNDLED_VERSION)]";

// Platforms the extension actually ships for (see release-please.yml).
const SUPPORTED_VSIX_TARGETS = new Set([
  "win32-x64",
  "win32-arm64",
  "linux-x64",
  "linux-arm64",
  "darwin-x64",
  "darwin-arm64",
]);

/** Reads the `version` of the `ritobin-lsp` crate from its Cargo.toml. */
function ritobinLspCrateVersion() {
  const manifest = path.join(repoRoot, "crates", "ritobin-lsp", "Cargo.toml");

  const match = fs
    .readFileSync(manifest, "utf8")
    .match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not find a version in ${manifest}`);
  }

  return match[1];
}

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

/** Sets BUNDLED_LSP_VERSION in src/ctx.ts, returning a restore callback. */
function patchBundledVersion(version) {
  const ctxPath = path.join(extensionDir, "src", "ctx.ts");
  const original = fs.readFileSync(ctxPath, "utf8");

  const lines = original.split("\n");
  const idx = lines.findIndex((line) => line.includes(BUNDLED_VERSION_MARKER));
  if (idx === -1) {
    throw new Error(
      `Could not find the ${BUNDLED_VERSION_MARKER} marker in ${ctxPath}`,
    );
  }

  const patched = lines.slice();
  patched[idx] =
    `const BUNDLED_LSP_VERSION = "${version}"; ${BUNDLED_VERSION_MARKER}`;

  const next = patched.join("\n");
  if (next === original) {
    console.log(`ctx.ts BUNDLED_LSP_VERSION already ${version}`);

    return () => {};
  }

  fs.writeFileSync(ctxPath, next);
  console.log(`Patched ctx.ts BUNDLED_LSP_VERSION to ${version}`);

  return () => fs.writeFileSync(ctxPath, original);
}

function package() {
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

console.log(`\nDone: ${path.join(extensionDir, outFile)}`);
console.log(`Install with: code --install-extension ${outFile}`);
