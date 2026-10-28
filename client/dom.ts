/**
 * Minimal global access helper.
 *
 * The plugin tsconfig has no DOM library, and the client also runs inside the
 * native app, so every browser API is reached through an untyped global.
 */

export function getGlobal(): any {
  return typeof globalThis === "undefined" ? undefined : (globalThis as unknown as any);
}

export function isBrowser(): boolean {
  const g = getGlobal();
  return !!g && typeof g.document !== "undefined" && typeof g.location !== "undefined";
}
