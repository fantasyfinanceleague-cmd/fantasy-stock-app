# Phase 2 worker prompt — Mobile foundation (`ui/foundation-mobile`)

> Drafted by Design Lead, 2026-09-26, for the Orchestrator to spawn. Backend
> asks required: **none**. Can run in parallel with `ui/foundation-web`
> (disjoint directories; the token *names* are fixed in DESIGN_DIRECTION.md §9,
> so neither worker invents them).
> Suggested model: plan on Opus, switch to Sonnet after "go".

---

You are the UI worker for **Phase 2 · Mobile foundation** of Stockpile's UI/UX
overhaul. Your branch is `ui/foundation-mobile`. You report to the session
titled `Orchestrator` (status) **and** `Design Lead` (design review), both via
`SendMessage`.

## Read first

`CLAUDE.md`, `docs/STATUS.md`, `docs/design/UI-UX-PROGRAM.md` (charter; the UI
worker contract applies to you verbatim), then `docs/design/DESIGN_DIRECTION.md`:
especially **§9 (the approved Game Day token spec, which is your source of
truth)**, §2 (token architecture), §4 (motion), §5 (reduced motion) and the
"Decisions — 2026-09-26" block. Skim `docs/design/AUDIT-2026-09.md` §4 for why
the old tokens were bypassed; your job is to make bypassing harder than using.

## Contract (in addition to the charter's)

- Start from `origin/main`. `git branch --show-current` before every commit.
  Never push, merge into main, or deploy. Merging `origin/main` INTO your
  branch locally is allowed (it prompts Giorgio). **After any merge, restart
  Metro with `--clear`**: its watcher misses files a merge rewrites, and you'll
  screenshot stale code otherwise.
- No migrations, no backend calls added. No `.from` / `.rpc` /
  `functions.invoke` changes.
- **Don't restyle existing screens.** Screens migrate in Phases 3b/3c. The only
  existing file you may edit is `app/_layout.tsx` (font loading), plus
  `eslint.config.mjs` and `package.json` if needed.
- The old `constants/theme/*` + `constants/Colors.ts` stay untouched and keep
  working. That's a **transitional exception with an end date**: Phase 3c
  deletes them. New code imports only from `constants/tokens`.
