# Visual references: the five apps Giorgio named, and what we take from each

**Why this exists.** On 2026-10-12, after seeing 1.2.0 and a Sleek trial of Home, Giorgio
ruled: "everything I'm seeing is just so bland. It's not creative. It's not inspiring… I
want something that is captivating, something that is creative. I want to emulate other
fantasy football apps and make that bridge between them and investing apps. I want to
create a blend between a Sleeper and ESPN fantasy football with a Robinhood." His
references: **Sleeper, ESPN Fantasy, Yahoo Fantasy** (fantasy) and **Robinhood, E*TRADE**
(investing). This page records what each actually does on screen, from their current App
Store screenshots (Planner, 2026-10-12), so that directions are drawn against *rendered
evidence*, not a mood.

**The rule that follows from it** (`PRODUCT_RULES.md`, Direction): a screen is judged
against these references side by side, never against a direction written in adjectives.
"Calm", "quiet", "restrained", "hairline" are not design goals here; they describe what
went wrong. Structure stays calm (one standout, room to breathe, UX rules 4–7); the visual
language must be captivating.

Screenshot sources (App Store marketing images; view them there, not copied into the repo):
- Sleeper (fantasy screens): https://sleeper.com/fantasy-football (matchup, SleeperZone feed, mobile and web draft) and App Store shot 1 only: https://apps.apple.com/us/app/id987367543
- ESPN Fantasy Sports & More: https://apps.apple.com/us/app/id555376968
- Yahoo Fantasy Sports: https://apps.apple.com/us/app/id328415391
- Robinhood: https://apps.apple.com/us/app/id938003185
- E*TRADE: https://apps.apple.com/us/app/id311627216

---

## Sleeper (fantasy): the matchup, the draft board, the social texture

**Which screens count.** Giorgio (2026-10-12): the App Store listing's picks/betting
screens "arent as relevant to us"; only the fantasy-football screens are the reference.
The evidence below is Sleeper's own fantasy-football product page (sleeper.com/fantasy-
football: the matchup view, the SleeperZone live feed, the mobile draft board, the web
draft room) plus App Store shot 1 (the draft board). The glowing blue gradient belongs to
the picks side and is **not** our reference.

