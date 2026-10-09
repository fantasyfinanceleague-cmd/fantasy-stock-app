# Fantasy football conventions, and what they mean here

**Why this exists.** On 2026-10-08 the Planner proposed a per-player watchlist "like Robinhood"
and Giorgio corrected it: "if im in multiple fantasy football leagues, each one has its own
waiver wire." His instruction: "i need you to research fantasy football so that this doesnt
come up." This page is that research, kept short, so that every league feature is planned
against the game our players already know.

**The rule** (`PRODUCT_RULES.md`, "League features follow fantasy football"): anything that
belongs to a league is modelled on ESPN / Sleeper / Yahoo fantasy football. Brokerage
conventions apply only to money surfaces. When in doubt, it is a league feature.

## The mapping

| Fantasy football | What it is there | Stockpile equivalent | Status |
|---|---|---|---|
| **League** | A closed group with its own rules, roster limits and transaction log; everything below is scoped to it | `leagues` | Live |
| **Roster** | Your players in this league, with position slots and limits | Your positions in this league (`drafts` + `trades`), with price-tier / category / per-slot limits | Live |
| **Player pool / available players** | Everyone not on a roster in *this* league. The same player can be taken in one league and free in another | The draftable universe minus what managers in this league hold (`symbol_owned`, `stockSearchOwnership`) | Live |
| **Draft** | Snake draft with a pick clock; auto-draft from your queue when the clock runs out | The draft, pick clock, server auto-pick from `draft_queue` | Live |
| **Draft queue / pre-rankings** | Your ordered list for auto-draft, per league | `draft_queue` (league, manager, symbol, position) | Live |
| **Watch List** (ESPN flag; Sleeper star) | Per league. A flag on a player in the add-player list; **reserves nothing**; the list is where you go to Add or Claim; also a filter on the player pool. Every other manager can still take the player | The watchlist: per league, a Save flag in search and on the stock sheet, reserves nothing, each row shows availability in *this* league and a Buy that goes through the normal trade path | Planned (`plans/2026-10-08-trading-window-and-watchlist.md`) |
| **Free agent add** | Immediate: first manager to add gets the player | A live buy while the market is open (`record-trade`) | Live |
| **Waiver claim** | A request placed while a player is on waivers (or outside the window), processed at a set time (ESPN: 3–5 am ET) in priority or FAAB order; editable or cancellable until then | **Option C, parked:** an order placed after hours that fills at the next open; cancellable until then. Same shape: place now, settle later, at a time the system picks | Parked |
| **FAAB** | A season budget for blind bids on waiver players | The budget-cap league's budget (one budget, no bidding) | Live (no bidding) |
| **Roster lock / game-time lock** | A player can't be moved once their game starts | **Not adopted.** Giorgio ruled trades follow market hours ("keep it like a real portfolio"); the lock is the market being closed, not the stock being "in play" | Decided 2026-10-08 |
| **Bye week** | A player's team doesn't play; no points | A regular-season bye: no result, not a win or loss, not counted (Giorgio's rule) | Live |
| **Matchup** | Head-to-head each week, best score wins | Weekly matchup, dollars decide, percent tiebreak | Live |
| **Standings / seeding → playoffs** | Win % then tiebreaks; top N seeds; byes to top seeds | `league_standings_ranked`; derived bracket; byes to top seeds | Live |
| **Commissioner** | Sets rules, draft time, can't leave without handing over | Same (Giorgio's rules, 2026-10-06) | Live |
| **Trade between managers** | Offer / accept, often with a review period or veto | **Not in the product.** Trades here are with the market, not with other managers | Out |
| **Keeper / dynasty** | Carry players across seasons | **Not in the product.** Run it back is always a new draft (Giorgio, 2026-10-04) | Out |

## Rules of thumb for planning a league feature

1. **Scope it to the league first.** Ask "does ESPN keep this per league?" If yes (it almost
   always is), the table has a `league_id` and the UI lives inside the league's screens.
2. **A list is not a reservation.** Watch lists, queues and rankings never hold a player;
   only a transaction does. Rows show *availability in this league* at read time.
3. **"Now" vs "later" is the waiver line.** Immediate adds are free-agent moves (live buy);
   anything that settles later at a system-chosen time is a waiver claim (option C), with
   cancel-until-processed and a visible processing time.
4. **Same stock, different answer per league.** Owned here, free there, doesn't fit a slot
   elsewhere. Any cross-league view must say which league it's answering for.
5. **Players learn by doing, not reading.** Fantasy apps explain a rule on the row where it
   bites ("On waivers until Wed 3am"). So do we (UX rule 8).

Sources consulted 2026-10-08: ESPN support, "Adding/Removing a Player From the Watch List"
and "Waivers Overview"; FantasyPros, "Beginner's Guide to Understanding Fantasy Football
Waiver Wires" (2026); RotoWire, "Fantasy Football Waiver Wire Pickups Explained".
