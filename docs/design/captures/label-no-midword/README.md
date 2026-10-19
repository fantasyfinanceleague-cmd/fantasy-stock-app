# A label never breaks mid-word (`fix/label-no-midword`)

**Screenshots stay out of the repo (Giorgio, 2026-10-14).** The stills are in
**`~/fantasy-stock-design-review/fix-label-no-midword/`**; this file is the index.

**Ruling (Design Lead, 2026-10-19).** League settings at XXXL broke "Commissioner" into "Com / missi / oner". Rule: no word
in a label ever breaks mid-letter at any size; the label's column does not shrink below its longest word, and whatever does
not fit beside it (a value, a chevron, a switch, a button) wraps to the next line instead.

## What was found (BEFORE, 17e, XXXL)

| Where | Symptom | Still |
|---|---|---|
| League settings, the commissioner's interactive "Commissioner" row (label, value, chevron on one line; only shown with an open leave window, forced on with a dev knob for the capture) | "Commis / sioner" | `cs-transfer-xxxl-light-BEFORE.png` |
| League settings, "Draft time" (interactive: label, long value, chevron) | the label is **gone**: the value and the chevron take the whole row | `cs-p1.png` |
| League settings, member view: the invite code beside Share | "SCUD / 26" (a value, but the same squeeze) | `member-settings-xxxl-light-BEFORE.png` |
| Home, the season-complete card's tiles (two across) | "Seaso / n gain", "Regul / ar season" | seen at XXXL while loading the Renewal fixture |
| The trade review's rows (label `flex: 1` beside a value that never shrinks) | by the model: "Sell" beside "12.5 NVDA · all you hold" is left a few pt at the 1.6x cap | not reachable with fixtures (see below) |
| League settings static rows ("Commissioner" with a name), Join preview, facts card | **fine**: static rows already wrap (the W8 follow-up), the Join rows stack at the accessibility scale and their labels never shrink | |

## The rule, per row

- **`SettingRow` (static, no help line):** always wraps (approved earlier: a value drops to the LEFT under its label).
- **`SettingRow` with a chevron or a help line, and `SwitchRow`:** these keep the layout they always had (a `flex: 1` label beside
  its value / chevron / switch) **until the label breaks inside a word or its column collapses**; only then do they stack (the value
  and chevron, kept together as one wrap item, or the switch, drop under the label; a lone chevron or switch rides to the right
  edge). Detection is on the real device lines (`onTextLayout` lines whose end is not a space or hyphen; a label column under
  12pt), in `lib/game/labelBreaks.ts`. **Why reactive, not "always wrap":** the first version wrapped these rows always, and
  the Large pixel diff showed the Create/League switch dropping under its label at NORMAL size (the help line made the label's
  width the whole row). Reacting to the break leaves every size where all labels fit exactly as it was.
- **Always wrapping** (their labels carry no help line): the invite row (code + Share), the Renewal stepper row, the Renewal
  roster's draft rows, the trade review rows.
- **Home season-complete tiles:** one per row from `FULL_WIDTH_FONT_SCALE`.
- **Unchanged, checked:** the `Stepper` stacks at the accessibility scale already; the Join preview rows and facts card (labels
  never shrink, rows stack); Renewal's own `Row` (already wraps); `ChoiceRow` and the Switch label's hyphen break
  ("Allow non- / draftable") never break inside a word at XXXL.

## Large (17e, light): changed pixels against `origin/main` 586a9598 (the gate: 0)

Same sim, a cold launch per variant, the 6 changed app files swapped for their `origin/main` versions for the base run (served
bundle checked for `labelBreaksMidWord` / `valueWithChevron` / `tileStacked`). The iOS home-indicator strip (the bottom 62px) is
masked: it fades in after touches and is not app content.

