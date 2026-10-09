# ui-mobile-money captures

Design Lead gate evidence for M1 (row→sheet magic move), M2 (chart crossfade),
and the E-1/E-2/E-3 UX-audit states, captured on the iPhone 17e per
`docs/testing/MOBILE_SIMULATOR.md` § "Captures, accessibility settings and
recordings" (`xcrun simctl io … recordVideo` + `scripts/sim/vidtool.swift`).
Numbered files are ordered frames from one recording; a `.mov` is included
only where the raw recording was under ~500 KB (the rest ran long enough —
9–15 s of near-continuous motion from the live dot's pulse — that only the
extracted frames are small).

Taps and typed input in this harness lagged the command that issued them by
several seconds, so none of these were captured by timing a screenshot —
each sequence comes from recording generously, then scanning the whole clip
and diffing consecutive frames to find the real transition.

## M1 — row → sheet magic move

| File(s) | Proves |
|---|---|
| `m1-open-normal-standard-01-rest.png` → `…-04-settled.png` | Normal motion, standard text: the row at rest, the flying tile spawned at the row's own position (opaque white tile over the row), the sheet risen with the chart drawing in, the fully settled sheet. |
| `m1-open-normal-xl-01-rest.png` → `…-03-settled.png` | Normal motion, XL text (the ~4 pt end-jump check): rest → rising → settled. The header lands at the same position as the standard-text capture — no visible end-jump. |
| `m1-open-reduced-motion-standard-01-rest.png` → `…-03-instant-open.png`, `m1-open-reduced-motion-standard.mov` | Reduce Motion ON: the entire ~9 s recording has exactly ONE frame-to-frame change (two consecutive frames at 10 fps, ~100 ms) — closed to fully-settled-with-chart-already-drawn. No tile is ever created, and the live dot doesn't pulse afterward either. |

## M2 — chart range crossfade (1W → 1M)

| File(s) | Proves |
|---|---|
| `m2-crossfade-normal-standard-01-before-1w.png` → `…-03-settled-1m.png` | Normal motion: 1W at rest → a frame mid-crossfade showing BOTH layers superimposed (the old "A week ago $349.76" line fading out, the new "A month ago $315.15" line fading in, together, never a blank chart) → settled on 1M. Confirms the true simultaneous two-layer fade. |
| `m2-crossfade-reduced-motion-standard-01-before-1w.png`, `…-02-instant-1m.png`, `m2-crossfade-reduced-motion-standard.mov` | Reduce Motion ON: one frame transition (1/15 s) from 1W to 1M, label and line swapping together, no blank chart. |

## E-1 / E-2 / E-3 — search screen states (3e UX audit)

Captured with the `search_fail` / `search_delay` dev fixture scenarios
(`EXPO_PUBLIC_MONEY_SCENARIO`), Light and Dark.

| File(s) | Proves |
|---|---|
| `search-fail-standard-light.png`, `search-fail-standard-dark.png` | E-1: a thrown search reads as "Stocks didn't load" / "Check your connection, then try again." / Try again — never a silent "no matches". |
| `search-delay-skeleton-standard-light.png`, `…-dark.png` | E-2: the three-row skeleton, mid-delay (caught via the video + frame-diff method below, since a live screenshot can't reliably land inside a ~900 ms window given this harness's input lag). |
| `search-ownership-standard-light.png`, `…-dark.png` | E-3: all three ownership states in one result list for query "s0" — "You own this" (S001), no suffix / available (S002, S004…), "Owned by Ma…" (S003, S005…). Predates C-2 (own-line, never-truncated ownership text, `4d068f7`) — shown for context, not current. |

## C-10 — Portfolio with the "Buy a stock" row

