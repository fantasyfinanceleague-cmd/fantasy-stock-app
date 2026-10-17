# keepMoney: a money amount never breaks inside itself (`chore/keep-money`)

**Screenshots stay out of the repo (Giorgio, 2026-10-14).** The stills are in
**`~/fantasy-stock-design-review/chore-keep-money/`**; this file is the index.

**Ruling (Design Lead, 2026-10-16), the gate rule "a money amount never breaks inside itself".** At XXXL the Renewal
review's Stakes value broke as "$1,000. / 00 a / slot". `keepMoney` (in the `keepDots` family, `lib/game/keepDots.ts`)
puts a word joiner (U+2060) between every glyph of a money amount or signed percent in WRAPPING text, so a line can
end before or after it, never inside it. The short unit after it ("a slot", "per slot", "a share", "per share") is kept whole with a no-break space
inside the phrase (the way `keepDots` keeps a short segment), so it can drop to the next line but never split as
"a / slot"; the ordinary space between the amount and the unit still breaks. Display only: the copy and
every accessibilityLabel keep their plain text; measurement code keeps the raw string.

**Build.** Every still was taken on this branch's working tree on `origin/main` `162cf1aa`, i.e. BEFORE #289 (the F3 / F4
follow-up) merged, so the Renewal review frames still show the Draft row as "Not set" (#289 changes it to "Pick a draft
time"). That row is not what these frames are about; the Stakes row and the other amounts are unaffected by #289. The
branch is rebased onto `5a44398a` (#289 and #290 in) with `RenewalReview.tsx` merged by hand: its tests, `tsc`, lint and
both suites were re-run on the rebased tree.

## One thing the joiner cannot do alone

A joiner removes the break opportunities; if the column an amount sits in is narrower than the amount, the platform
still breaks it anywhere. The Renewal review's `Row` had `flexShrink: 1` on its value and no wrap, so it needed a layout
change too: `flexWrap: 'wrap'` on the row, so the value drops UNDER its label when it cannot fit beside it (that is the
fixed frame below). Every other surface below already stacked, wrapped, or never shrank the value, so the joiner alone
was enough. (Pinned by the "layout" test in `keep-money.test.ts`.)

## Where it is applied (the grep set; 16 files)

Every money-bearing `<Text>` that can wrap: Join preview rows and the "You're in" facts card (`app/join-league.tsx`),
the Create-league summary, the Renewal review rows, the Portfolio cash / per-slot / buy-row lines, the stock sheet (today
change, position figures, sell summary, warn and reason lines), the trade review panel (label, value, headline, card,
caption), Trade history (detail and total), the sale picker, Stock search's price, the draft-room strip caption and the
draft-complete caption, Home's "You lead by $…", the player card (season caption and "How you got it"), the scoreboard's
lead line, standings gains, and schedule gains. **Left alone, on purpose:** single-line or shrink-to-fit money (the Home
and Portfolio hero numbers via `RollingMoney`, `HoldingRow`, `RosterRow`, the `Scoreboard` totals): `keep-money.test.ts`
pins that those files carry no `keepMoney`.

## Stills (17e, XXXL, Light and Dark unless a row says otherwise)

| Surface | Files | Shows |
|---|---|---|
| Renewal review, Stakes row | `S1-renewal-stakes-xxxl-light-BEFORE.png`; `…-light-AFTER.png`, `…-dark-AFTER.png`; **`S1-renewal-stakes-xxxl-light-v2.png`** | BEFORE (committed code): "$1,000. / 00 a / slot". AFTER: "Stakes" then "$1,000.00 a / slot". **v2 (unit kept whole):** "$1,000.00" / "a slot" / "6 slots", never "a / slot" |
| Join preview | `S2-join-preview-xxxl-{light,dark}.png` | rows stack at XXXL; "Equal stakes · / $2,000 per slot" |
| "You're in" facts card | `S3-facts-card-xxxl-{light,dark}.png` | "Equal stakes · / $2,000 per slot" |
| Create-league summary | `S4-create-summary-xxxl-{light,dark}.png`; `…-light-v2.png`; **`S4-create-summary-xxxl-light-v3.png`, `…-v3-stakes.png`** | "Equal stakes · / $1,000 per slot". v2 (labels kept). **v3 (the final row):** a value that does not fit beside its label drops to the LEFT under it, a two-line value ("Serie A / Traders", "Equal stakes · / $1,000 per slot") reads left, one-line values ("Matchup", "8", "TBD") stay at the right; two frames because the card is taller than the screen |
| Portfolio | `S5-portfolio-top-xxxl-light.png`, `S5-portfolio-facts-xxxl-light.png`, `S5-portfolio-mid-xxxl-light.png` | hero and "$2,000.00 per slot at the draft" whole; holdings stay single-line |
| Stock sheet | `S6-sheet-top-xxxl-{light,dark}.png` | "+$10.11 · +2.94% today"; "+$168,488.00 · / +5.00%"; "$3,538,500.00" whole |
| Trade history | `S7-trade-history-xxxl-{light,dark}.png` | "1 sh at / $145.00": the amount whole, the unit wraps |
| Standings gains | `S10-standings-gains-xxxl-{light,dark}.png` | "+$512.40", "−$142.35" whole |
| Schedule gains | `S11-schedule-gains-xxxl-{light,dark}.png` | "W +$41.30", "L −$96.40" whole |
| Matchup scoreboard | `S12-matchup-xxxl.png` | "Roberto B. leads by $123.15" |
| Player card | `S13-player-card-top.png`, `S13-player-card-how-xxxl-{light,dark}.png` | "$290.10 → $318.37"; "Drafted 2nd overall · / Aug 31 · $290.10" |
| Stock search price | `S14-search-price-xxxl-{light,dark}.png` | "$132.30" whole |

**Large-size spot-check (nothing changed at normal size).** Cold launches, pixel-diffed: the Join preview with and without
`keepMoney` (`L-join-preview-{on,off}.png`) and the Renewal review's committed code against this change, layout included
(`L-renewal-{HEAD,on}.png`): **0 differing pixels** in both.

**Large, 17e, light, `origin/main` `3a1e3e85` against this branch (the shared `SettingRow` check; `L-ab/`).** One sim,
cold launch per variant, the 18 changed app files swapped for their `3a1e3e85` versions for the base run (served bundle
checked for `keepMoney` / `settingRowWrap`). **Final changed pixels: 0 on every screen:** Create-league summary; League
settings (commissioner view) top, bottom (Type, Season, Playoff teams, Commissioner) and the SlotBuilder with a slot added;
League settings' member view (its static Commissioner row); the League tab's League settings row; the Renewal review (it
does not use `SettingRow`; unchanged by the later tweaks, 0 / 0 at the previous commit). The pressable rows (League
settings, Draft time, Category) keep the old layout path.

Two real differences were found by this diff and fixed, which is why it is worth keeping: (1) the wrap made every static
row's text sit about 1pt high (19,426 pixels on the Create summary): a wrapping row's lines hug the top
(`alignContent` flex-start) where the one-line row centred in `minHeight: 44`; fixed with `alignContent: 'center'`.
(2) `textAlign: 'left'` on the value (to make a stacked value read left) moved the one-line values about 1px (6,893
pixels): the box is rounded up to the pixel grid, so left-aligned glyphs sit off its right edge; fixed by leaving
one-line values right-aligned and switching to left only when `onTextLayout` reports several lines. Both pinned and
mutated. One League-tab diff of 1,978 pixels (avatar and two tab labels) was an artefact of the first base shot, not
code: re-shooting base gave 0 against the new code, and the two base shots differ from each other by the same 1,978.

## Not captured, and why

- **The trade review panel and the stock sheet's sell summary / Review button at XXXL.** The stock sheet's body has no
  scroll view (`Sheet` is `maxHeight: 90%`, `StockSheetBody` has none), so at XXXL its lower half is clipped and cannot
  be scrolled to: `S6-sheet-clipped-xxxl-light.png`. **That is a separate, existing bug** (the Review button is
  unreachable at XXXL), listed for the Design Lead; it is not changed here. The panel's rows are covered by the unit pin
  with the real strings (its value cell never shrinks, so the amount stays whole).
- The draft-room strip and the draft-complete caption: short captions ("1 of 6 · $2,000 per slot") that sit deep in a long
  XXXL scroll; covered by the unit pin with the real `rosterCaption` strings.

## Also fixed in this branch (Design Lead PASS follow-up, 2026-10-16)

- **The short unit stays whole** (`keepMoney`, see the ruling above): `a slot`, `per slot`, `a share`, `per share` are
  glued with a no-break space only when they directly follow an amount; "a slot" in plain prose ("Optional: a slot
  can…") and "a slots" are untouched.
- **A label is never dropped.** At XXXL the Create-league summary lost its "Name" and "Stakes" labels: `SettingRow`'s
  label block was `flex: 1` (basis 0, so it can never wrap) and the long value took the row. A static row (no
  `onPress`, no chevron) now uses the same fix as the Renewal review: `flexWrap: 'wrap'` with `justifyContent:
  'space-between'`, the label block `flexBasis: 'auto'`, so the value drops UNDER its label, at the LEFT (a lone item on
  a line starts at the start), when it cannot sit beside it; beside the label it stays at the right edge. A value that
  runs to several lines reads left (`onTextLayout`); a one-line value keeps its right alignment, which is the same pixel.
  `SettingRow` is shared, so the League tab, league settings' static rows and `SlotBuilder` get the same behaviour;
  pressable rows (with the chevron) keep the old layout. At normal size nothing moves.

## Also noticed, not touched

- Not verified here: how VoiceOver reads the zero-width joiners inside an amount (`keepHyphens` already puts the same
  character in the app; the accessibility labels are unchanged plain text).

## Pins and mutations (Deno)

`tests-deno/keep-money.test.ts` (27 tests): the helper's exact output (amounts, signs, percents, compact units, a sentence
period, plain text untouched, idempotence, display-only); a negative control proving the simulator sees the original bug in
the UNJOINED string; and for each of 18 surfaces the file's real strings run through a worst-case line breaker (a break
allowed between any two characters except next to a joiner or no-break space, or inside a word) at every width from 6 to
60, asserting no break falls inside an amount. The exact `keepMoney(` count per file pins every site. **Mutations, all
killed:** the helper as identity; skipping the decimal point; joining digits only (not the sign or `$`); ignoring
percents; `keepMoney` stripped from each of the 16 files in turn; a single site dropped in the stock sheet; the Renewal
row's `flexWrap` removed. **Added with the follow-up (9 more, all killed):** the unit glue dropped; the glue applied to
a bare "a slot" in prose; the glue widened to any following word; the amount-to-unit space glued too; the unit glue
applied to percents; `SettingRow`'s `wraps` gate removed; `settingRowWrap`'s `flexWrap` removed; `growWrap`'s
`flexBasis: 'auto'` back to `flex: 1`; the value's `marginLeft: 'auto'` removed. Older source-pin tests that named the changed lines were updated to the new wrapped forms.

## §4 Every tappable element

No tappable element was added or changed; this is display text. (`tappables.md` regenerated: 219 tappables, 0 findings.)
