# gn-w4-matchup captures

W4 gate evidence for **Matchup + the player card** (`docs/design/reviews/w4-gate-checklist.md`,
"Matchup + the player card"), branch `feat/gn-w4-matchup`. Captured 2026-10-12 on two
simulators made for this branch ("W4 Matchup 17e" and "W4 Matchup 17 Pro", iOS 27.0), Expo Go
from Metro on port 8097, per `docs/testing/MOBILE_SIMULATOR.md`.

**Fixtures** (`apps/mobile/.env.local`, every var written explicitly each switch):
`EXPO_PUBLIC_SHELL_FIXTURE=leagues`, `EXPO_PUBLIC_GAME_SEAM=1`, plus
`EXPO_PUBLIC_HOME_FIXTURE` (the week's state) and the new `EXPO_PUBLIC_MATCHUP_FIXTURE`
(`lib/game/matchupFixture.ts`: the league ledger and slots — unset/`unslotted`, `category`,
`tiers`, `bought`, `stress`). The fixture's "now" is Thursday Sep 24, 1:37 PM ET (week 6) unless
the state says otherwise. Large = `large` content size; XL = `accessibility-extra-large`.

**Order of captures matters for one detail:** the opponent's name right-aligning in its half
and the XL caps (names, row text, the card's stacked figures) landed during this pass; the
earliest Large captures (live leading, the first cards) predate the right-align only. Nothing
else changed between captures.

## Matchup — the page

| File | State · device · text | Proves |
|---|---|---|
| `17e-large-live-leading-{light,dark}` | live, you lead (`live_open`) | Scoreboard: names, avatars (yours ringed), the two totals, "Roberto B. leads by $123.15", nothing else. Your half shaded. Mirrored roster, centre column empty, no row lit for its winner, no race chart, no chyron. Order = each stock's gain at **Wednesday's close** (the last close), best first. |
| `17e-large-live-behind-{light,dark}` | live, you're BEHIND (`leader_flip`, flipped) | "Gianluigi B. leads by $7.54" — and YOUR half (and every one of your roster halves) is still the shaded one (Giorgio, 2026-10-12: "it's you … Not whoever's winning"). |
| `17e-large-live-update-{before,after}-light`, `rec-live-update-rows-hold-light-frames` | live updates (`leader_flip`, a 30 s poll flips who leads) | Across the updates the totals and every row's number change; **the rows hold still** (same tickers, same order). Measured: a pixel diff of the left and right ticker columns across 7 samples — the only right-column diffs were the company truncation moving as the numbers widened; ticker order identical. |
| `17e-large-after-thu-close-reordered-light` | `live_closed` (Thursday 8 PM, after Thursday's close) | The order re-reads at the close: now by **Thursday's** close (NKE moved up on the right, TSLA to the bottom). |
| `17e-large-monday-before-first-close-{light,dark}` | `monday_preclose` (new: Mon 10:30 AM ET, every stock at Monday's open) | Every gain $0.00 and the rows in **draft order** by pick (NVDA 2 · AAPL 11 · CRM 14 · TSLA 23 · COST 26 · V 35 / AMZN 5 · JPM 8 · DIS 17 · NKE 20 · KO 29 · BA 32). |
| `17e-large-category-league-{top,scrolled}-{light,dark}` | category slots (`MATCHUP_FIXTURE=category`) | Grouped under centred GroupHeads in slot order — TECH ×3 · FINANCE · RETAIL ×2 · FLEX ×3 — best first within each; empty halves where a side has fewer (your empty half keeps its slab). |
| `17e-large-tier-league-{light,dark}`, `17e-large-tier-league-scrolled-dark` | price tiers (`tiers`) | $200 OR MORE ×5 · $100–$200 ×2 · UP TO $100 ×2 — the same grouping logic. |
| `17e-large-final-won-category-{light,dark}`, `rec-final-reveal-won-category-light.mov` + `-frames` | final, won (`scored`, category) | FinalBanner ("Roberto B. wins Week 6 · W · 5–1"), the same Scoreboard ("won by $390.67"), and the same grouped rows from the posted week's own per-stock rows. The reveal plays once on the first open. |
| `17e-large-final-lost-withheld-rows-{light,dark}` | final, lost (`scored`, `SCORED_OUTCOME=lost`) | Banner + scoreboard. **No rows:** this fixture's `lost` swaps the two posted totals, so the per-stock rows no longer reconcile to the cent and are withheld (finalLineup's rule, unchanged). Fixture artefact, not a product state — see "Open" below. |
| `17e-large-playoffs-live-{light,dark}` | playoff week, live (`playoff_live`) | The same page. Draft order holds because the fixture's only December close is Monday's (= open price): ties fall to the draft order. |
| `17e-large-bye-{light,dark}` | bye | Unchanged one-liner ("Bye week · no result"). No new copy allowed, so not redesigned here. |
| `17e-large-all-matchups-{light,dark}` | All matchups (navigation, kept) | gn Scoreboard, compact. Only YOUR game shades your half; the other games are two plain halves. |
| `17pro-large-category-live-{light,dark}` | 17 Pro, Large, category | Same page on the wider phone; both names on one line. |
| `17e-xl-stress-million-longest-names-{light,dark}` | XL + the stress fixture (`xl_million` ≥ $1M, `stress` longest company names) | Names stack under the avatars and never break mid-word; tickers, companies and percents capped at 1.6×; the seven-figure weeks shrink to fit (≥ 11pt). |

## The player card (sheet)

| File | State | Proves |
|---|---|---|
| `card-yours-sell-enabled-{light,dark}` | yours, market open | "Yours" pill; THREE figures (Price · Week gain · Since the draft); Season with "$290.10 → $318.37" on the title row and a dated axis, no acquisition marker; This week on Mon…Fri, stopping at now (Thu); **Sell** enabled, NO Save; "HOW YOU GOT IT" in its inset panel: "Drafted 2nd overall · Aug 31 · $290.10"; the Alpaca credit. |
| `card-yours-market-closed-{light,dark}` | yours, closed (`live_closed`) | Sell disabled with "Market's closed. Opens Fri 9:30 AM ET." beside it. |
| `card-theirs-no-watchlist-{light,dark}` | theirs | "Owned by Gianluigi B." with the 20pt `opp` disc showing ONE initial ("G"); "HOW THEY GOT IT". **No Save** — there is no watchlist in the app yet (see Open). |
| `card-theirs-category-pill-{light,dark}`, `17pro-card-theirs-{light,dark}` | theirs, category league | The category pill ("Retail", "Finance") beside "Owned by". |
| `card-yours-tier-pill-{light,dark}` | yours, tier league | The price-tier pill "$100–$200". |
| `card-bought-today-{light,dark}` | yours, bought this morning (`bought`) | "Bought · Sep 24 · $911.70"; the third figure "Since Sep 24"; the season line is ONE dot on its one-date axis. |
| `card-monday-week-one-point-dark` | Monday before the first close | This week = one dot at Monday's open on the full Mon…Fri axis; week gain $0.00. |
| `card-xl-dark`, `card-xl-scrolled-{light,dark}` | XL, stress | The three figures stack (side by side they truncated to "+5.8…"); "SINCE THE DRAFT" fits; Season/This week titles wrap their figures under them; the axis drops interior labels at XL. |
| `rec-card-reduce-motion-fade-xl-dark.mov` | Reduce Motion ON, XL | The sheet fades in place (no rise). |
| `rec-card-sell-to-stock-sheet-dark-frames` | Sell tapped (market open) | The card closes, and once it has left (Sheet `onClosed`) the existing stock sheet rises. Under the capture seam that sheet reads the real ledger and shows its own "This stock didn't load" — the sheet is unchanged and out of this branch. |

## Not captured (and why)

- **Save → Saved in the app:** Save is hidden because the app has no watchlist (`save: null`).
  The star / filled-star / "Saved" rendering is pinned by `tests-deno/player-card-model.test.ts`
  (`cardAction`) and lives in the design gallery's card.
- **VoiceOver:** the simulator can't be driven under VoiceOver from this harness. The labels are
  pinned by tests: RosterRow "Yours, NVDA, NVIDIA, +$125.27 this week, +6.05%" /
  "Gianluigi B., AMZN, …"; each figure "Price, $318.37, +3.81% today"; the owner pill
  "Owned by Gianluigi B."; the action "Sell, NVDA" with the closed reason as its hint.
- **Light** for `card-monday-week-one-point` and `17e-large-tier-league-scrolled`; the rest are in both themes.