| Screen | Changed pixels |
|---|---|
| League tab (League settings row) | 0 |
| League settings, commissioner: top (Pick clock, Draft time, steppers) | 0 |
| League settings, commissioner: bottom (static rows, the interactive Commissioner row) | 0 |
| League settings with a slot added (SlotBuilder's Category row) | 0 |
| League settings, member view (Invite code + Share, Commissioner) | 0 |
| Create league step 4, top (the switch row, unscrolled) | 0 |
| Create league step 4, bottom (the summary rows) | 0 |
| Create league step 3 (Draft time, steppers) | 0 |
| Home, season-complete card (the tiles) | 0 |
| Renewal review, top and bottom (steppers, Stakes) | 0 / 0 |
| Renewal roster (the Draft time / Draft order rows) | 0 |

**Not diffed (scroll offsets are not reproducible between runs, so a mid-page frame cannot be pixel-exact):** the League
settings switch row mid-scroll. The same `SwitchRow` is diffed unscrolled on Create step 4's top (0). Aligned by the best vertical
shift, the mid-scroll frames differ by 258 pixels with a maximum channel difference of 3/765 (resampling at a fractional scroll
offset). **Not captured at all:** the trade review panel (its rows are changed, but the review sheet is not reachable with the dev
fixtures: the stress fixture opens it as "We can't price this stock right now"). It keeps its one-line layout at normal size by
construction (`flex: 1` to `flexGrow: 1; flexBasis: auto`, one line, same gap), and is pinned by the model below.

## XXXL stills (17e), AFTER

Light and dark, on the final code: `XXXL-commissioner-drafttime-{light,dark}.png` ("Draft time" back, its value under it, the
chevron at the right), `XXXL-commissioner-bottom-{light,dark}.png` ("Commissioner / You ›", whole),
`XXXL-member-{light,dark}.png` ("SCUD26" whole, Share dropped under it), `XXXL-roster-draft-{light,dark}.png` (the draft rows
stack), `XXXL-create-drafttime-{light,dark}.png` ("Draft / time" wraps between its words beside "TBD ›": every word whole),
`XXXL-commissioner-switch-light.png` (the switch row keeps its place beside the label: its words break only at a space or the
hyphen). Home's tiles (`x-home-tiles-xxxl-{light,dark}.png`: "Season gain", "Best week", "Regular season", one per row) and the
Renewal review (`x-renewal-b-{light,dark}.png`: the steppers drop under their labels) were shot before the last `SettingRow`
change; neither file has changed since.

## Pins and mutations (Deno)

`tests-deno/label-no-midword.test.ts` (15 tests): a flex-layout model whose parameters are read from the real style blocks
(a label's grow / shrink / basis, whether the row wraps, the gap) and run over the real label strings at every Dynamic Type scale
and several card widths, including the reactive policy (a row starts as it always did and stacks once its label breaks);
negative controls reproduce "Commis / sioner" and the lost "Draft time" with the OLD row, and the trade review's "Sell"; the
season-complete tiles model reproduces "Seaso / n"; `labelBreaksMidWord` / `labelCollapsed` are tested on the lines read off the
device ("Commis", "sioner"; "Draft ", "time"; "Allow non-", "draftable "); the **latch** is pinned on the pure reducer (`nextBrokeAt` / `isStacked`): once a row has stacked, a no-break report at the same text size leaves it stacked (no layout loop), and a different size starts over beside; and every row's styles are pinned. **33 mutants, all
killed** (reset on no-break, i.e. the loop; stacked at any size; label may shrink, `flex: 1` again, no wrap, no alignContent, no trailing margin, chevron leaves its value, always-stack
(the Large regression), never-react, detector ignores spaces / flags hyphens, collapsed threshold 0, the invite, trade, stepper,
roster and tile styles). `keep-money.test.ts`'s `SettingRow` pin was updated.

## Also noticed, not changed

- Home's season-complete card at XXXL: the "See the final standings" row truncates ("See the fi…") and the hero "Champion"
  shows as "Champ…". Truncation, not a mid-word break, and existing; listed for the Design Lead.
- `SettingRow` sizes with the system text size (`fontScale`); an app-level text-size cap would change when rows stack.

## §4 Every tappable element

No tappable element was added; the rows' handlers are unchanged. (`tappables.md` regenerated: 224 tappables, 0 findings.)
