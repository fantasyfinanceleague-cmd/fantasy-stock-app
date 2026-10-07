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
| `portfolio-buyrow-standard-light.png`, `…-standard-dark.png`, `…-xl-light.png` | Re-capture after the row was added (`19e2ba46`): the "Buy a stock" row sits under the slots summary, above Holdings, in Light, Dark and XL text. Predates C-9 (the search-icon tile and accent title, queued) — shown for context, not current. |

## C-4 / C-6 / C-9 — the stock sheet's position card, rolling money, board defects

| File(s) | Proves |
|---|---|
| `portfolio-c9-buyrow-c6-rolling-standard-light.png` | C-9: the "Buy a stock" row with its accent-tint search-icon tile and accent, bold title (`7d02b3e`). C-6: the "since the draft" gain line rolls (shown green, the correct gain tone) alongside the header value. |
| `stock-sheet-c4-position-c9-close-standard-light.png` | C-4: the "Your position" card (Shares, Avg entry, Value, Gain, the latter in gain colour) on a held, priced stock (`5851741`). C-9: the sheet closes with the × icon, not "Done" text. |
