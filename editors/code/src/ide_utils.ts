import * as vscode from "vscode";

import { log } from "./util";

/**
 * Helpers for the repetitive parts of the VS Code API: user notifications,
 * error normalization/reporting, and small fallible-call wrappers.
 *
 * The error-handling contract: inner code throws (`UserFacingError` when the
 * message is meant for the user), entry points wrapped in `guard` report
 * exactly once — log + toast — instead of each site deciding ad hoc.
 */

/** Normalizes an unknown thrown value into a human-readable message. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * An error whose `message` is written for the user and safe to show in the
 * UI as-is. Pass the raw cause via `new UserFacingError(msg, { cause })` so
 * it still reaches the log.
 */
export class UserFacingError extends Error {}

/**
 * Standard failure reporting: logs the full error to the extension output
 * channel and shows an error toast as `"<userMessage>: <error>"`. Returns
 * the normalized error message so callers can rethrow, e.g.
 * `throw vscode.FileSystemError.Unavailable(reportError(...))`.
 */
export function reportError(userMessage: string, e: unknown): string {
  const message = errorMessage(e);

  log.error(userMessage, e);
  void vscode.window.showErrorMessage(`${userMessage}: ${message}`);

  return message;
}

/**
 * Fire-and-forget user notifications that also land in the extension log,
 * so the output channel tells the full story of what the user saw.
 */
export const toast = {
  info(message: string): void {
    log.info(message);
    void vscode.window.showInformationMessage(message);
  },

  warn(message: string): void {
    log.warn(message);
    void vscode.window.showWarningMessage(message);
  },

  error(message: string): void {
    log.error(message);
    void vscode.window.showErrorMessage(message);
  },
};

/**
 * Typed button prompt: the result is narrowed to the given items, so
 * comparing the choice against a typo'd label is a compile error. Returns
 * `undefined` when the toast is dismissed.
 */
export function askUser<T extends string>(
  message: string,
  ...items: T[]
): Thenable<T | undefined> {
  return vscode.window.showInformationMessage(message, ...items);
}

/** `workspace.fs.stat` that returns `undefined` for missing/unreadable files. */
export function tryStat(
  uri: vscode.Uri,
): Thenable<vscode.FileStat | undefined> {
  return vscode.workspace.fs.stat(uri).then(
    (stat) => stat,
    () => undefined,
  );
}

/**
 * Wraps an entry point (command, event handler) so exceptions are reported
 * instead of vanishing or surfacing as VS Code's generic "command failed"
 * toast. A `UserFacingError` shows its own message; anything else shows
 * `what` plus the underlying message.
 */
export function guard<Args extends unknown[]>(
  what: string,
  fn: (...args: Args) => unknown,
): (...args: Args) => Promise<void> {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (e) {
      if (e instanceof UserFacingError) {
        log.error(what, e);
        void vscode.window.showErrorMessage(e.message);
      } else {
        reportError(`${what} failed`, e);
      }
    }
  };
}
