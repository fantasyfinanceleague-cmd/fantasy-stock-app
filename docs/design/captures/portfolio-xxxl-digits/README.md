# Portfolio XXXL digits: isolation, cause, fix (`fix/portfolio-xxxl-digits`)

**The bug (Design Lead, P2, 2026-10-16).** At the largest Dynamic Type size, Portfolio's hero
sub-lines rendered one character spread across the line, e.g. `+ $ 3 4 3 . 5 1 ·`, with the lines
far apart. Reference still: `~/fantasy-stock-design-review/feat-leaguemate-team-view/main-portfolio-baseline-after-xxxl-light-17e.png`.

All frames are outside the repo, in `~/fantasy-stock-design-review/fix-portfolio-xxxl-digits/`.

## How it was captured (headless)

- Two simulators, "W4 Portfolio 17e" and "W4 Portfolio 17 Pro" (iOS 27.0, runtime 24A434, the
  same runtime since 2026-09-03), and Expo Go 54.0.7 (the same build since 2026-09-25).
- Metro on port 8161 with `--clear`. Every configuration is a cold Expo Go launch.
  Stills are `xcrun simctl io … screenshot`.
- The capture seam plays the Matchup fixture's league (Stock Scudetto, Week 6):
  `EXPO_PUBLIC_SHELL_FIXTURE=leagues`, `EXPO_PUBLIC_GAME_SEAM=1`, and
  `EXPO_PUBLIC_SHELL_INITIAL_ROUTE=/portfolio` for Portfolio.
  - Stress = `HOME_FIXTURE=stress MATCHUP_FIXTURE=stress` (the W4 gate's `p11` fixture).
  - The Supabase URL is dead (`127.0.0.1:9`), so nothing is read or written.
- Scripts are in the frames folder: `fx.sh` (env + Metro + launch), `run.sh` (size × theme × device stills), `rec.sh` (recordings).
- Sizes: L = `large`; XL = `accessibility-extra-large`; XXXL = `accessibility-extra-extra-extra-large` (fontScale 3.571).

## Step 1: isolate (an environment change, not a code regression)

| Frame | Build | Shows |
|---|---|---|
| `isolate-w4-8cac3563-portfolio-xxxl-light-17e` | `8cac3563`, the W4 Portfolio PASS merge (#266) | **Spaced**, exactly like main |
| `isolate-w4-8cac3563-portfolio-stress-xxxl-light-17e` | `8cac3563`, the W4 gate's own stress fixture | **Spaced**. The W4 gate shot this fixture clean on 2026-10-13 (`docs/design/captures/gn-w4-portfolio/p11-stress-xxxl-1-17e-light.png`) |
| `before-main-portfolio-{xxxl,xl}-light-17e` | `origin/main` `5a44398a` | Spaced at XXXL **and at XL** |
| `before-main-home-xxxl-light-17e` | `origin/main` | Home's hero sub-line is clean (it has no cap) |

The commit and fixture that passed W4 now render spaced on the same runtime and the same Expo Go.
So there is nothing to bisect in `main`. Nothing on the stack changed version either, so the
difference is in **when** things were measured (next section).

## Cause: a capped Text took its uncapped twin's measurement

Experiments on `main`, Portfolio, XXXL, Light, 17e. Each was a temporary edit, reverted afterwards.

| Frame | Change | Result |
|---|---|---|
| `exp1-nocap-*` | Sub-line RollingMoney without its 1.3× cap | Digits lay out normally |
| `exp2-nobaseline-*` | Rows `alignItems: 'flex-end'` instead of `'baseline'` | Still spaced: alignment is not it |
| `exp3-no-nol-no-fit-*`, `exp4-nol-no-fit-*` | One Text (the first fix) without `numberOfLines` / `adjustsFontSizeToFit` | Same as with them: these props are not it |
| `exp5-home-800-*` | Home's sub-line moved to the 800 face, so it no longer shares Portfolio's 700 face | `+2.86% since the draft` lays out correctly. The `·` (a string Home still draws in that face) still floats |

On iOS, a Text capped by `maxFontSizeMultiplier` got a layout box at the **uncapped** size
(3.57×), while its glyphs drew at the cap (1.3×). It happened when an uncapped Text with the
same string in the same face had been measured first.

Home sits mounted behind the Portfolio tab and draws these strings uncapped in the same 700
callout face:
- the shared strings `+2.86%`, `+$121.27` and `" · "`;
- one Text per digit, so every single glyph (`+`, `$`, `3`, `.`).

That is why:
- **one digit per Text spread worst**: every glyph had a twin;
- **the value line was fine**: no uncapped twin draws it in the `money` face;
- **W4 could be clean on the same code**: it depends on whether Home measured first.

The first fix (one Text above the threshold, the Design Lead's direction) was not enough on its
own. With that build the strings stayed tight, but `+2.86%` and `·` still took Home's tall
boxes. The `v1` build was not kept; the experiment frames above are the record.

## The fix

1. **An engaged cap is an explicit size** (`components/sp/logic/cappedType.ts`). Where the
   system scale is above the cap, the Text gets `fontSize`/`lineHeight` × cap with
   `allowFontScaling={false}`. That is the size iOS drew it at anyway, and it can't take an
   uncapped twin's measurement. Below the cap nothing changes.
   - Applied in RollingMoney's single Text.
   - Applied in Portfolio HeroLine's `·` and words.
2. **The Design Lead's rule: one Text, no roll, at large sizes** (`components/sp/logic/rollDigits.ts`).
   The roll runs only while the variant's cap is not engaged **and** below `LARGE_TEXT_SCALE`
   (1.3, the app's existing large-text line: xxxLarge and every accessibility size).
   - The one Text keeps the same face, alignment and the 0.7 fit floor (`adjustsFontSizeToFit`).
   - Every engaged cap also stops the roll (a tested invariant), so the per-digit path never
     meets an engaged cap.
   - Reduce Motion below the threshold is unchanged: per character, instant swap.

**Every RollingMoney use goes through it:** Home hero (value + sub-line), Portfolio (value +
both sub-lines), and the stock sheet's price. The leaguemate team view is not on `main` (its
#288 was docs only).

## After: gate captures (this branch's app code)

| Files | Shows |
|---|---|
| `after-portfolio-xxxl-{light,dark}-{17e,17pro}` | `+$343.51 · +2.86% since the draft` / `+$121.27 · +0.99% today`, two lines at 1.3×, the value the standout |
| `after-portfolio-stress-xxxl-{light,dark}-{17e,17pro}` | The W4 `p11` frame again: `+$3,518,517.00 · +23.66% since the draft` / `+$493,290.00 · +2.76% today` |
| `after-portfolio-xl-{light,dark}-{17e,17pro}` | The same at XL (it was spaced at XL too) |
| `after-home-xxxl-{light,dark}-{17e,17pro}` | Home unchanged in look (uncapped sub-line); the value is now one Text |
| `after-portfolio-l-*`, `after-home-l-*` | Large: unchanged |

## L spot-check: the roll still works

Recorded with a **temporary, uncommitted** capture patch. It changed the last digit of each hero
figure 14 s after mount (Home: value, gain, %, today; Portfolio: both sub-lines). It was reverted
before the commit.

| Recording / frame strip | Shows |
|---|---|
| `rec-portfolio-bump-l-light-17e.mov`, `…-frames.png` | Large: the changed digits **roll**, mid-roll frames visible. The change spans ~10 frames at 60 fps (≈170 ms). Strip, left to right: 60 fps frames 30, 31, 33, 36, 38, 41 |
| `rec-home-bump-l-dark-17pro.mov`, `…-frames.png` | Large, Home: value + sub-line roll (frames 43, 44, 45, 47, 50, 54) |
| `rec-portfolio-bump-xxxl-dark-17pro.mov`, `…-frames.png` | XXXL: the figures change in **one** frame, in place, the layout steady (frames 24 → 27) |
| `rec-home-bump-xxxl-light-17e.mov`, `…-frames.png` | XXXL, Home: one-frame swap (frames 39 → 42) |

## Tests

- `apps/mobile/tests-deno/rolling-money-large-text.test.ts` covers:
  - the threshold: rolls at L … xxLarge, capped or not; one Text from 1.3 and wherever a cap is engaged; the boundaries; a non-finite scale;
  - `cappedFont` / `cappedTextProps`;
  - "every engaged cap stops the roll";
  - the wiring in RollingMoney and HeroLine;
  - hooks before the branch;
  - the Reduce Motion path unchanged.
- **20/20 mutants killed** (Metro stopped during the run, restored files re-touched; see the trap below).
- `home-calm.test.ts`'s face guard follows the hoisted `fontFamily`.

## A trap worth knowing (cost one round of frames)

A mutation run while Metro was still serving left Metro's file map holding a mutant. The restore
set the file's mtime **back**, and `expo start --clear` did not fix it. Every "after" still from
that bundle was wrong and was discarded.

Before trusting frames, check the shipped code: fetch the bundle from the manifest's
`launchAsset.url` and grep for the function.
