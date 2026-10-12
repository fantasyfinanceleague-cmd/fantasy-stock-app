# `hallmark audit` · W1 "Your call: direction" (Design Lead, 2026-10-12)

The audit the plan requires on every board frame before Giorgio sees it (decision 8c), run
per [`hallmark-notes.md`](hallmark-notes.md): Hallmark's tells, graded critical / major /
minor (mapped to P1 / P2 / P3), on the frame source (`screens/directions.jsx`,
`screens/directions.css`) and on the 18 Dark captures (each frame shot at 1:1 from the built
`key-screens.html`). Read-only first; the fixes below were then made on the branch and the
frames re-captured.

**Scope examined:** A, B and C × Home in season, Matchup live, Matchup final, Draft room on
the clock, League › Standings, Portfolio (18 frames), Dark only; the two "Your call, later"
strips; the 1.1.0 reference. **Not examined:** Light (comes after the pick), XL text,
motion (described, not built), VoiceOver.

## Measured, not eyeballed

- **Contrast (gates 40–41):** 90 text-on-fill pairs (A 32, B 33, C 25) across the three token blocks, WCAG 2.x,
  translucent tints composited over what they sit on. **All ≥ 4.5:1 after the fixes**
  (lowest: B loss on its loss tint, 4.87).
- **Accent by area (gate 23):** pixels within ΔRGB 45 of each role, every frame. Accent ≤ 1.9%
  in every frame after the fix (it was 5.7% on A's draft, see F2). Gain/loss are data roles,
  counted apart: ≤ 2.1%. **B's league band: 12–17%** on Home and Matchup (O1).
- **Tinted neutrals (gate 22):** every surface/neutral token has chroma ≥ 0.004 (A ≥ 0.035, B
  ≥ 0.007, C ≥ 0.005). No pure black or white base (gate 7 as adapted): C's page is
  oklch(9% 0.006 140).
- **Locked tokens (gate 48):** no colour literal in `directions.jsx`; every colour is a
  `--c-*` / `--d-*` role from `directions.css`.

## Fixed during the audit

| # | Sev | Tell (gate) | Where | Fix |
|---|---|---|---|---|
| F1 | critical | Text ≈ fill: the sector pill's ink was light on bright tiles, 1.4–2.9:1 (41) | B, C · Portfolio, centre-column strip | `--d-on-tile` is dark ink in every direction (6.2–13.5:1) |
| F2 | major | The accent's meaning diluted: A's Tech tile blue read as the cyan accent, 5.7% "accent" on the draft frame (23) | A · Draft | Tech tile → periwinkle oklch(81% 0.085 266); accent back to ≤ 1% |
| F3 | major | Text under the 11pt floor: avatar initials scaled to 8.6px at 24px avatars (§9B) | all · Home, Draft | initials floor at 11px |
| F4 | major | Decorative side stripe on a card (5, as adapted: a stripe only as a row's STATE) | B · Draft clock card | full 2pt ring, as the other two |
| F5 | major | Colour the only code: draft tiles said the sector by colour alone (§9B) | all · Draft | sector label in the tile's label row ("Tech"), Sleeper's "WR-DAL" pattern |
| F6 | minor | Column labels wrapped to two lines; a name truncated (49) | all · Standings | caption on its own line; labels nowrap; columns re-cut, "Alessandro D." fits |
| F7 | minor | Tile label overflowed the cell | C · Draft | number left, sector right, one line |

## Open, shown to Giorgio as costs (not fixed: they are the direction)

| # | Sev | Finding | Where | Why it stays |
|---|---|---|---|---|
| O1 | major | The league band floods 12–17% of the frame; on Home it competes with the hero in the squint test | B · Home, Matchup | It IS B (ESPN's frame). The board says so, and that the league colour doesn't exist in the product (a new decision: who picks it, what it is in Light). |
| O2 | minor | When one side wins every pairing (this week does), the whole left column is lit and the slab stops telling rows apart | A · Matchup | Honest data: Roberto wins all six pairings both live and at the close in this sample. On a mixed week the slab lights rows on both sides and answers "who won this row". The category-league frames (added below) show a mixed week: the Consumer group lights Gianluigi's side. |
| O3 | minor | C's accent IS the day's colour, so the selected range pill turns orange-red on a down day: a selected state that changes meaning daily | C · Home, Portfolio | Robinhood does exactly this; flagged for the token spec if C is picked. |
| O4 | minor | The DRAFT pill's visible mark is 34pt tall | all · Draft | Board drawing; the build gives it a 44pt hit area (hitSlop), as §9B requires. |

**Count after fixes:** 0 critical · 1 major · 3 minor.

## Pre-emit self-critique (D1; any score < 3 means revise before showing)

| | Philosophy | Hierarchy | Execution | Specificity | Earned | Variety |
|---|---|---|---|---|---|---|
| A · Game Night | 5 | 4 | 4 | 5 | 4 | 4 |
| B · Broadcast | 4 | 3 | 4 | 4 | 3 | 4 |
| C · Terminal | 4 | 5 | 4 | 3 | 5 | 4 |

- **A:** a clear position (fantasy first, money via Robinhood). Hierarchy loses a point to O2.
- **B:** Hierarchy and Earned at 3 because of O1: the band is loud by design.
- **C:** the cleanest hierarchy, but Specificity is 3: its game screens could belong to any
  brokerage, which is the reason it is not recommended.
- **Variety** (between the directions, not within one): each has a different surface family
  (navy steps / charcoal + band / near-black), a different row separation (slab / panel +
  bar / space) and a different numeral voice (heavy normal / condensed black / regular).

## Reference check (the plan's new gate step)

| Frame | A resembles | B resembles | C resembles |
|---|---|---|---|
| Home | S1 card + S4 line: yes | S3 scoreboard prominence: yes | S4 number + line: yes |
| Matchup | S1 arrangement + the 1.1.0 lit half: yes (minus S1's extra modules, by ruling) | S3 panels, gutter, edge bars, facing numbers: yes (minus S3's slot letters) | S1 arrangement only; the S4 chrome: yes |
| Draft | S2 tiles, dark text, dark clock cell: yes | S2 grid as panels: partly (no ESPN draft reference was studied) | S2 grid reduced to type: partly |
| Standings | S1 space-and-surface: yes | S3 density: yes | S4 space: yes |
| Portfolio | S4: yes | S5 key figures: partly (the hero is B's own) | S4: yes |

## Addendum · the category-league Matchup frames (2026-10-12, after Giorgio's row-order ruling)

Six more frames (A, B, C · Matchup live in a category-slot league and in a price-tier league,
both SAMPLE, the whole scroll), after Giorgio's final ruling (slotted = categories AND price
tiers; order recomputed at each market close, never live). Same audit, same tools:
- **Contrast:** the group header is `--c-text` on `--c-inset` (A 14.79, B 14.26) or
  `--c-text-2` on `--c-bg` (C 8.37): pass. No new colour roles.
- **Typography:** the header is the 11pt tag (floor), line-height ≥ 1.0 (gate 55), one line in
  all three at 402pt ("Tech & Media ×2" is the longest).
- **Decoration with purpose (45):** the header is the position label Giorgio asked for, said
  once per group; nothing else was added. The centre column stays empty.
- **Honest copy (46):** the slot names are invented for this frame and captioned SAMPLE / NEW;
  holdings and numbers are data.js's.
  The tier sample deals data.js's stocks into identical tier slots (tier = draft price, one
  share each); its scores are derived (week gain = Thursday − Monday open: +$24.80 vs +$3.75,
  checked by hand against the frame). Which stocks each manager holds is the only invention.
- **Count:** 0 critical · 0 major · 0 minor. It also gives O2 its mixed week.
