# Phase 3d worker prompt — Web app pages (`ui/web-app`)

> Drafted by Design Lead, 2026-09-26. Starts **after 3c and 3e settle the
> patterns** (it mirrors them on web). The app stays **paused**
> (`APP_PAUSED = true`); this ships nothing visible until un-paused. Backend
> asks: the same as mobile (#1, #2, #3, #5, #9) for full parity; missing asks
> become BLOCKED items, never stopgaps. Plan on Opus, build on Sonnet;
> splittable by page group if large.

---

You are the UI worker for **Phase 3d · the web app pages**. Your branch is
`ui/web-app`. You report to `Orchestrator` and `Design Lead`.

## Read first

`CLAUDE.md` (the **APP_PAUSED trap**: never commit a flip; `npm run build`
with it `true` proves nothing about app pages), `docs/STATUS.md`, the charter
contract, `docs/design/prompts/phase3-plan.md`, DESIGN_DIRECTION §3 (web IA),
§4, §5, §9, and `docs/design/AUDIT-2026-09.md` §2 and §6 (the web app is a third
identity: dark navy, crest mascot, 944 inline styles, 95 hex values, and a
3,192-line global `layout.css`). Then the merged mobile 3b/3c/3e screens: web
mirrors their structure and states.

## Scope

1. **Shell:** a left rail ≥ 768px (Home · Matchup · League · Portfolio +
   avatar), a bottom bar below 768px, the league pill + league sheet (as a side
   panel on desktop). `Surface` per page region (money vs game).
2. **Pages, rebuilt on `apps/web/src/design`** (not restyled in place):
   Login/Signup (honest pre-launch copy), Home (the 3b-2 content, incl. the
   cumulative-gain chart), Matchup (3c), League/standings/draft recap (3c), Draft
   room (3c), Portfolio + stock panel + trade (3e), History (3e), Profile.
3. **Retire the legacy:** delete the crest-mascot assets and every
   `layout.css` / `App.css` / `index.css` rule once nothing uses it; remove
   inline `style={{}}` from rebuilt pages; no raw hex. **Report the before/after
   counts** (inline styles, distinct hex values, CSS lines).
4. **Fonts off `@import`** (approved proposal from 3a): move
   `apps/web/src/design/fonts.css` from a CSS `@import` (render-blocking inside
   whatever stylesheet bundles it) to an async `<link>` with preconnect and
   metric-tuned fallbacks, matching what the 3a landing does locally. Prove there's
   no layout shift on font swap (CLS ≤ 0.05) and that the landing is still byte-identical.
5. **Motion root:** wrap the app shell in the foundation's `<MotionRoot>`
   (`MotionConfig reducedMotion="user"`, added in 3a), so `motion.*` components
   honour the OS setting; `useMotion()` already ORs in the OS preference.
6. **Lint baseline:** `npm run lint` in `apps/web` fails on `main` today (~55
   pre-existing errors, e.g. `Header.jsx:53` unused `setLoggingOut`). Most sit
   in the legacy files you delete; fix the rest, and report **before/after
   error counts**. Lint must pass at DONE.
7. **Keyboard and screen reader:** everything operable by keyboard; landmarks;
   the Scoreboard's live region; focus management in panels.

## Motion

The mobile 3b/3c/3e tables, same tokens, via `motion` + `useMotion()`.
Hover states are a web-only addition: a border-brighten or underline, `quick`;
no lift or tilt. **Reduced motion:** the same rows as mobile, plus
`@media (prefers-reduced-motion: reduce)` for any CSS-driven effect.

## Verify, then report DONE

- build / lint / test counts. The **landing stays byte-identical** (SHA-256 of
  the landing chunk vs `origin/main`), since you don't own it.
- With `APP_PAUSED` flipped **locally only**: screenshots of every page at
  **375, 768, 1280, 1440**, logged-in via Giorgio in **your session's
  built-in browser pane** (never type credentials). Capture the logged-out
  states first. Flip it back and confirm `git diff` shows no `App.jsx` change.
- Lighthouse (desktop + mobile) for Home and Matchup: LCP ≤ 2.5s, CLS ≤ 0.05.
- Keyboard walkthrough notes; the reduced-motion recordings for the matchup
  lead change and the standings re-sort.

## DESIGN-APPROVED criteria

1. One identity: web matches mobile's Game Day system; no crest, dark legacy theme or blue-gradient buttons remain.
2. Legacy counts driven to (near) zero, with numbers in the report.
3. Parity of honest states with mobile (lifecycle phases, zero, minus, no contradictions).
4. The landing is untouched (byte proof); `APP_PAUSED` is not committed.
5. Keyboard and screen reader pass; motion from tokens; every reduced-motion row evidenced.

Report your PLAN first and wait for "go".

## Ambition bar (added 2026-09-27, after Giorgio called the first landing "still very basic")

**The bar is "would this impress on first use next to Apple, Stripe or Linear product pages and web apps?"**, not "is it correct". Performance, honesty, tokens and reduced motion are **table stakes, not the goal**. The Design Lead will push back on timid work. **Copy:** keep Giorgio's existing copy **verbatim** unless this prompt explicitly changes it; propose wording changes, don't make them.

**Signature moments this phase must include** (each with its reduced-motion row and a recording):
- **Page transitions** between app routes (View Transitions API, with a crossfade fallback).
- **A sticky header that condenses on scroll**; a league pill → panel shared element.
- Every mobile signature moment from 3b-2 / 3c / 3e, adapted to web (hover previews on standings rows and tickers).
