// Phase 3b-1 — S4's hand-off from sign-in to the app.
//
// The sign-in button goes loading → ✓ done, and the spec wants the ✓ to show
// briefly (`quick`) before the app takes over, then Home to crossfade and
// scale in (0.96 → 1, `feature`) rather than hard-cut. The session flip that
// swaps the screens happens in app/_layout.tsx, far from the button, so the
// two talk through this module:
//   1. sign-in calls markSignInIntent() just before signInWithPassword, and
//      clearSignInIntent() if it fails;
//   2. the root layout, seeing signed-out → signed-in with the intent set,
//      waits `quick` (the ✓) before switching, and marks the entrance;
//   3. the tabs layout consumes the entrance once and plays it.
// A session that appears any other way (cold start, recovery link) has no
// intent, so it neither waits nor plays the entrance.

let intent = false;
let entrance = false;

export function markSignInIntent(): void {
  intent = true;
}

export function clearSignInIntent(): void {
  intent = false;
}

/** Root layout: true once per intentional sign-in; arms the entrance. */
export function takeSignInIntent(): boolean {
  const had = intent;
  intent = false;
  if (had) entrance = true;
  return had;
}

/** Tabs layout: true exactly once after an intentional sign-in. */
export function consumeSignInEntrance(): boolean {
  const had = entrance;
  entrance = false;
  return had;
}
