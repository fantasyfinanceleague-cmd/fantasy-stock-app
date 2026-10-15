# Onboarding W5: web invite, sign-in and confirm pages, captures (`feat/onboarding-w5-web-join`)

Plan: `docs/plans/2026-10-14-onboarding.md` (W5; Decisions 7, 8, 10, 16). Board: section 7, "The web
invite page" (`docs/design/screens/onboarding.jsx`, `Arrival` / `Username` / `YoureIn` / `Desktop`
with `web`). Copy: all in `apps/web/src/join/joinCopy.ts`, one module, for the gate to read.

**The images are NOT in the repo.** They are in
`~/fantasy-stock-design-review/feat-onboarding-w5-web-join/` on Giorgio's machine.

## How they were taken (2026-10-14)

- **Live captures** (`join-*`, `confirm-*`): a local `vite build` of the branch with `APP_PAUSED = true`
  as committed, served with `vercel.json`'s headers applied (the CSP included), driven in headless
  Chromium (Playwright) at 375×812. Light and Dark come from `prefers-color-scheme`.
- **Contact sheets** (`sheet-*`): the real screen components rendered with fixed props by a throwaway
  harness (not committed), because the signed-in screens need a live Supabase, Apple and Google to
  reach. Each frame is 375×812 (`sheet-desktop-*`: 1000×640). Fonts are the self-hosted Archivo.
- Local-only settings: `LOCAL_ALLOW_PLACEHOLDERS=1` (the production build refuses to finish while the
  App Store URL is a placeholder; the flag is ignored on Vercel) and fake `VITE_SUPABASE_*` values.
- `invite-preview` (W3) is not deployed yet, so a live `/join` shows its fallback headline, "You're invited to a league". The sheets show the real names ("Roberto B. invited you to…").

## Captures

Reference: the decided board, PR #278 (`design/onboarding-arrival-redraw` @ 74470752), frames 1 and 7
(Giorgio, 2026-10-14: **B with C1**).

| File | Shows |
|---|---|
| `sheet-arrival-{light,dark}.png` | The signed-out arrival, five states: inviter initials + "{inviter} invited you to {league}" · no inviter, league icon + "You're invited to {league}" · no preview, league icon + "You're invited to a league" · a long league name (wraps at its spaces, never chopped) · with a notice above the buttons (expired web link). The invite block is centred; Apple, Google and Use email sit at the bottom |
| `sheet-refusals-{light,dark}.png` | The long-name arrival again, then the refusals: full · not taking new players (the warn panel in the buttons' place, "Sign in" under it, NO App Store badge) · a dead link (no heading, the panel and "Sign in" centred on the page) · the transport-failure line with "Not you? Sign out" · Create account |
| `sheet-signin-and-done-{light,dark}.png` | Sign in with the unconfirmed-email line and "Send again" (and the plain-text forgot line) · Check your email · Pick a username (✓ EMAIL CONFIRMED chip) · "You're in {league}." and "You're already in {league}.", each with the facts card (Managers, Draft, Stakes, Season) and the App Store badge |
| `sheet-desktop-arrival-{light,dark}.png`, `sheet-desktop-dead-and-in-light.png` | The arrival and a refusal at desktop width (one 400pt column), the dead link, and "You're in" with the facts |
| `join-confirmed-signin-phone-{light,dark}.png` | The live web callback: a link opened where the code verifier isn't (no exchange possible) lands on Sign in with "Your email is confirmed. Sign in with your password." |
| `confirm-ok-phone-{light,dark}.png` | `/auth/confirm` (the app's email link on a device without the app): the approved line. The URL is already bare |
| `confirm-error-phone-{light,dark}.png` | The same page for an expired link: "This link has expired. Open the app and sign in to get a new one." |

Also checked in the same session, with no images:
- The web callback with the real supabase-js: the code never appears in the DOM, `history.state` or
  storage; a failed exchange hands back a known notice word, never a message.
- `/auth/confirm` with no outcome (a fresh visit) goes to the landing; `/dashboard` while paused goes to the landing.
- The pages' only console errors are the shared main stylesheet's Google Fonts `@import` (blocked by
  the CSP on these paths, on purpose; no request is made) and the not-yet-deployed `invite-preview`.
