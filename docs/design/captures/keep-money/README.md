# keepMoney: a money amount never breaks inside itself (`chore/keep-money`)

**Screenshots stay out of the repo (Giorgio, 2026-10-14).** The stills are in
**`~/fantasy-stock-design-review/chore-keep-money/`**; this file is the index.

**Ruling (Design Lead, 2026-10-16), the gate rule "a money amount never breaks inside itself".** At XXXL the Renewal
review's Stakes value broke as "$1,000. / 00 a / slot". `keepMoney` (in the `keepDots` family, `lib/game/keepDots.ts`)
puts a word joiner (U+2060) between every glyph of a money amount or signed percent in WRAPPING text, so a line can
end before or after it, never inside it. The unit after it ("a slot", "per slot") still wraps. Display only: the copy and
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
| Renewal review, Stakes row | `S1-renewal-stakes-xxxl-light-BEFORE.png`; `…-light-AFTER.png`, `…-dark-AFTER.png` | BEFORE (committed code): "$1,000. / 00 a / slot". AFTER: "Stakes" then "$1,000.00 a / slot", the amount whole |
| Join preview | `S2-join-preview-xxxl-{light,dark}.png` | rows stack at XXXL; "Equal stakes · / $2,000 per slot" |
| "You're in" facts card | `S3-facts-card-xxxl-{light,dark}.png` | "Equal stakes · / $2,000 per slot" |
| Create-league summary | `S4-create-summary-xxxl-{light,dark}.png` | "Equal stakes · / $1,000 per slot" |
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

## Not captured, and why

- **The trade review panel and the stock sheet's sell summary / Review button at XXXL.** The stock sheet's body has no
  scroll view (`Sheet` is `maxHeight: 90%`, `StockSheetBody` has none), so at XXXL its lower half is clipped and cannot
  be scrolled to: `S6-sheet-clipped-xxxl-light.png`. **That is a separate, existing bug** (the Review button is
  unreachable at XXXL), listed for the Design Lead; it is not changed here. The panel's rows are covered by the unit pin
  with the real strings (its value cell never shrinks, so the amount stays whole).
- The draft-room strip and the draft-complete caption: short captions ("1 of 6 · $2,000 per slot") that sit deep in a long
  XXXL scroll; covered by the unit pin with the real `rosterCaption` strings.

## Also noticed, not touched

- At XXXL the Create-league summary's "Name" and "Stakes" labels disappear when the value is long (the value takes the
  row). Existing layout.
- Not verified here: how VoiceOver reads the zero-width joiners inside an amount (`keepHyphens` already puts the same
  character in the app; the accessibility labels are unchanged plain text).

## Pins and mutations (Deno)

`tests-deno/keep-money.test.ts` (24 tests): the helper's exact output (amounts, signs, percents, compact units, a sentence
period, plain text untouched, idempotence, display-only); a negative control proving the simulator sees the original bug in
the UNJOINED string; and for each of 18 surfaces the file's real strings run through a worst-case line breaker (a break
allowed between any two characters except next to a joiner or no-break space, or inside a word) at every width from 6 to
60, asserting no break falls inside an amount. The exact `keepMoney(` count per file pins every site. **Mutations, all
killed:** the helper as identity; skipping the decimal point; joining digits only (not the sign or `$`); ignoring
percents; `keepMoney` stripped from each of the 16 files in turn; a single site dropped in the stock sheet; the Renewal
row's `flexWrap` removed. Older source-pin tests that named the changed lines were updated to the new wrapped forms.

## §4 Every tappable element

No tappable element was added or changed; this is display text. (`tappables.md` regenerated: 219 tappables, 0 findings.)
