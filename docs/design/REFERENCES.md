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
- Sleeper · Blitz Studios: https://apps.apple.com/us/app/id987367543
- ESPN Fantasy Sports & More: https://apps.apple.com/us/app/id555376968
- Yahoo Fantasy Sports: https://apps.apple.com/us/app/id328415391
- Robinhood: https://apps.apple.com/us/app/id938003185
- E*TRADE: https://apps.apple.com/us/app/id311627216

---

## Sleeper (fantasy): the energy and the social texture

**What's on screen.** Dark by default: a deep blue-to-navy gradient background with a soft
glow, never flat grey. Saturated colour-coded tiles (teal, pink, orange, purple, blue) for
positions on the draft board; glassy translucent cards with a 1px light border and rounded
corners over the gradient. Display type is a heavy, condensed, all-caps grotesque
("DRAFT", "LOCK-IN", "COMBOS") at hero size, with a lighter weight for body. Player
avatars everywhere, big; team logos as small round badges. The matchup header is two big
scores side by side ("100.35 vs 55.44") with each team's avatar, a win-probability chip
("85% WIN") and a thin progress bar under each score. A persistent chat strip at the
bottom. A turn clock chip ("YOUR TURN · 00:01:00") pinned above the board. Bottom tab bar
with five icons on a dark glass bar.

**What we take.**
- The **gradient-and-glow dark surface** for game screens (Home in season, Matchup, Draft,
  League): depth, not flat charcoal.
- **Big display type for moments**: the hero number, "YOUR TURN", "FINAL", the week result.
- **Colour-coded tiles** for slots/tiers in the draft (price tiers and categories map
  naturally to Sleeper's position colours).
- The **two-score matchup header with avatars and a lead bar**, which we already have in
  concept and must render with this much contrast.
- **Avatars with real presence** (large, round, with a ring for "you" or "live").

**What we leave.** Betting/DFS surfaces; the five-tab bar (we have four); chat.

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
gradient dark with ESPN's scoreboard discipline: big display type for the moment, two
scores with avatars and bars, colour-coded tiles, row tints by outcome, avatars with
presence. Money screens (Portfolio, the stock sheet, the watchlist, the claim composer)
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