| File(s) | Proves |
|---|---|
| `portfolio-buyrow-standard-light.png`, `…-standard-dark.png`, `…-xl-light.png` | Re-capture after the row was added (`19e2ba46`): the "Buy a stock" row sits under the slots summary, above Holdings, in Light, Dark and XL text. Predates C-9 (the search-icon tile and accent title, queued) — shown for context, not current. `…-xl-light.png` was overwritten by the X-1 re-capture below (same screen, same state — only the header value's rendering changed), so it no longer shows the row-placement-only state this row describes. |

## X-1 — RollingMoney fit-to-container (Design Lead final check, P0)

The Design Lead's final check blocked on X-1: at XL text, Portfolio's value
clipped its last digit (`$14,446,031.9`, the original `portfolio-buyrow-xl-light.png`).
Fixed in `RollingMoney.tsx` (shared with Home's hero) by measuring the
container and the row's own natural width, then shrinking the row to fit —
see `fix/rolling-money-fit` (`aa3b1ac` + the `alignSelf: 'flex-start'`
correction, `f6e0ab2b`) for the code and its Deno tests.

| File(s) | Proves |
|---|---|
| `portfolio-buyrow-xl-light.png` | Re-capture, same screen as C-10's XL state above: `$14,446,031.99` now renders in full at XL text, shrunk to fit, no clip. |
| `home-hero-million-xl-light.png` | Home's hero (the same `RollingMoney`) at XL with a value of $1,000,000 or more (`$1,234,567.80`, the `xl_million` DEV fixture) — the Design Lead asked for this case specifically, since a fix proven only on Portfolio wouldn't prove the shared component. Re-shot after the scoreboard fix below (Design Lead final re-check, 2026-10-07): the original 12:46 capture predated that fix and still showed the overlap underneath the hero — kept as `home-hero-million-xl-light-before.png` for context, not current. |
| `search-ownership-standard-light.png`, `…-dark.png` | Re-capture at default text size, unrelated to X-1 — confirms C-2 (own-line ownership text) still holds after the merge brought in main's changes since `ui/mobile-money` diverged. |

### A follow-up bug the first re-capture surfaced: the scoreboard overlap

The `home-hero-million-xl-light-before.png` capture above showed a SECOND, separate
bug below the hero: Home's "This week" card (`ThisWeekCard.tsx`) had its two
`ScoreDigits` values ("You" / the opponent) overlapping mid-row at $1M+.
Despite looking like the same shape of bug, it was NOT RollingMoney/X-1 —
`ThisWeekCard` uses `ScoreDigits` (`components/sp/game/ScoreDigits.tsx`), a
sibling component with its own `adjustsFontSizeToFit`-based shrink. Two
layered fixes were needed (`fix/rolling-money-fit`): `ThisWeekCard`'s
`scoreCell` was missing `minWidth: 0` (a flex item's minimum width defaults
to its content's intrinsic size, not 0, so `flex: 1` alone never actually
split the row 50/50), and even after that, `ScoreDigits`' own digit columns
had no `flexShrink` of their own, so a correctly-bounded row still let its
children overflow past it. RollingMoney itself also gained an alignment-aware
`align` prop (left/right/center) as general hardening, proactively, in case
a future screen puts it in an opposing-pair layout — not the cause here, but
cheap to have ready. Every other Home/Matchup/Portfolio surface pairing two
rolling values was grepped and checked: HomeHero's and Portfolio's pairs sit
in `flexWrap: 'wrap'` rows (wrap, never overlap) and `Scoreboard.tsx` stacks
teams in separate rows entirely — both already safe.

| File(s) | Proves |
|---|---|
| `home-scoreboard-million-xl-light.png`, `…-xl-dark.png` | Re-capture after both fixes, at XL text, Light and Dark: "You" and "Gianluigi B."'s scores ($82,210.20 / $11,503.30) sit cleanly side by side, the opponent's hugging its own right edge, never overlapping. |
| `home-scoreboard-million-standard-light.png` | The same screen at default text size — confirms the fix doesn't depend on XL to hold, and nothing regressed at normal size. |

## C-3 — review-sell panel re-capture

| File(s) | Proves |
|---|---|
| `review-sell-standard-light.png` | Re-capture confirming the review panel's side padding against the board, taken from a real tap (not synthetic) on the iPhone 17e, branch tip `2d68f1b9` — the original "flush to screen edge" report did not reproduce; the panel is evenly inset on both sides. |

## C-8 — M5 holdings-reorder FLIP animation

Deferred to Giorgio's device walkthrough. The code is built; this session's
synthetic taps could not reliably drive "Sell S049" (an sp `Button` inside a
Sheet) to complete a sell and trigger the reorder, so no recording exists
yet. Per the Design Lead, M5 is evidence-only — it does not gate the release
on its own.

## C-4 / C-6 / C-9 — the stock sheet's position card, rolling money, board defects

| File(s) | Proves |
|---|---|
| `portfolio-c9-buyrow-c6-rolling-standard-light.png` | C-9: the "Buy a stock" row with its accent-tint search-icon tile and accent, bold title (`7d02b3e`). C-6: the "since the draft" gain line rolls (shown green, the correct gain tone) alongside the header value. |
| `stock-sheet-c4-position-c9-close-standard-light.png` | C-4: the "Your position" card (Shares, Avg entry, Value, Gain, the latter in gain colour) on a held, priced stock (`5851741`). C-9: the sheet closes with the × icon, not "Done" text. |
