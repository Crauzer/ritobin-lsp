#!/usr/bin/env node
/**
 * Shared logic for reading the `ritobin-lsp` crate version and patching it
 * into `BUNDLED_LSP_VERSION` in `src/ctx.ts`. Used by both `package-full.mjs`
 * (local full builds) and `sync-lsp-version.mjs` (CI packaging).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
export const extensionDir = path.dirname(scriptsDir);
export const repoRoot = path.dirname(path.dirname(extensionDir));

// Trailing comment on the BUNDLED_LSP_VERSION line in src/ctx.ts.
export const BUNDLED_VERSION_MARKER = "//#[__auto(VSCODE_LSP_BUNDLED_VERSION)]";

/** Reads the `version` of the `ritobin-lsp` crate from its Cargo.toml. */
export function ritobinLspCrateVersion() {
  const manifest = path.join(repoRoot, "crates", "ritobin-lsp", "Cargo.toml");

  const match = fs
    .readFileSync(manifest, "utf8")
    .match(/^version\s*=\s*"([^"]+)"/m);
  if (!match) {
    throw new Error(`Could not find a version in ${manifest}`);
  }

  return match[1];
}

/** Sets BUNDLED_LSP_VERSION in src/ctx.ts, returning a restore callback. */
export function patchBundledVersion(version) {
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
