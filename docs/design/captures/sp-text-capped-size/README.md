# The sp Text primitive applies an engaged cap as an explicit size (`fix/sp-text-capped-size`)

**The Design Lead's P2 (2026-10-19).** The Portfolio XXXL digits bug
(`docs/design/captures/portfolio-xxxl-digits/`) is not specific to RollingMoney. Any
`Text` with a Dynamic Type cap can be laid out with the wrong box on iOS. So the sp `Text`
primitive now does what RollingMoney does: **once the cap is engaged (fontScale > cap) the capped
size is explicit** (`fontSize`/`lineHeight` × cap, `allowFontScaling={false}`). Below the cap
nothing changes: native scaling under `maxFontSizeMultiplier`, as before.

All frames, scripts and recordings are outside the repo, in
`~/fantasy-stock-design-review/fix-sp-text-capped-size/`.

## What changed

- `components/sp/Text.tsx` reads `useWindowDimensions().fontScale` and applies
  `cappedSpText` (`components/sp/logic/cappedType.ts`).
  - The size it replaces is the caller's own `fontSize`/`lineHeight` when its style overrides them, else the variant's.
  - The cap is the prop or the variant's own (`maxFontSizeMultiplier ?? type.*.maxScale`).
  - A caller that set `allowFontScaling={false}` keeps it off and gets no cap (nothing to cap).
  - `allowFontScaling` is read out of `rest`, so the spread can't override the cap.
  - The capped size is applied AFTER the caller's style, on both render paths (`RNText` and `Animated.Text`).
- `cappedType.ts`: **letterSpacing is not scaled any more.** iOS scales only the font and the line
  height (`RCTAttributedTextUtils.mm`: the multiplier feeds the font and `lineHeight`;
  `NSKernAttributeName` takes `letterSpacing` as given). Scaling it would make the explicit size
  differ from the native one it replaces. RollingMoney passes no letterSpacing, so it is unaffected.
- Raw RN Texts that sit outside the primitive (inventory below) now go through `cappedTextProps` too.
- Portfolio's HeroLine goes back to plain `maxFontSizeMultiplier` props: the primitive does the rest.

### Every place that sets a cap on a Text (the inventory)

Scanned over `app/`, `components/`, `lib/` (`.tsx`): 171 sp `Text` elements set the prop, and 11
token variants (`hero`, `money`, `score.*`, `tag`, `display`, …) cap through the primitive with no
prop at all. Beyond those, **every raw
`react-native` Text that sets a cap**:

| File | Raw Text | Decision |
|---|---|---|
| `components/sp/Text.tsx` | the primitive itself (`RNText` + `Animated.Text`) | now applies the explicit size |
| `components/home/RollingMoney.tsx` | the roll's `DigitColumn`; the one-Text branch | roll path: the cap is never engaged there (`rollsDigits`); the one-Text branch already had it (unchanged) |
| `components/sp/PhaseChip.tsx` | the chip's tag | **routed through `cappedTextProps`** (deliberately not built on `<Text>`: its own face and ceiling) |
| `components/sp/game/ScoreDigits.tsx` | one Text per digit | **routed through `cappedTextProps`** (the shape most exposed to a twin: every digit matches another) |
| `components/money/TradeHistoryScreen.tsx` | `FlatList` carries a `maxFontSizeMultiplier` prop | not a Text; its children are sp Texts (covered) |

`TextInput`s set no cap. A source guard (`sp-text-capped-size.test.ts`, "inventory") fails if a new
raw RN `Text` file names `maxFontSizeMultiplier` outside these four.

Nested Texts inherit `allowFontScaling` from their parent. The not-engaged branch sets it to `true`
explicitly, so a Text nested in an engaged parent keeps scaling. The nine nested pairs in the app
(`create-account`, `login`, `GetStarted`, `DraftDateSheet`, `DraftLobby`, `ThisWeekCard`,
`PlayerPortfolioScreen`, `StockSheetBody`) all use the same variant and the same cap on both
levels, so engaged parent and child agree. A nested Text with a different cap than its parent
would be a new case to check.

## How it was captured (headless)

- Two simulators, "W4 Portfolio 17e" and "W4 Portfolio 17 Pro" (iOS 27.0, Expo Go 54.0.7), Metro on ports 8162 (main) and 8163 (this branch) with `--clear`; stills by `xcrun simctl io … screenshot`.
- Fixtures: `SHELL_FIXTURE=leagues GAME_SEAM=1` (the Matchup fixture league), a dead Supabase URL. `HOME_FIXTURE=live_closed` where noted (every end dot static).
- **A temporary, uncommitted tour patch** (`tour-on.sh`; reverted after every run, and checked before the commit) added
  `EXPO_PUBLIC_TAB_TOUR="name@ms,…"` to `app/(tabs)/_layout.tsx` so the tabs open in a chosen order, with a still taken at each stop.
  Tabs are lazy, so the order they first open in is the order they are first measured in.
- A launch that sticks on Expo Go's splash is relaunched once the probe shot shows it (`shots.sh`); frames under 150 KB would be splash and none were kept.
- Baseline = `origin/main` `a75b21d8` in its own worktree; "after" = this branch.

## Gate 1: L, pixel diffs vs main (the cap is not engaged at Large)

The status-bar band (`y < 170` px: the clock, and the Dynamic Island, which the simulator draws in some frames only) is excluded.

