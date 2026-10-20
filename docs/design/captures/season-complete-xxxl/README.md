# Home's season-complete card at XXXL, on `fix/season-complete-xxxl`

**Screenshots stay out of the repo (Giorgio, 2026-10-14).** The stills and drivers (`fx.sh`, `shot.sh`, `lh.sh`, `lx.sh`) are in
**`~/fantasy-stock-design-review/fix-season-complete-xxxl/`** (`base-*` before, `after/` and `L/` after); this file is the index.

**The bug (Design Lead P2, 2026-10-19).** At XXXL, Home's season-complete card truncated: the "See the final standings" row read "See the fi…" and the
hero line "Champion" read "Champ…" (`base-complete-xxxl-light-top.png`). Two different causes:
- the row is a `ListRow` whose title was `numberOfLines={1}` (and body-sized text, uncapped: 45pt at XXXL);
- "Champion" is `score.lg` (never-wrap) at a **2.4×** ceiling: 67pt, wider than the card.

**The Design Lead's rules.** A button label never truncates (it wraps, or the button takes the width). "Champion" is a tag: cap it at the chips' own multiplier so it
shows whole. Check the other season-complete states and any other Home button.

## What changed (3 source files)

| File | Change |
|---|---|
| `components/home/SeasonCompleteCard.tsx` | `HERO_MAX_SCALE = type.tag.maxScale` (1.4, the chips' own: `PhaseChip` uses the same token) on both hero lines, replacing the 2.4×. The line under the hero is capped at `SUBTITLE_MAX_SCALE = 2` (see "Decision for the Design Lead"). A non-participant's champion **name** wraps (`numberOfLines={0}`) instead of truncating. The row passes `wrapTitle` |
| `components/sp/ListRow.tsx` | New `wrapTitle` prop: the title drops its single-line limit and takes a Button label's ceiling (`BUTTON_ROW_MAX_SCALE = type.headline.maxScale`, 1.6). Data rows (names, standings) keep their single line: the default is unchanged |
| `components/sp/Button.tsx` | The label Text lost `numberOfLines={2}` and `ellipsizeMode="clip"`: a third line was silently clipped. A label now wraps as far as it needs (the button grows). Applies to every Button; at Large no label wraps beyond two lines, so nothing moves |

## Gate

17e, iOS 27.0, status bar 9:41, a dead Supabase URL, the game seam fixtures. XL = `accessibility-extra-large`, XXXL = `accessibility-extra-extra-extra-large`.

### Season-complete at XL and XXXL, both themes (`after/`)

| Frames | State |
|---|---|
| `complete-{xl,xxxl}-{light,dark}-{top,end}.png` | champion: "Champion" whole in the hero (the gold medallion, the tag above it); the tiles; "See the final standings" whole on one line at the bottom |
| `complete_runner_up-{xl,xxxl}-{light,dark}-{top,end}.png` | runner-up: "2nd place" whole, the neutral medallion; the same row |
| `eliminated-xxxl-light-{top,end}.png`, `honest-minimum-xxxl-light-{top,end}.png` | the eliminated variant (the Playoffs tile reads "1–1 · lost in the Wild card", whole) and the no-result fallback (rank, record and gain only). Captured under a **temporary local patch** of the dev fixture (`useSeasonResult`), reverted before the commit: no fixture reaches them. The patched headline ("1st place") is the patch's artefact, not a product state |

### Other Home buttons at XXXL, light (`after/`)

`pre_draft-xxxl-light-{top,end}.png` ("Set draft time", "Build your queue"), `drafting_on_clock-…` and `drafting_waiting_turn-…` ("Go to the draft room"): every
label whole (they are `Button`s, which now wrap). The only other Home buttons (`Share`, `See who's in`, `Run it back`, the phase-message action) are the same `Button`.

### Large diffs against main (`a75b21d8`): 0 changed pixels of app content

Both builds, same fixtures, same timings, light, Large; every pixel compared (`pxdiff` logic in `lh.sh`). States: `complete`, `complete_runner_up`, `pre_draft`,
`drafting_on_clock`, `drafting_waiting_turn`, each at the top and scrolled to the end.

| State | Result |
|---|---|
| runner-up top/end, pre-draft top/end, champion end | **0 pixels differ** |
| champion top | 6,218 px, all in one 27 × 429 px strip at the very bottom of the frame: the **iOS home indicator** (its gradient follows what composites behind it), not app content |
| drafting (on the clock / waiting) top/end | ≤ 1,036 px, all in one ~35 px box: the pulsing live dot of the "Drafting" chip (an animation) |

## Decision for the Design Lead (A/B), and a finding

**The subtitle under the hero.** Capping the hero at the chips' 1.4× makes the title 39pt. The line under it ("You won Summer Cup") was uncapped: 13pt × the
system's 3.1× = 40pt at XXXL, bigger than its own title (the S3 rule from the 2026-10-05 gate, the very defect S3 fixed). I tried three things:
(1) subtitle uncapped: larger than the title (`after/after-complete-xxxl-light-top-subtitle-uncapped.png`, in the working folder);
(2) subtitle capped at the chips' 1.4×: 18pt, clearly subordinate but small;
(3) **chosen: 2×** = 26pt, readable and below the title. The S3 rule is now pinned as arithmetic (the subtitle is at most 80% of the title, and at least 1.6× growth).
If the Design Lead prefers (2), or a different multiple, it is one constant (`SUBTITLE_MAX_SCALE`).

**Finding, not touched (not a button):** the pre-draft Home's "Members · 6 of 8 joined" line is clipped at the card's right edge at XXXL ("6 of 8 joine…"),
and the dashed "+2" chip's text is clipped (`after/pre_draft-xxxl-light-end.png`). Worth its own round.

## Tests and checks

- `tests-deno/season-complete-xxxl.test.ts` (5 tests): the hero cap is the tag token's (and `PhaseChip` uses it), both hero lines carry it, no 2.4× is left, a champion name wraps;
  S3 as arithmetic; the row opts into `wrapTitle` and `ListRow` honours it at the Button label's ceiling while data rows keep one line; no `numberOfLines` / `ellipsizeMode` /
  shrink-to-fit on the Button label and no `ellipsizeMode` anywhere under `components/home/`; every Home `ListRow` button row wraps.
- **Mutations: 14 of 14 killed, by the test run's exit code** (the hero back at 2.4× or the constant 2.4; a champion name that no longer wraps; the subtitle uncapped, at 3× or squeezed to 1.2×;
  the row without `wrapTitle`; `ListRow` ignoring it, uncapped, or capped at 3×; `numberOfLines` or `ellipsizeMode` back on the Button label; an `ellipsizeMode` on a Home text; data rows losing their single line).
  One mutant survived the first version of the S3 pin (a 3× subtitle, equal to the title); the pin was tightened to "at most 80% of the title" and it dies.
- One older exact-string guard was updated for the new prop (`home-calm`: the row's source line now includes `wrapTitle`); what it pins (a row with a chevron, no filled button) is unchanged.
- tsc 0, lint 0 errors (8 pre-existing warnings), tappables / sourceManifest / the architecture map regenerated and current (line numbers moved), gitleaks clean.
  `cd apps/mobile/tests-deno && deno test --allow-read .`: **2475 passed, 0 failed**.
