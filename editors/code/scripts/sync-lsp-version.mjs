#!/usr/bin/env node
/**
 * Sets BUNDLED_LSP_VERSION in src/ctx.ts to the ritobin-lsp crate version.
 * Used by the CI release job before `vsce package`; unlike
 * `package-full.mjs --sync-lsp-version`, this does not restore the file
 * afterwards, since CI checkouts are ephemeral and the patched version
 * should stick through packaging.
 *
 * Usage: npm run sync-lsp-version
 */
import { patchBundledVersion, ritobinLspCrateVersion } from "./lsp-version.mjs";

patchBundledVersion(ritobinLspCrateVersion());