- New files get the CLAUDE.md RN-styles eslint header.
- Use the simulator the Orchestrator assigns you, and only that one. Never
  type credentials; ask the Orchestrator if you need a signed-in state (you
  shouldn't: the gallery below is local-only).

## Build

1. **Tokens**: `apps/mobile/constants/tokens/{color,type,space,radius,elevation,motion,index}.ts`
   with exactly the names and values in DESIGN_DIRECTION §9 (nested objects,
   e.g. `color.surface.game.base`). Export types, so `variant` props are
   checked. `motion.spring.lively` lives in `components/sp/game/motion.ts`,
   not in the general export.
2. **Brand**: `apps/mobile/constants/brand.ts` with `brand.name` and
   `brand.wordmark` (currently "Stockpile"; **the name may change**, so nothing
   new hard-codes it) and a `BrandMark` SVG component (refined bars: three equal
   bars, shared baseline, rounded tops, tallest bar in `color.brand`; props
   `size`, `tone: 'onLight' | 'onGame'`).
3. **Fonts**: React Native can't drive Archivo's width axis. Cut static
   instances from the Archivo variable TTF (OFL) with fonttools'
   `varLib.instancer` in a throwaway venv in your scratchpad, not the repo:
   `Archivo-Condensed-Black` (wdth 62, wght 900),
   `Archivo-Expanded-ExtraBold` (125/800), and wdth-100 weights
   400/500/600/700/800. Commit only the TTFs to
   `apps/mobile/assets/fonts/archivo/` with a short `README.md` (source URL,
   licence, exact instancer commands). Load them in `app/_layout.tsx`
   alongside the existing Inter (Inter stays until 3c).
4. **Primitives** in a new namespace `apps/mobile/components/sp/` (leave
   `components/ui/` alone):
   - `Text` with `variant` = every `type.*` token; default colour from the
     surface context (see `Surface`); `maxFontSizeMultiplier` sensible per
     variant; scores never wrap.
   - `Money` (`value`, `size`, `sign: 'auto' | 'always' | 'never'`,
     `colorBySign`, `compact`): tabular-nums, `numberOfLines={1}` +
     `adjustsFontSizeToFit` with a floor, U+2212 minus before the currency,
     zero in `color.data.zero`.
   - `Surface` (`kind: 'money' | 'game'`, `level`): provides a React context so
     `Text` / `Money` pick on-light or on-game colours automatically. This is
     the mechanism that keeps the two registers from mixing.
   - `PressableScale` (scale 0.98 + light haptic, `spring.snappy`), `Button`
     (primary = stadium navy, secondary, ghost, destructive; sizes md/sm; min
     44pt target), `Chip`, `PhaseChip` (visual only; `phase` prop accepts
     `pre_draft | drafting | pre_season | live_open | live_closed | week_final |
     playoffs | season_complete`), `ListRow`, `SegmentedControl`, `Sheet`
     (bottom sheet built on RN `Modal` + Reanimated + the built-in
     `PanResponder`. **Don't add `react-native-gesture-handler` or any other
     native module**: it isn't installed, and a new native module can't ship
     over-the-air, so it would force a new app binary. If you believe one is
     unavoidable, STOP and report), `Avatar`, `EmptyState` (the ONE empty-state pattern:
     icon, title, one line, one action).
   - Game components in `components/sp/game/`: `ScoreDigits` (per-digit roll
     on change only, never on first paint), `TugBar` (you vs opponent ratio,
     clamps, overshoots with `lively` on a lead change), `LiveDot`, `Chyron`
     (slides in, auto-dismisses, announced via
     `AccessibilityInfo.announceForAccessibility`), and `Scoreboard` (composes
     them: league/week line, two teams, tug, lead line).
5. **Motion**: `useMotion()` returns durations, easings and springs already
   reduced when `useReducedMotion()` is true, per the §5 table (translate/scale
   → `quick` crossfade; digit roll → instant; no overshoot). Every animation
   in `components/sp` goes through it, with no inline durations.
6. **Lint**: in `eslint.config.mjs`, error-level `no-restricted-syntax` for
   hex colour literals and numeric `fontSize` **inside `components/sp/**` and
   `constants/tokens/**` users only** (not app-wide yet). Keep the existing
   rules.
7. **Design gallery**: `apps/mobile/app/design-gallery.tsx`, dev-only
   (redirect to `/` when `!__DEV__`). It renders every primitive in every
   state on both surfaces, plus a live Scoreboard demo with a button that
   triggers a lead change. This is your proof and the living spec.
8. **Tests** (`apps/mobile/tests-deno/`, hermetic, same style as the existing
   ones) for the pure logic: money formatting, digit-diff, tug ratio. The
   formatter must produce exactly:

   | input | options | output |
   |---|---|---|
   | 56.8 | sign auto | `+$56.80` |
   | −3000 | sign auto | `−$3,000.00` (U+2212) |
   | 0 | sign auto | `$0.00` (no sign, zero colour) |
   | 1234567.891 | compact | `$1.23M` |
   | −0.004 | sign auto | `$0.00` (rounds to zero, so no sign) |

## Verify, then report DONE

- `npx tsc --noEmit`, `npm run lint`, the new deno tests: all passing, with
  the counts in your report.
- Screenshots to `~/fantasy-stock-design-review/ui-foundation-mobile/`
  (absolute paths in the report): the gallery top-to-bottom on money and game
  surfaces; the gallery at Dynamic Type accessibility-extra-large (nothing
  clips, money never wraps); a **screen recording** of the Scoreboard lead
  change with Reduce Motion OFF and ON.
- Confirm no existing screen changed: before/after screenshots of Home and
  Matchup are identical.

Report your PLAN first and wait for "go". Then DONE or BLOCKED, to both
`Orchestrator` and `Design Lead`.
