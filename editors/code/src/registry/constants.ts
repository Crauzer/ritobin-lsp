/**
 * Registry locations for the Windows Explorer integration.
 *
 * All keys live under HKCU (no admin required). The SystemFileAssociations
 * verb adds a context-menu entry for .bin files without touching the user's
 * default .bin handler.
 */

/** ProgId that `.rito`/`.ritobin` files are associated with. */
export const EXPLORER_PROG_ID = "RitobinLSP.rito";

/** Context-menu verb shown for `.bin` files ("Open as Ritobin"). */
export const EXPLORER_VERB_KEY =
  "HKCU\\Software\\Classes\\SystemFileAssociations\\.bin\\shell\\RitobinLSP.OpenAsRitobin";

export const EXPLORER_PROG_ID_KEY = `HKCU\\Software\\Classes\\${EXPLORER_PROG_ID}`;

/** Extension keys whose default value points at [`EXPLORER_PROG_ID`]. */
export const EXPLORER_EXTENSION_KEYS = [
  "HKCU\\Software\\Classes\\.rito",
  "HKCU\\Software\\Classes\\.ritobin",
];
