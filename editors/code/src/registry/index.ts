import { log, spawnAsync } from "../util";

/**
 * Thin async wrapper around the Windows `reg.exe` CLI.
 *
 * Arguments are passed as an array (no shell), so keys and values need no
 * quoting or escaping. Mutating operations log failures and return `false`
 * instead of throwing; only string (REG_SZ) values are supported.
 */

async function reg(args: string[]): Promise<{ ok: boolean; stdout: string }> {
  const res = await spawnAsync("reg", args, { windowsHide: true });
  
  const ok = res.status === 0 && !res.error;
  if (!ok) {
    log.warn(
      `reg ${args.join(" ")} failed:`,
      res.stderr.trim() || res.error || `exit code ${res.status}`,
    );
  }

  return { ok, stdout: res.stdout };
}

/** `/ve` targets the key's default value, `/v <name>` a named one. */
function valueArgs(name: string | undefined): string[] {
  return name === undefined ? ["/ve"] : ["/v", name];
}

/**
 * Set a string value, creating the key if it doesn't exist.
 * `name === undefined` targets the key's default value.
 */
export async function setValue(
  key: string,
  name: string | undefined,
  data: string,
): Promise<boolean> {
  return (await reg(["add", key, ...valueArgs(name), "/d", data, "/f"])).ok;
}

/** Delete a key including all its values and subkeys. */
export async function deleteKey(key: string): Promise<boolean> {
  return (await reg(["delete", key, "/f"])).ok;
}

/**
 * Delete a single value, leaving the key and its other values in place.
 * `name === undefined` targets the key's default value.
 */
export async function deleteValue(
  key: string,
  name?: string,
): Promise<boolean> {
  return (await reg(["delete", key, ...valueArgs(name), "/f"])).ok;
}

/**
 * Read a REG_SZ value; `name === undefined` reads the key's default value.
 * Returns `undefined` if the key/value doesn't exist (an expected case, so
 * nothing is logged).
 */
export async function getValue(
  key: string,
  name?: string,
): Promise<string | undefined> {
  const res = await spawnAsync("reg", ["query", key, ...valueArgs(name)], {
    windowsHide: true,
  });

  if (res.status !== 0 || res.error) {
    return undefined;
  }
  
  const match = /REG_SZ\s+(.+)/.exec(res.stdout);
  return match?.[1]?.trim();
}
