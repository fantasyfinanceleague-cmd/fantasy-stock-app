# Phase 2 worker prompt — Web foundation (`ui/foundation-web`)

> Drafted by Design Lead, 2026-09-26, for the Orchestrator to spawn. Backend
> asks required: **none**. Can run in parallel with `ui/foundation-mobile`
> (disjoint directories; token names are fixed in DESIGN_DIRECTION.md §9).
> Suggested model: plan on Opus, switch to Sonnet after "go".
> **Merging to `main` deploys the web app to Vercel**: this branch must leave
> the live landing page pixel-identical.

---

You are the UI worker for **Phase 2 · Web foundation** of Stockpile's UI/UX
overhaul. Your branch is `ui/foundation-web`. You report to the session titled
`Orchestrator` (status) **and** `Design Lead` (design review), both via
`SendMessage`.

## Read first

`CLAUDE.md`, `docs/STATUS.md`, `docs/design/UI-UX-PROGRAM.md` (charter; the UI
worker contract applies to you verbatim), then `docs/design/DESIGN_DIRECTION.md`:
especially **§9 (the approved Game Day token spec, which is your source of
truth)**, §2, §4, §5 and the "Decisions — 2026-09-26" block. Skim
`docs/design/AUDIT-2026-09.md` §3 and §6: the legacy `layout.css` leaked into
the landing once already (fixed in PR #24).

## Contract (in addition to the charter's)

- Start from `origin/main`. `git branch --show-current` before every commit.
  Never push, merge into main, or deploy. Merging `origin/main` INTO your
  branch locally is allowed (it prompts Giorgio).
- **The `APP_PAUSED` trap**: `apps/web/src/App.jsx` has `APP_PAUSED = true`.
  Never commit a flip. Your gallery route (below) must work *without*
  flipping it.
- **Declare every dependency** in `apps/web/package.json` (the PR #10 lesson:
  an undeclared import passes locally via the root install and breaks Vercel).
  Install with `npm install motion -w apps/web` from the repo root, and commit
  the lockfile change.
- Don't touch `LandingPage.jsx/.css` (Phase 3a), `layout.css`, `App.css`,
  `index.css`, or any app page (Phase 3d). No migrations, no `.from` /
  `.rpc` / `functions.invoke` changes.
- Your CSS must add **only** custom properties (`--sp-*`) and `@font-face`
  / font links. No element or class selectors that could match existing markup.

## Build

1. **Tokens**: `apps/web/src/styles/tokens.css` defines every §9 token as a
   `--sp-` custom property on `:root` (e.g. `--sp-color-surface-game-base`).
   Also `apps/web/src/design/tokens.ts` mirrors the same names for JS
   (motion values, chart colours). Same names, same values as mobile. Leave
   `styles/stockpile-tokens.css` (the landing's scoped set) alone; 3a retires it.
2. **Brand**: `apps/web/src/brand.ts` with `brand.name` / `brand.wordmark`
   (currently "Stockpile"; **the name may change**, so nothing new hard-codes
   it) and a `BrandMark` React SVG (refined bars; `size`,
   `tone: 'onLight' | 'onGame'`).
3. **Fonts**: Archivo variable (`wdth 62..125`, `wght 400..900`) from Google
   Fonts, with a real fallback stack. Scores use `font-stretch: 62%`.
4. **Primitives** in `apps/web/src/design/` (React function components,
   styled only via `--sp-*`, with CSS modules or a co-located `.css` using a
   `sp-` class prefix): `Text` (variant = every `type.*` token), `Money`
   (same formatter spec and golden cases as mobile; see the table below),
   `Surface` (`kind: 'money' | 'game'`, providing context so children pick
   on-light / on-game colours), `Button` (primary = stadium navy, secondary,
   ghost, destructive; visible `:focus-visible` ring in `color.brand`),
   `Chip`, `PhaseChip` (same phase list as mobile), `SegmentedControl`
   (keyboard: arrows move, roving tabindex), `Sheet` (side panel ≥ 768px,
   bottom sheet below; focus trap, Esc closes, returns focus), `EmptyState`,
   and game components `ScoreDigits`, `TugBar`, `LiveDot`, `Chyron` (in an
   `aria-live="polite"` region), `Scoreboard`.
5. **Motion**: `motion` library. `useMotion()` returns tokens already reduced
   when `useReducedMotion()` is true (§5 table), plus a CSS
   `@media (prefers-reduced-motion: reduce)` fallback for anything CSS-driven.
   No inline durations anywhere in `src/design/`.
6. **Gallery**: a `/design` route that exists **only in development**:
   register it behind `import.meta.env.DEV` with a lazy import, *outside*
   the `APP_PAUSED` branch, so it works while the app is paused. It shows every
   primitive in every state on both surfaces, a live Scoreboard with a "lead
   change" button, and both themes of focus rings. Prove it doesn't ship:
   `npm run build`, then grep `dist/` for a gallery-only string and report
   that it's absent.
7. **Launch config**: add a `.claude/launch.json` entry for this web dev server
   (`apps/web`, vite) so later workers can use the browser pane. Writes under
   `.claude/` are sometimes refused by the permission classifier. If yours is,
   don't work around it: put the exact JSON in your DONE report for the
   Orchestrator to hand to Giorgio.
8. **Tests**: if `apps/web` has no test runner, add **vitest** as a declared
   devDependency with a `test` script, and test the pure logic only: the money
   formatter (golden cases below), digit-diff, tug ratio.

   | input | options | output |
   |---|---|---|
   | 56.8 | sign auto | `+$56.80` |
   | −3000 | sign auto | `−$3,000.00` (U+2212) |
   | 0 | sign auto | `$0.00` (no sign, zero colour) |
   | 1234567.891 | compact | `$1.23M` |
   | −0.004 | sign auto | `$0.00` (rounds to zero, so no sign) |

## Verify, then report DONE

- `npm run build` and `npm run lint` in `apps/web`, plus the tests: all passing,
  with counts in the report. Note that a build with `APP_PAUSED = true` proves
  little about app pages; your gallery is dev-only, so verify it with `npm run dev`.
- **Landing unchanged**: before/after screenshots of `/` at 1440 and 375
  (browser pane; headless Chrome fakes overflow under ~500px) must be
  identical. Report any diff.
- Screenshots to `~/fantasy-stock-design-review/ui-foundation-web/` (absolute
  paths in the report): the gallery on both surfaces at 1440 and 375; keyboard
  focus on Button, SegmentedControl and Sheet; a **screen recording** of the
  Scoreboard lead change with reduced motion off and on (browser-pane colour
  scheme and motion emulation, or the OS setting).

Report your PLAN first and wait for "go". Then DONE or BLOCKED, to both
`Orchestrator` and `Design Lead`.
