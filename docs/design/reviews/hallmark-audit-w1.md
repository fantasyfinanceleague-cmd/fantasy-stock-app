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

## Addendum · Light (2026-10-12, Giorgio: "built for either")

Every W1 frame is now drawn in Light beside Dark: 18 direction frames, 6 slotted Matchup
frames, the comparison row and the two strips. Same tools; Light references are E*TRADE (S5)
and Yahoo (01 draft, 04 live), studied by pixel: an off-white page (`#f0f0f0` ≈ 73% of the
area), white cards, ONE vivid accent (purple `#7020f0`, < 1%) as a filled pill with white ink.

**The rule that changes in Light:** a bright accent has no edge on white, so every accent that
fills a control darkens and carries white ink (A's cyan → deep teal; C's neon → plain green).

- **Contrast:** 96 Light pairs (A 32, B 33, C 31), all ≥ 4.5:1 after the fixes below, and the
  90 Dark pairs re-run: all pass. Your avatar's ring is ≥ 3.76:1 against the page in Dark
  (non-text, 3:1 needed).
- **Accent by area:** A ≤ 2.1%, C ≤ 1.9% per frame. B's band (and its violet, which the
  measure can't tell from B's accent) covers 8–17% of Home, Matchup and the slotted
  Matchups: O1, now in both modes.

| # | Sev | Found in Light | Fix |
|---|---|---|---|
| L1 | critical | B: Light's dark text roles leaked into the violet band ("You lead by …", the This week scores, 0:42 on the band cell) | the band re-points the text, zero, live, track, bg and inset roles to its own inks |
| L2 | critical | B: the opponent's avatar inside the band became white initials on a near-white disc | `--c-inset` inside the band = the lower band shade |
| L3 | major | All: your avatar's initials took the page ink (dark navy on blue in Light) | a `--d-on-you` role, white in every theme |
| L4 | major | Dark, pre-existing (found by L3's new pair): white initials on the you-blue were 3.3–3.6:1 | you-blue darkened to oklch(54% 0.2 258) in Dark: 5.07:1 |
| L5 | major | A: the dark on-the-clock cell's pick number took Light's deep teal (navy on navy) | the cell keeps Dark's cyan for its live text |
| L6 | major | C: sector colours used as text on the light surface and as pill fills failed both (3.4–4.3:1) | darkened to L 47–50%, white pill ink: both uses pass |
| L7 | minor | A: gain green on your blue tint, 4.40:1 | A Light gain darkened to oklch(46% 0.12 165) |

**Count after fixes, Light:** 0 critical · 1 major (O1, B's band, both modes) · 0 minor.

**What each direction loses in Light** (said in its "In Light" line on the board):
- **A:** the cyan's night-time glow; it changes the most between modes but still reads as a
  fantasy app (lit halves, colour tiles, heavy type).
- **B:** nothing structural; the band and its white type are identical in both modes. B is
  the most itself in Light.
- **C:** the neon; on white it is a plain green, and C is the plainest of the three.

**Recommendation:** still A (a fantasy app first, in both modes); B is now named as the
strong alternative if Light matters most.

## Addendum · Game Night as picked + the player card (2026-10-12)

Giorgio picked A, Game Night, with amendments: the draft tiles carry the sector as a line at
the bottom (not a fill), no small lines on rows, the centre column empty; tapping any stock
opens a player card (ESPN model). 16 new frames: A's six screens as amended plus the card
from Matchup (their NKE) and from Portfolio (your NVDA), each in Dark and Light. The direction
call moved to the Archive, still showing the three directions as he chose between them (the
amendments are switched off there).

- **Contrast:** the card's pairs (key figures on the inset strip, the "Yours" pill, the
  sheet's text on its surface): A Dark ≥ 5.78, A Light ≥ 4.90. Pass.
- **Accent by area:** the card adds no accent; the live end dot is the only cyan. Pass.
- **Honest copy (46):** the season line's Friday closes for weeks 1–5 are SAMPLE, captioned;
  the draft price, Week 6's prices, the position, the gain and the pick are data.js's
  ("Drafted 2nd overall · Sep 29 · $290.10" is Giorgio's own example, and it matches).
- **Decoration (45):** ESPN's team-crest watermark is not carried (no logos; it would be
  decoration). The acquisition marker carries information ("Drafted").
- **Typography:** two strip labels wrap onto two lines ("Since the draft", "Their
  position") in the 11pt tag; not tappable (gate 49 is about tappable text), left as is.
- **Fixed:** the card's full-width button overflowed its sheet (the padding added to 100%);
  `box-sizing: border-box`.
- **Flagged to Giorgio, not decided by me:** his list says "season gain" in the key figures,
  his 2026-10-05 rule keeps that term for a manager's regular-season total; drawn as "Since
  the draft".
- **Count:** 0 critical · 0 major · 1 minor (the two-line strip labels).