| Set | Frames | Changed pixels |
|---|---|---|
| **Four tabs, live_closed fixture (every dot static)**: Light + Dark × 17e + 17 Pro | 16 | **0** in every frame |
| **Stock sheet (NVDA), live_closed**: Light + Dark × 17e + 17 Pro | 4 | **0** in every frame |
| Four tabs, default (live) fixture: Light + Dark × 17e + 17 Pro | 16 | League and Matchup: **0**. Home and Portfolio: only the live end dot's pulse (a ~48 × 48 px cluster at the chart's end dot, and one at the W/L strip's last dot): 1.5–2.9 K px |
| Stock sheet, default fixture | 4 | only the chart's live end dot (a 52 × 52 px cluster): 1.6–1.9 K px |

The pulse is not ours: **main against main (same frames, re-shot) differs by the same clusters**: Home 2848 px, Portfolio 190 px (a pulse's phase at the moment of the shot). That is why the closed fixture is the strict proof.

(`*-closed-*`, `*-sheetclosed-*`, `*-tourA-*-l-*`, `*-sheet-*`; `main-tourA-rerun-*` is the noise run. In the two Dark default-fixture sets the tour reached the next tab one stop later on main than on the branch, so those were paired by content.)

## Gate 2: XXXL, the tab screens opened in different orders (17e, Light)

Four orders, so the "which Text was measured first" lottery is tested on purpose. Each is four stills,
one per stop; a `before-after-<order>-xxxl-light-17e.png` sheet puts main on top, this branch below.

| Order | Stops |
|---|---|
| A | Home → Portfolio → League → Matchup |
| B | Portfolio → Home → League → Matchup |
| C | Matchup → Home → Portfolio → League |
| D | League → Matchup → Home → Portfolio |

(`endA`/`endB` repeat A and B with every tab scrolled to its end, so the lower halves are seen too.)

### Before (main): what was spaced or mis-sized

- **No spaced digits in any order** on Home, Portfolio and League (the #292 fix holds in every order: 4 orders × 3 tabs, plus the scrolled sets).
- **The Matchup Scoreboard is mis-sized in every order.** The two names ("Roberto B.", "Gianluigi B.") are laid out in a **35.33 pt-tall box** while they are drawn at the **1.3×** cap: a box for 1.6×. That puts **6.67 pt of extra space** between the names and the totals, and it pushes everything below it down by the same amount.
  - The cause is the same one: the name's cap is *computed* (`scoreboardNameCap`: 1.6× beside the avatar, ≤ 1.3× stacked), so it starts at 1.6 on the first layout pass and drops to 1.3 once the name is known to be stacked. iOS keeps the first measurement.
  - Per-Text layout logs (`onLayout`, native vs explicit, same code otherwise): `body "Roberto B."` height 35.33 → 28.67 and width 122.0 → 99.3 (= 22 × 1.6 and 22 × 1.303).
- Smaller: every `ticker` row on Matchup (cap 1.6) is **32.33 pt** tall on main and **32.00 pt** now. 20 × 1.6 is exactly 32; the native path multiplies in single precision and the layout rounds up to the next third of a point. About one device pixel per roster row (the scrolled-to-end frames show 4 px at the top of the list falling to 1 px at the bottom).

### After (this branch)

- Home, Portfolio and League: **identical to main** in all four orders apart from the live dots' pulse (clusters ≤ 2.4 K px) and one 248 px sub-pixel antialiasing difference on the "M" of the tab bar's "Matchup" label.
- Matchup: the Scoreboard and the roster rows read as above: names 6.67 pt tighter against their totals, rows ~0.33 pt shorter. **This is the one visible change, and it is a correction** (it makes the layout the cap's own arithmetic says it is); it is flagged for the Design Lead rather than assumed.
- The XXXL frame differences, all orders (`clusters.py`): Matchup 271 837 px (= the 20 px shift), everything else ≤ 2.4 K px.

### An experiment that was a trap, not a finding

An early "native" comparison run showed huge avatar initials. That was my own temporary switch dropping the caller's `allowFontScaling={false}` (the Avatar sets it). Main does not do it (orders A–D show correct avatars). The shipped primitive keeps a caller's `false` (tested).

## Tests and mutations

- `tests-deno/sp-text-capped-size.test.ts` (11): capped size when engaged (variant cap and prop cap), untouched below the cap and at the cap exactly, no cap → never explicit, a non-finite scale never engages, the caller's own `fontSize`/`lineHeight` are what the cap multiplies, `allowFontScaling={false}` stays off, every capped token variant engages at XXXL and is native at Large, the primitive's wiring (both render paths, after the caller style, `allowFontScaling` read out of `rest`), the PhaseChip and ScoreDigits wiring, and the inventory guard.
- `rolling-money-large-text.test.ts`: letterSpacing is not scaled; HeroLine keeps its cap as a prop.
- **20/20 mutants killed** (Metro not serving the tree while mutating; each restore re-touched).
- tsc 0, lint 0 errors (8 warnings, as main), mobile tests green, architecture map and `tappables.md` regenerated (line shifts only), gitleaks clean.

## Traps worth keeping

- `git checkout <file>` to drop a temporary capture hack also drops every uncommitted edit in that file. The primitive's edits were lost once this way and re-applied; **commit the work before any capture hack, and undo a hack by copying a saved good file back.**
- A capture hack that fakes "native" mode has to honour the caller's `allowFontScaling`, or it creates bugs main does not have.
