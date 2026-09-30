import { pendingRoute } from '@/lib/shell/pendingRoute';

// Phase 3b-1 — the first half of the signed-out deep-link resume.
//
// expo-router calls this for every system link (the cold-start URL and any
// link opened while running) BEFORE it routes. The link is recorded so the
// root layout can open it after sign-in, and the path is returned unchanged:
// the router still handles it, and Stack.Protected (app/_layout.tsx) sends a
// signed-out user to sign-in instead of rendering the guarded screen.
// lib/shell/pendingRoute.ts decides whether the recorded link is ever
// replayed; lib/shell/resumeTarget.ts decides whether it is allowed to be.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    pendingRoute.record(path);
  } catch (e) {
    // Throwing here can crash the app (expo-router's own warning); the
    // link still routes normally, it just won't be resumed.
    console.warn('[native-intent] could not record deep link', e);
  }
  return path;
}
