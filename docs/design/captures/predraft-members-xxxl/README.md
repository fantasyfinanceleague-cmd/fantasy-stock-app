# Pre-draft Home's Members card at XXXL, on `fix/predraft-members-xxxl`

**Screenshots stay out of the repo (Giorgio, 2026-10-14).** The stills and drivers (`fx.sh`, `shot.sh`, `gate.sh`) are in
**`~/fantasy-stock-design-review/fix-predraft-members-xxxl/`** (`base-*` before, `after/` and `L/` after); this file is the index.

**The bug (Design Lead P2, 2026-10-19).** At XXXL the Members card's header ran "Members" into "6 of 8 joined" and clipped it at the card's right edge
("6 of 8 joine…"), and the dashed "+2" disc clipped its text (`base-predraft-xxxl-light-end.png`).

## What changed (`components/home/PreDraftCard.tsx`)

- **The header wraps.** `sectionHeader` gets `flexWrap: 'wrap'` (with a `columnGap` of 12 and a `rowGap` of 4): the label and its value share a line while they fit,
  and when they don't the value drops under the label, to the left (a wrapped item on its own line starts at the left under `space-between`). The same pattern as the
  label round: no truncation, no shrink-to-fit.
- **The "+N" disc.** Its text takes the chips' own cap (`PLUS_MAX_SCALE = type.tag.maxScale`, 1.4; `PhaseChip` uses the same token) and the disc is a **minimum**
  size (`minWidth`/`minHeight` 36, a little side padding) instead of a fixed 36 × 36 box: at the sizes where "+2" fits it is the same 36pt dashed circle as before; where it
  does not, the disc grows (into a pill) around it and the text never clips. The real avatars keep their fixed 36pt.

## Gate (17e, iOS 27.0, 9:41, dead Supabase URL, game seam fixtures)

Two fixtures: `pre_draft` (no draft time yet) and `pre_draft` + `DRAFT_START_FIXTURE=scheduled` (a draft time set; the countdown card).

| Frames | State |
|---|---|
| `after/predraft-{default,sched}-xl-{light,dark}-end.png` | XL (`accessibility-extra-large`): the header still reads on ONE line ("Members  6 of 8 joined", both whole): it fits, so it does not wrap; "+2" whole in its circle |
| `after/predraft-{default,sched}-xxxl-{light,dark}-end.png` | XXXL: "Members" over "6 of 8 joined", left-aligned, whole; "+2" whole in its dashed circle |

### Large diffs against main (`a75b21d8`): 0 changed pixels

Both builds, same fixtures and timings, light, Large, the top and the scrolled end of each of the two states (`L/`, `pxdiff` logic in the driver): **0 pixels differ in all four
pairs** (every pixel, all channels).

## Not verified

The **Share** button beside the invite code is hidden in both fixtures (`inviteShareShownFor`: only before the hour-before window, and the fixtures' clocks put the draft out of it), so the
invite-code row's own XXXL layout with Share beside the code was not captured. At XXXL the code row (code on its own lines) fits without Share; with Share it is a separate check.

## Tests and checks

- `tests-deno/predraft-members-xxxl.test.ts` (3 tests): the header wraps (row, `flexWrap`, `space-between`, the gaps) and carries no truncation / shrink-to-fit; the "+N" text carries the
  tag cap (the token, and `PhaseChip` uses it); the disc has `minWidth`/`minHeight` 36, no fixed width or height, `borderRadius` 18, side padding and the dashed 1.5pt outline, and is used for "+N" instead
  of the old fixed dashed avatar; the real avatars keep 36.
- **Mutations: 14 of 14 killed, by the test run's exit code** (no wrap; no column gap; a different justify; truncation or shrink-to-fit on the header; the cap constant 3 or the text uncapped; a fixed width or height
  on the disc; no minimum width; not round; no side room; a solid outline; the "+N" back on the fixed avatar style).
- tsc 0, lint 0 errors (8 pre-existing warnings), sourceManifest / tappables / the architecture map regenerated and current, gitleaks clean.
  `cd apps/mobile/tests-deno && deno test --allow-read .`: **2473 passed, 0 failed**.
