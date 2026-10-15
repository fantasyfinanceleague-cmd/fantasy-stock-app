/**
 * What the inline script in index.html kept IN MEMORY (a frozen, non-enumerable
 * window property) for the one visit: the auth code, the invite, an error KIND.
 *
 * A page takes it ONCE: it is read, then DELETED from `window`, so no other
 * script on the origin (the main bundle is large) can read the code afterwards,
 * and the page keeps its own copy in module scope, which nothing else can reach.
 * The copy outlives a remount (StrictMode runs initialisers twice), and a NEW
 * value on `window` (a new link in the same tab) replaces it.
 */
const held = new Map<string, unknown>();

export function takeHeld<T>(name: string): T | null {
  const w = window as unknown as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(w, name)) {
    held.set(name, w[name]);
    delete w[name];
  }
  return (held.get(name) as T | undefined) ?? null;
}

/** For tests: forget everything taken. */
export function forgetHeld(): void {
  held.clear();
}