**What's on screen (fantasy side).** A **flat deep navy** surface (#0B1424-ish) with
slightly lighter navy cards; white, heavy, rounded-grotesque type; one **cyan accent**
for the primary action and the live state ("YOUR TURN", the DRAFT pills, the selected
tab). **The matchup header:** two big scores ("100.35 · 55.44") with projections under
them in grey, each team's **avatar** on its outer edge with a **win-% chip and a thin bar
under it** (green for the leader, pink for the trailer), team names with handles and
records, a divider badge between them. Under it a **live play strip** ("3Q 10:07 · A. St.
Brown 4-yd catch · +1.4 · LIVE") and a "Yet to play (12) · QB, 3 RB…" line with dot
indicators. **Starters** as a mirrored two-column lineup: your player left, theirs right,
the **position pill in the middle column** colour-coded (QB pink, RB teal, WR blue, TE
orange), points big, projections small, the game line in green (live/final win) or red,
and the **active row tinted** in the team colour. A chat strip pinned above the tab bar.
**The draft board:** a row of participants' avatars with status dots; the board as
**colour-coded tiles by position** (teal, blue, orange, pink) carrying pick number and
snake arrows; the **on-the-clock cell in yellow with the timer**; below, tabs
players / queue / team / chat, filter chips with counts ("ALL 0/8 · QB 0/1"), and rows
with a cyan **DRAFT** pill, rank, name, position dot, ADP and PTS columns.

**What we take.**
- The **flat deep navy** as the game surface (Home in season, Matchup, Draft, League) with
  lighter navy cards: depth from value, not from gradients or glow.
- The **matchup header exactly in this shape**: two scores, projections under, avatars at
  the edges with win-% chips and bars, names + records, a live line beneath.
- The **mirrored lineup with a colour-coded middle column**: for us the price tier or
  category pill between your holding and theirs, with the week gain big and the live price
  line in green/red; the active (moving) row tinted.
- **Colour-coded tiles** on the draft board (price tiers / categories as Sleeper's
  positions), the **on-the-clock cell in yellow with the timer**, and the avatar row with
  status dots.
- **"YOUR TURN" as a cyan pill with the clock**, and DRAFT/Buy/Claim as filled pills.
- **Filter chips with counts** ("ALL 0/8 · Tech 0/2") for slot filling in the draft.
- **Avatars with presence**: round, large, a coloured ring for you / live / on the clock.

**What we leave.** The picks/betting screens and their gradient-glow look; the chat strip
(no chat in the product); the six-tab bar.

## ESPN Fantasy (fantasy): the broadcast scoreboard and the data density

**What's on screen.** Near-black surfaces (#0F0F0F-ish) with a single saturated brand blue
used as the frame/background colour, white text, green for "winning/progress", red tints
on negative rows. The matchup header is a true scoreboard: two scores at display size with
team avatars, a thin green progress bar under each with a percentage, each team's record
and "yet to play" count beneath. Below it, a dense two-column table of players with points
per row, negative rows tinted dark red. The league card on Home is a compact scoreboard
with two buttons ("My Team", "Matchup"). Section headers are small uppercase labels.

**What we take.**
- The **scoreboard as the Matchup header**: two big scores, avatars, a bar each, record
  and a status line under each, pinned while the lineups scroll (ESPN's 2025 update pins
  the score at the top while scrolling player rows).
- **Row tinting by outcome** (a losing holding's row carries a faint red; a winner a faint
  green) in lineups and the week's results.
- **Dense, legible tables** for lineups and standings: tight rows, strong numerals, no
  decoration.
- Home's league card as a **mini scoreboard with two actions**.

**What we leave.** The brand blue (ours is the league/team colour); the featured-games
feed.

## Yahoo Fantasy (fantasy): bold, playful, friendly

**What's on screen.** Light surfaces with a vivid purple accent and black type; big,
bold, rounded headings; playful 3D illustrations (a football, a basketball) and a
stadium/crowd texture behind onboarding; full-width purple primary buttons with white
secondary buttons beneath; a "Your Turn · Round 3, Pick 3" strip with avatars of who's up
next; a live play-by-play feed with team-coloured cards; an invitation screen "Marvin has
invited you…" with the league's team logos scattered as bubbles.

**What we take.**
- **Onboarding and invitations with personality**: the invite screen, the "welcome to the
  league" moment, league logos/avatars as a visual set.
- The **"Your turn" strip** showing who's up and who's next with avatars.
- **Full-width primary buttons** with a single bold accent.
- **A live feed of events** ("Roberto's NVDA just jumped +3.8%") as a possible Matchup
  texture (later).

**What we leave.** Purple; illustrations of balls; the three-tab structure.

## Robinhood (investing): the number, the line, the colour that means something

**What's on screen.** Pure black background, white type, and ONE neon lime accent used for
the chart line, the selected range pill and emphasis. The portfolio screen is a big number
("$1,500.00"), a one-line change under it with a ▲ and the amount and percent, then a thin
single-colour line chart with no axes, no grid, no fill, and a row of range pills
("LIVE · 1D · 1W · 1M · 3M · YTD · 1Y") with the selected one filled. Market cards are
small tiles with a tiny sparkline. Typography is a clean grotesque with large, light-weight
headings for marketing and medium weight for numbers. Everything is left-aligned with
generous margins. Nothing decorative; the chart *is* the decoration.

**What we take.**
- **The number + the line as the whole hero** of money surfaces (Home's value, Portfolio,
  the stock sheet): big numeral, change line with a sign and arrow, chart with no chrome.
- **One accent that carries meaning**: the chart line takes the performance colour (gain
  green / loss red, or the team colour on game screens), so the screen itself reads as up
  or down.
- **Range pills**, filled when selected.
- **Sparklines** on list rows (holdings, watchlist).
- **Black, not dark grey**, when the surface is a money surface in Dark.

**What we leave.** Its marketing-page typography; crypto/prediction-market content.

## E*TRADE (investing): the pro dashboard, legibly

**What's on screen.** A deep purple brand bar and white cards; the account header is "Net
Assets $37,843.45" with "Day's Gain $909.07" in green beside it; an index strip (DOW,
NASDAQ, S&P) with small coloured bars; a key-figures card (Net Account Value, Day's Gain,
Total Gain, Cash) as a clean label/value list; a multi-line market chart in blue and
yellow with a right-hand percent axis and range pills; "What's Moving the Market" as green
tiles. Dense but ordered; numbers always right-aligned and tabular.

**What we take.**
- The **key-figures list** (label left, value right, gains coloured) for Portfolio and the
  stock sheet's "Your position".
- **Right-aligned tabular numbers** in every table.
- A **market/league strip** at the top of a screen (for us: the league's week status, or
  the top movers in your lineup).

**What we leave.** The purple; the video/news modules; the density of its menus.

---

## The blend, in one paragraph

Game screens (Home in season, Matchup, Draft, League, Run it back) live on Sleeper's
flat deep navy with a cyan accent and ESPN's scoreboard discipline: two scores with
avatars, win-% chips and bars, a mirrored lineup with a colour-coded middle column,
colour-coded draft tiles with a yellow on-the-clock cell, row tints by outcome, avatars
with presence, "YOUR TURN" as a lit pill with the clock. Money screens (Portfolio, the stock sheet, the watchlist, the claim composer)
follow Robinhood: the number and the line as the hero, one meaningful accent, range pills,
sparklines, E*TRADE's key-figures list for the details. Onboarding, invites and the draft's
"your turn" moments borrow Yahoo's warmth. The structure stays what the UX rules and the
calm-Home ruling require (one standout, sections that breathe, one primary action); the
*language* is what changes.

## How the Design Lead uses this page

- Every "Your call" direction frame is drawn **next to a reference screenshot** of the app
  it borrows from, and the board says which trait it took.
- Gate reports include a **"reference check"**: for each screen, which reference it
  resembles and in what, and the squint test against that reference, not against the
  previous build.
- Words from the old vocabulary ("quiet", "restrained", "hairline", "calm") may describe a
  *structure* decision but never a *visual* one.
