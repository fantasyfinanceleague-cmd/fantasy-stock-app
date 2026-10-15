# Onboarding W5: web invite + confirm pages, captures (`feat/onboarding-w5-web-join`)

Plan: `docs/plans/2026-10-14-onboarding.md` (W5; Decisions 10 and 16). Board: section 7, "The
web invite page" (`docs/design/screens/onboarding.jsx`, `Arrival` / `YoureIn` / `Desktop` with
`web`).

**The images are NOT in the repo.** They are in
`~/fantasy-stock-design-review/feat-onboarding-w5-web-join/` on Giorgio's machine.

## How they were taken

These were taken on 2026-10-14.
- **Build:** a local `vite build` of the branch with `APP_PAUSED = true` as committed, then served by `vite preview`.
- **Browser:** headless Chromium (Playwright), 375×812 (phone) and 1280×800 (desktop). Light and Dark come from `prefers-color-scheme`.
- **Local-only settings:**
  - `LOCAL_ALLOW_PLACEHOLDERS=1`: the production build refuses to finish while a placeholder remains (see below). This flag lets a local build through, and it is ignored on Vercel.
  - Fake `VITE_SUPABASE_*` values: the worktree has no `.env.local`, and the pages make no Supabase call.

## What these pages are today (the first slice, 2026-10-14)

- **No web sign-in yet.** The Planner ruled the FULL flow (sign-in, preview, join, "You're in…") for this branch. Its design is with the Orchestrator for approval, so the slice shown here has no sign-in.
- **`/join/<code>` asks the no-session `invite-preview` function (W3) for the league name and inviter.** It is not deployed yet, so these captures show the fallback, "You're invited to a league". Any failure of that call (network, 429, 500, a bad body) falls back to it, never to an error page.
- **Placeholder copy is visible on purpose.** `__PLACEHOLDER__ Open in the app` is a label still waiting for approval. The production build fails while one is in the bundle.
- **Refusal states are not captured**, as they need a preview. Each is covered by `src/join/join.test.tsx`, and `joinCopy.parity.test.ts` checks the lines against the app's.
- **Fonts:** the pages use the system font stack. Their CSP allows no outside origin (the shared main stylesheet's Google Fonts `@import` is blocked on these paths, on purpose).

## Captures

| File | Shows | URL |
|---|---|---|
| `join-valid-phone-{light,dark}.png`, `join-valid-desktop-{light,dark}.png` | A well-formed code: "Open in the app" (custom scheme `fantasystockapp://join/ABCDE23456`; label PROPOSED) and the App Store badge | `/join/abcde23456` |
| `join-badcode-phone-{light,dark}.png` | Not a code: the app's approved line, in place, no network call, no way onward | `/join/%3Cscript%3E` |
| `confirm-ok-phone-{light,dark}.png`, `confirm-ok-desktop-{light,dark}.png` | The approved line (Decision 16). The URL is already `/auth/confirm` with no code | `/auth/confirm?code=<uuid>` |
| `confirm-error-phone-{light,dark}.png` | An expired or used link: never the "confirmed" line. NOTE: these were taken BEFORE the Planner's line arrived, so they show the placeholder; the page now says "This link has expired. Open the app and sign in to get a new one." Retake with the next slice | `/auth/confirm?error=access_denied&error_code=otp_expired` (query) and `#error=…` (hash) |

Also checked in the same session, with no images:
- `/auth/confirm` with no outcome (a fresh visit) goes to the landing.
- `/dashboard` while paused goes to the landing.
- `/.well-known/apple-app-site-association` answers 200 as `application/json`, with no `Location` header.
- `history.state` is `{authConfirm, idx}`, with no code anywhere in the DOM or storage.
