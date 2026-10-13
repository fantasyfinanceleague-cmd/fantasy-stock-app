# gn-w4-matchup captures (recaptured on the final build)

W4 gate evidence for **Matchup + the player card**, re-shot in full on the final build of
`feat/gn-w4-matchup` after the DL's BLOCK and Giorgio's four calls (#call-mx-order / -empty /
-bye / -withheld, B on each). Every state is in **both themes** (`-light` / `-dark`), unless
a row says otherwise.

**How it was captured:** the simulators "W4 Matchup 17e" and "W4 Matchup 17 Pro" (iOS 27.0),
Expo Go, Metro on port 8097. Each fixture switch is a COLD launch (Expo Go terminated, then
reopened), so there's no dev chrome: no "◀ Safari" breadcrumb, and no reload toast (that toast
was a real unhandled splash-screen rejection, now handled). Fixtures come from
`apps/mobile/.env.local`, with every var written explicitly each time:
- `EXPO_PUBLIC_SHELL_FIXTURE=leagues` and `EXPO_PUBLIC_GAME_SEAM=1`;
- `EXPO_PUBLIC_HOME_FIXTURE` (the week's state);
- `EXPO_PUBLIC_MATCHUP_FIXTURE`: unslotted, category, tiers, bought, or stress;
- `EXPO_PUBLIC_SCORED_OUTCOME`: won, lost, or withheld.

The fixture clock is Thursday Sep 24, 1:37 PM ET (week 6) unless a row says otherwise.
Large = `large`; XL = `accessibility-extra-large`.

## Matchup

| File | State | Shows |
|---|---|---|
| `17e-large-live-leading` | live, you lead | Scoreboard: names on ONE line ("Gianluigi B." beside its avatar at 17e Large), totals, "Roberto B. leads by $123.15". Then **"Ordered by Wednesday's close"** (#call-mx-order), and the mirrored rows best-first at Wednesday's settled close. The centre is empty and no row is lit. |
| `17e-large-live-behind` | live, behind (`leader_flip`) | "Gianluigi B. leads by $7.54", with YOUR half still shaded. The opponent's rows are priced at Thursday (no $0.00 rows). |
| `17e-large-live-update-before/after-light`, `rec-live-update-rows-hold-light-frames` | a pull-to-refresh fetch while you look (`leader_flip`) | Pixel diff of before vs after: the scoreboard and the row numbers changed, and both ticker columns stayed still. |
| `17e-large-after-thu-close-reordered` | `live_closed` (Thu 8:00 PM ET) | **"Ordered by Thursday's close"**: Thursday settled at 8 PM, so the rows re-read Thursday's closes. |
| `17e-large-monday-before-first-close` | `monday_preclose` | Every gain $0.00, draft order by pick, **no label**. |
| `17e-large-category-empty-slots-top`, `…-category-scrolled` | category slots | TECH · RETAIL ×2 · FINANCE · FLEX ×3, best-first within each. **An open slot is a dashed edge with "Empty"** on either side (#call-mx-empty): Gianluigi's Tech slot and your second Retail slot. |
| `17e-large-tier-league-top`, `…-tier-league-scrolled` | price tiers | $200 OR MORE ×5 · $100–$200 ×2 · UP TO $100 ×2, with dashed "Empty" slots on both sides. |
| `17e-large-midweek-sale-and-buy` | `bought`: V sold Tue, MSFT bought Thu | MSFT (bought after Wednesday's close) sits after every held number. Unslotted, so the unmatched half is plain space, not "Empty". |
| `17e-large-final-won-category`, `rec-final-reveal-won-category-light.mov` + `-frames` | final, won | FinalBanner (the one-time reveal), "won by $390.67", and the same grouped rows. |
| `17e-large-final-lost-with-rows` | final, lost (item 7) | "Gianluigi B. wins Week 6 · L · 4–2", and the rows **reconcile** because your week is mirrored (−$351.79). |
| `17e-large-final-withheld` | `SCORED_OUTCOME=withheld` | **"Stock-by-stock results aren't available for this week."**, then both lineups as ticker + company with no figures, in draft order, your side shaded (#call-mx-withheld). |
| `17e-large-bye-my-matchup` | bye | Your half (+$213.60), **"Bye week"** in theirs, "Bye week · no result", then your stocks in ONE column under the same order rules and label (#call-mx-bye). |
| `17e-large-all-matchups-with-byes` | All matchups on a bye week (item 5) | Each bye is the team plus "Bye week · no result"; never a nameless "?" opponent and never a "leads by". |
| `17e-large-all-matchups` | All matchups, final | Only your game shades your half. |
| `17e-large-playoffs-live` | a playoff week | The same page. Draft order, because the playoff week's first close hasn't settled on the fixture clock. |
| `17e-xl-stress-million-longest-names` | XL + stress (≥ $1M, the longest company names) | Names stack under the avatars. The leads-by line and the unpriced note are capped at 1.3×, so the totals stay loudest (item 2). Stacked halves carry both numbers on the outer edge, and the gain is larger than its percent (item 3). |
| `17pro-large-category-live`, `17pro-xl-stress` | 17 Pro, Large and XL | The same page on the wider phone. |

## The player card

| File | State | Shows |
|---|---|---|
| `card-yours-sell-enabled` | yours, market open | Three figures; a season line from its own seeded path; this week moving every day; Sell; "HOW YOU GOT IT" in its inset panel. |
| `rec-card-sell-to-stock-sheet-dark-frames`, `stock-sheet-after-sell` | the Sell tap-through (item 8) | The card leaves, and the **real stock sheet** rises: Your position, Buy \| Sell with Sell selected, "Sell all 6.8942 sh ≈ $2,194.91", "Review sell". |
| `card-yours-market-closed` | `live_closed` | Sell disabled, with "Market's closed. Opens Fri 9:30 AM ET." beside it. The week line ends at Thursday's close. |
| `card-theirs-no-watchlist` | theirs | "Owned by Gianluigi B." with a one-initial "G" disc, and "HOW THEY GOT IT". No Save: there's no watchlist (accepted). |
| `card-theirs-category-pill`, `17pro-card-theirs-category` | category league | The "Retail" pill. |
| `card-yours-tier-pill` | tier league | The "$100–$200" pill. |
| `card-bought-today-msft` | MSFT bought Thu 10:05 AM (item 6) | "Bought · Sep 24 · $412.30", "Since Sep 24". The week line **starts at the buy** (Thursday, $412.30) and the week figure equals MSFT's row (+$32.64). The season line is one dot at the right end, with the dashed base at the buy price. |
| `card-monday-week-one-point` | Monday before the first close | The week is one dot at Monday's open on the full Mon…Fri axis, at $0.00. |
| `card-xl-top`, `card-xl-scrolled` | XL, stress | The figures stack. The "Yours" pill and the "How you got it" panel hug their text (item 4). Week +$287,268 and since-the-draft +$529,692 are coherent. |
| `rec-card-sheet-rises-dark-frames` | normal motion | The sheet **rising** (5 frames) as the lines draw in. |
| `rec-card-reduce-motion-fade-xl-dark.mov` + `-frames` | Reduce Motion ON, XL | Exactly one frame changes from the page to the card: no rise and no draw-in. |

## Gallery

| File | Shows |
|---|---|
| `gallery-one-initial-marco-w` | 20pt discs: "Marco W." → "M", "Gianluigi B." → "G". |
| `gallery-card-save`, `gallery-card-saved` | Save is the outline star; Saved is the same star filled, with the label "Saved" and no accent fill. |

## Not captured

- VoiceOver: it can't be driven from this harness. The labels are pinned by tests.
- Live-update before/after are Light only (a pixel-diff pair); every other state has both themes.
