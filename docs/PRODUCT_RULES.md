# Product rules

**The single source of truth for Giorgio's product decisions.** Every rule here was decided
by Giorgio. Quotes in "…" are his words, kept verbatim. Read this before planning or
building anything, and don't reopen a rule without him.

- **Who updates it:** the Planner (when a plan settles a decision) and the Orchestrator
  (when a decision is made mid-build). Add the date and, where possible, the board
  section or PR that recorded it.
- **Where decisions come from:** product and design choices go to Giorgio as side-by-side
  mockups on the key-screens board ("Your call" sections in
  `docs/design/screens/key-screens.html`), never as prose only.
- **Related:** what is live is in [`STATUS.md`](STATUS.md); plans are in [`plans/`](plans/).

---

## Direction

- **App first, landing last** (2026-09-29). The real app screens are designed and built
  first; the landing page later mirrors what the app actually looks like.
- **The bar** (2026-09-27): judge UI against Apple / Stripe / Linear (web) and Robinhood /
  Sleeper / Revolut / Arc (mobile). Correctness, honesty, tokens and reduced motion are
  table stakes, not the goal.
- **Captivating, not bland** (2026-10-12, after seeing 1.2.0 and a Sleek trial of Home):
  "everything I'm seeing is just so bland. It's not creative. It's not inspiring. It's,
  you know, you're not opening up an app and being like, wow. You're opening up an app and
  just seeing bland charts and bland everything. I want something that is captivating,
  something that is creative. I want to emulate other fantasy football apps and and make
  that bridge between them and investing apps. I want to create a, a kind of a, a blend
  between a, a, a sleeper and ESPN fantasy football with a Robin Hood or... Another sort of
  app like that. That's what I want." "Even the chart, like that's such an ugly chart."
  - The references, his list: fantasy = **Sleeper, ESPN Fantasy Football, Yahoo Fantasy
    Football**; investing = **Robinhood, E*TRADE**. What each does on screen and what we
    take is in [`design/REFERENCES.md`](design/REFERENCES.md).
  - Every direction and every screen is judged against those references side by side on the
    board, never against adjectives. "Calm" governs structure (one standout, room to
    breathe, UX rules 4–7); it never governs the visual language.
  - **Sleek (sleek.design) is rejected** for this app: "let's maybe not use Sleek, especially
    if it's going to charge us. Let's just maybe try to figure this out just in Claude Code."
    Design happens on the board, built here.
  - **Every section must elevate** (2026-10-12, approving the reset plan): "the main thing is
    that I don't want bland. I want every section to, in its own way, elevate the, the app,
    right?" His named examples of what is wrong in 1.2.0, verbatim:
    - Standings: "the way it looks right now in the app is awful. It is just a basic table
      with not even good like divide like dividing the columns and rows. It's it's ugly".
    - Matchup: "the chart doesn't even load" (a defect to fix, not a design choice).
    - Stocks: "you look at the different stocks and it's just they're so ugly."
    - The head-to-head is the heart of it: "I feel like even in the last one, like it
      captured that better head to head matchup look way better. And that should really be
      shown. And that's a huge part because of it's that like that fantasy football style".
      So the matchup is designed as a head-to-head scoreboard first (Sleeper/ESPN shape), and
      the 1.1.0 matchup look is a reference for what to keep.
    - His summary: "these are just some elements that really stuck out of just like, this is
      not how it's supposed to look. from a UI's perspective."
  - **The Matchup page is a fantasy-football matchup** (2026-10-12, also told to the
    Orchestrator directly): "the matchup page needs to look like the matchup pages from
    fantasy football apps, like an ESPN, like a Yahoo, like a sleeper, where it lists your
    stocks as if they are like a football roster, obviously without the positions, because
    that's not a thing, but it lists them like that and it shows their performance and it
    stacks them up so that you can see which maybe stocks are like how your stock is
    comparing to the other player's stock. We can maybe figure out a way to in, in what
    order that we list them like later on, but the matchup page should be one of the
    simpler ones. It should be just our themes, our take on that kind of fantasy football
    style matchup window." So: a scoreboard header, then a mirrored two-column roster (your
    stocks left, theirs right, row by row, each row's week performance shown), no position
    labels; the row ORDER is an open decision for later; keep the page simple.
    To the Orchestrator, the same day: "The matchup page should look like a matchup page
    from a fantasy football app, where it lists your stocks like a roster and shows the
    head-to-head performance of each. It's that simple. There really shouldn't be any other
    added elements." The week race chart is REMOVED ("If on ... there's a whole day where
    it's just going to sit there blank like that, we need to remove that"). Nothing on
    Matchup may sit blank or mean nothing for part of the week.
  - **Matchup roster row order** (2026-10-12): "let's order it that way. By uh, weak gain
    with the best going first." Then, the same day, by league type: "if it's the like
    category slots option, then the model should be listed like with the categories. So
    it'll show like text docs on a list of three. Um, and then, you know, it, it just shows
    each category and the stocks fit within those. And then with inside each of those, if
    there's multiple for a single category, then it will show by who's performing the best.
    For the other, uh, like game league types, game types, I don't know how we should call
    them. It'll just be ordered by who's performing the best, uh, since there aren't like
    positions." So:
    Then, asked about price tiers: "No, the price tier league should also have the same
    logic. Basically, if there's a mode where certain stocks are placed in certain
    categories, let's show them on the matchup page in those respective categories.
    Otherwise, we just show them in order by who's doing the best." So:
    - **Slotted leagues (category slots AND price tiers):** the roster is grouped by slot
      group in the league's slot order (e.g. "Tech ×3", then "Autos & Transport ×2", then
      "Flex"; or "$100–$200 ×2", then "$200–$400 ×2"), the group acting as the position
      label; within a group, stocks by week gain, best first. Both managers share the
      league's slot structure, so the mirrored rows pair up group by group.
    - **Unslotted leagues** (per-slot fixed-notional, budget-cap): one list per side by week
      gain, best first; no grouping, since there are no positions.
    - **When the order updates** (2026-10-12): "it should be at the end of each day, like
      the start of the next day, it'll reorder it to show like who's been doing the best.
      So it doesn't update like live per se, but updates at the end of the day. Let's just
      have it do that for now." So the order is recomputed once at each market close and
      holds through the next trading day; nothing re-sorts live. (On Monday the order is
      the draft/slot order until the first close, since every week gain is $0.00.)
    - **The exact moment** (2026-10-12, picked from three timelines: at the close, after
      trading ends, next morning): **after trading ends.** A day's close counts for the
      order only once that day's extended-hours trading is over, 8:00 PM ET (four hours
      after the close, so 5:00 PM ET on a 1:00 PM early close), so after-hours prints can
      never shuffle it again that evening. Until then the previous close's order holds.
      The prices on the rows still move live all day; only the order waits.
- **Giorgio's copy stays verbatim.** Propose changes; don't rewrite his words. A factual
  error goes to him as a decision.
- **Generic scoring copy:** rules, marketing and onboarding say "best performance wins",
  never "best return" or "biggest dollar gain", because capital varies by stake mode.
- **Nothing tappable does nothing** (2026-10-12): "make sure that there's no clickable
  actions or links or anything that's clickable in the app that then doesn't do anything.
  Like if there's any buttons or links or anything that should bring a pop-up or a redirect
  or anything like that, it needs to be active. We can't have buttons that don't do
  anything, links that don't do anything." Every control that looks tappable either does its
  job or is not shown (a control that can't act in the current state is hidden, or disabled
  with the reason beside it; never a silent no-op). Audited once the UI redesign lands
  (plan `plans/2026-10-12-visual-language-reset.md`, W8) and checked at every gate after.
- **1.3 = the visual-language reset** (2026-10-12): "let's do the 1.3." The Game Night
  redesign ships as 1.3 with every screen on the new skin in both themes, after Giorgio's
  walkthrough in both themes; no 1.2.x with a partial reskin. The old direction's sections
  (`DESIGN_DIRECTION.md` §1, §9, §9A) are superseded by the Game Night token spec ("Yes, on
  point two"); §4, §5 and §9B stay.
- **1.2.0 TestFlight** ships only when EVERY screen is on the new UI, after Giorgio's
  full walkthrough. Phone only (`supportsTablet: false`); iPad is a later project.
- **Bots and the manual draft Start are testing tools only** (2026-10-06): bots exist "simply to simulate drafts" and "will get removed"; they're "not going to be a feature in the actual app". A real league always has real players, so never design product behaviour, copy or decisions around bot-only or one-real-player leagues. The manual Start is likewise "simply for testing purposes"; auto-start is the real feature. See **League size** under League lifecycle.
- **Board review answers** (2026-10-06): "Buy a stock" (tappable-but-blocked ownership, the
  Portfolio entry row, the search copy) and the stock chart ("A week ago" as the comparison
  line): "fine".
- **Direction chosen: "Game Night" (A), with tweaks** (2026-10-12, on the board's three
  directions, Light and Dark). Giorgio, section by section:
  - Home: "I like option A, game night the most. Uh, the broadcast version, I don't love the
    giant like purple kind of accent box thing in the middle. I think that's doing a little
    too much. And then Terminal just feels a little too robotic with some of the styling… I'm
    leaning more towards the game night as like the color palette and the styling."
  - Matchup: "I like the way that the game night one looks. I like the way that where you
    are is kind of shaded. And then I like the way that it says like the leads by and stuff".
  - Draft: "the game night one, I don't love the most… I do think it's just a little too
    similar to Sleeper in the sense that the squares are like color coded like that. I like
    the game night one. Look, but with the broadcast touch of having like it color coded just
    with that line at the bottom. I think that does enough to where you kind of see the
    breakdown by sector, but without it being like a carbon copy of Sleeper." So: Game Night
    styling, draft tiles NOT colour-filled; the slot/sector colour is a line along the
    bottom of each tile (the Broadcast treatment).
  - Standings: "the game night one is the best just because of that, like, style and
    formatting."
  - Portfolio: "it's going to be game night again."
  - Summary: "it's going to be kind of going towards that game night style, with just a few
    tweaks". Broadcast (B) and Terminal (C) are closed.
  - The Matchup roster's centre column in unslotted leagues: "let's go with its
    recommendation". The Design Lead's recommendation on the board (#call-direction, "Your
    call: the centre column (unslotted leagues)"): "Empty (recommended): The two numbers face
    each other across a gap. Nothing to explain." So in unslotted leagues the centre column
    is EMPTY. (Rejected there: a tier/sector pill, which disagrees across sides because rows
    pair best vs best, not slot vs slot; and row numbers, which "read like a position, which
    your ruling rules out".)
- **No sparklines on rows; the stock pop-up carries the detail** (2026-10-12): "on the
  portfolio page and on the matchup page … I don't want that like line thing there visible.
  What I want is that when you click on the stock, whether it's on the matchup page or the
  portfolio, it you know, like a pop-up window comes in where you can see more information
  and more details on that holding. So it'll give you information like, Uh, like as if you
  click on a player in fantasy where you kind of see … like for this one did you draft or
  did you pick it up off the waivers if so put the date where it was from and then like the
  price that you bought it at Uh, I would want to show that kind of line chart of its
  progression throughout the season in that kind of pop-up window." Reference: ESPN's
  player card (Giorgio's three screenshots, 2026-10-12, kept locally at
  `~/fantasy-stock-design-review/references/espn-player-card-{1,2,3}.webp`, not in the repo, per the
  references policy): header
  with name/team/position and the owning team, a key-figures strip, an Overview tab with
  this week's line, recent news, a game log, and a **Latest transaction** block ("Drafted
  8th by SUBSTATION SURFER · Aug. 30, 6:06 PM"). "I don't want to see these like those
  little lines showing the performance of the stock unless you click on it in the matchup
  in the portfolio." So: Portfolio and Matchup rows show ticker, performance and the slot
  pill, no chart; tapping a stock (yours or theirs) opens the stock sheet, which shows the
  season line chart of that holding, how it was acquired (drafted, with pick and date and
  price; claimed off waivers, with date and price; bought, with date and price) and the
  rest of the ESPN-style overview.
- **The stock player card, after the first mockups** (2026-10-12, Giorgio's review of the
  Design Lead's frames):
  - **Order like ESPN; acquisition at the bottom.** "I want the order of like the layout to be
    like you're on ESPN Fantasy. So like the fact that it says like drafted and then like kind
    of at the top, no, that should be at the bottom. It should say the date that you picked
    them up, whether that be draft and then you say the, and then it shows the pick and the
    amount that it was drafted at, or you show like the waiver wire, the date, and then …
    the price." So the "How you got it" block is the LAST section of the card: the date,
    then Draft (with the pick) or Waiver claim or Buy, then the price.
  - **Three key figures, not four.** "I like the kind of initial top card with like the price,
    the week gain since draft their position. I don't love the their position. In that, I
    think it does seem a little cluttered. Maybe we just go with three." So the strip is
    price · week gain · since draft (or since acquired); no "their position" figure.
  - **The season chart gets a real X axis with dates**, and NO "Drafted" label or marker on
    the chart: "there should be a, some sort of X axis with like dates on it. Also, if at the
    bottom, like we don't need to say drafted on that chart, like A player can see from this
    pop-up card if they were drafted or picked up on waivers."
  - **The this-week chart shows the days of the week on its X axis** (Mon … Fri) and the
    mockup must use realistic movement: "why is there just like a flat line for half the
    chart and then like a slight pop-up? Like, that's not how it should be."
  - **No Save (star) on a stock you already own**: "there probably shouldn't be a save option
    if you already have the stock, if it's one of yours." Clarified the same day: "if I am
    looking at the player card of a stock I already own, there shouldn't be a save button
    because there's no reason to save it if I already own it. You should only have the save
    if it's a stock that's not currently being held or an opponent's stock that you want to
    keep tabs on." So Save shows on unowned stocks and on other managers' stocks; never on
    yours.
- **Redesign decisions, the consolidated list** (2026-10-12 evening; the Orchestrator's and
  Design Lead's 14 open items, answered in one go):
  - **Matchup shading = YOUR side, always**: "I was going more on the side of it's you. So
    when it's you versus someone, it shades it so that it's clear. Not whoever's winning.
    That's going to be able to be seen by the uh, the point total up top." (Option B; the
    1.1.0 leader-follows shade is NOT kept.)
  - Home's season chart X axis: two end-date labels (start and today). ("yeah")
  - The player card's draft amount = the price per share ($290.10), not the total put in.
  - For everything else he took the recommendations: "I'm going to go with your
    recommendation there. Let's just go with your recommendations on the rest after that."
    Namely: (4) categories: 10 hues plus a neutral Misc, short labels (Tech · Finance ·
    Health · Energy · Autos · Retail · Food · Media · Industry · Property · Misc; new copy);
    (5) the on-the-clock draft cell stays dark navy in Light, a single spotlight; (7) the
    1.2.0 walkthrough tests only what survives the reskin (first-pick push with the app
    closed, buzz/chime in-app, Run it back end to end); (8) the held post-1.1.0 drops
    (`start_new_league_season`, I6/I2b) may be released now, with his explicit go at the
    `db push` itself; (9) Matchup's "My matchup / All matchups" switch stays as navigation;
    (10) the watchlist's Home hook is decided after the Home rebuild; (11) your-turn colour
    = cyan; (12) the card's third figure = "Since the draft" ("Since Oct 2" for a later
    buy); (13) the Portfolio chart with range pills: yes; (14) the owner's avatar beside
    "Owned by": add; a weekly game log on the card: later.
- **Matchup: four states the approved frames never drew** (2026-10-12/13, from the W4 Matchup
  gate; board `#call-mx-order`, `#call-mx-empty`, `#call-mx-bye`, `#call-mx-withheld`).
  Giorgio picked **B** on all four, one at a time from the board images, and accepted the three
  new strings exactly as drawn:
  - **The row order says what it is:** one small line between the scoreboard and the rows,
    "Ordered by Wednesday's close", naming the last close whose trading has ended. It becomes
    "Thursday's close" once that day's trading ends (the re-order timing, his "after trading
    ends" ruling: PR #252). Rows still never re-order live.
  - **An empty slot is marked:** a slot with no stock (sold, not yet replaced) keeps its row
    and its half shows a dashed edge and "Empty"; your half keeps your shade inside it.
  - **The bye week:** the scoreboard card with your half as usual (avatar, name, this week's
    total), "Bye week" in the opponent's half, the shipped line "Bye week · no result" under
    the card, then your stocks in one column, best week first. No other new words.
  - **A final whose stock-by-stock figures can't be shown** (they don't reconcile to the posted
    score): the scoreboard, then "Stock-by-stock results aren't available for this week.", then
    both lineups as ticker and company only, no figures, in draft order, your side shaded.
- **Lock everything down; nothing scrapable** (2026-10-08): "I don't want people to be able
  to scrape anything and the more secure and locked down this can be the better." Chosen over
  keeping the public stock-symbol list readable (option B): the symbols table becomes
  signed-in only, and anything an anonymous caller (or any one signed-in player) could
  bulk-read is audited and locked down, with product-visible changes brought to Giorgio first.
- **Who can see other players** (2026-10-08, audit #8, option A): "i can only see other names
  and avatars of other users im in a leauge with. we cannot allow a user to see any
  information outside of the name/avatar of another member in their league (email, etc) or
  any info about users not in their league." So: another player's profile is visible only to
  people who share a league with them, and only their name and avatar. Nothing about players
  outside your leagues. **Before you join** (2026-10-11, option A, board
  `#call-join-commissioner`): the Join preview names nobody, not even the commissioner (no
  "Run by"); a full league reads "Ask your commissioner if they can make room."
  **After someone leaves** (2026-10-11, "A with frozen names", board `#call-leaver-names`):
  they stay named, with name and avatar, in the seasons they played with you (history is
  kept), frozen as they were when they left, so nothing about them after they leave
  reaches you. No "Former manager" label.
- **No added caveats:** implement Giorgio's rules as stated. Don't add exceptions he didn't ask for.
- **Product name:** "Stockpile" must go (a live trademark), with Stockade the front-runner,
  but naming is DEFERRED to pre-launch. Keep the bundle id, slug and scheme.

## Scoring and standings

- **Dollars decide.** Dollar gain decides every matchup in every stake mode; percent is
  only the tiebreak. The UI shows the metric that decides the winner, via one shared helper.
- **"Season gain"** = regular-season `points_for` only. In the playoffs it stays at the
  final regular-season total.
- **Ranking** (standings = playoff seeding, one order, computed only in SQL
  `league_standings_ranked`): (1) win % = (W + 0.5·T)/GP, byes excluded, 0 GP = 0%;
  (2) a balanced mini-league head-to-head among the tied, only if every pair met equally
  often; (3) season gain; (4) joined_at; (5) user id.
- **Once the season is over, medals follow the playoffs** (2026-10-10, option A, board
  `#call-medals`). The finished season's "Final standings" put the champion 1st (gold,
  "Champion"), the Final's loser 2nd (silver, "Runner-up"), and the better-seeded of the
  two semifinal losers 3rd (bronze); everyone else keeps their regular-season place.
  Records and season gains stay the regular season's, and the Playoffs tab keeps the
  seeding. League › History and the season-complete card show the same medals.
- **Regular-season byes = no result**: neither a win nor a loss, and not counted in games
  played. No explanation of byes, just a short notice when members/weeks produce uneven
  byes.
- **League's two load failures** (2026-10-13, approved by Giorgio as written, relayed by the
  Orchestrator during the W4 League build): History reads "Your league's history didn't
  load." and Playoffs reads "The bracket didn't load.", each beside the existing "Try
  again". (Before, a failed read left the segment blank.)
- **The league list's load failure** (2026-10-14, Giorgio approved, relayed by the Orchestrator
  during the gn-sweep): when the read of your leagues fails, Home and League read "Your
  leagues didn't load." with "Check your connection, then try again." and "Try again" (one
  string, shared by both). "No leagues yet" shows only when that read succeeds with no
  leagues. (Before, a failed read said "No leagues yet" with Create / Join.)

## Home and Portfolio

- **Home shows only the selected league**, with the league pill ("+N" hint) to switch.
  There's no "your other leagues" row.
- **Home hero:** team value is the big number; under it "+$X · +Y% season gain · +$Z today".
  The Home chart plots season gain, week by week.
- **A calm Home** (2026-10-12, option A "same content, calmer", board `#call-calm-home`),
  after Giorgio's first look at 1.2.0: "this UI on the home screen is awful. section bubbles
  are touching, it feels clunky, and there is too much going on". Same content, calmer:
  team value is the ONE standout number; the season chart sits directly under it (no card,
  W/L marks on its axis, range as text tabs); This week and Standings are two quiet cards
  that open Matchup and League › Standings; sections never touch (24pt between blocks);
  one primary action per screen. Before the draft and after the season follow the same
  rules (fewer, merged cards; the countdown leads; Run it back or the ask is the only
  primary). Nothing is removed from Home; repeats are.
- **Portfolio's gain is "since the draft"** (value − cost). It's deliberately a different
  label from "season gain"; never reuse one for the other.
- **Stock chart ranges** (2026-10-05, option A): 1W / 1M / 3M / 1Y, with 1W the default.
  There's no 1D, because the price history (historical-bars) is daily bars only.
- **Cash from sales** (2026-10-05, option A, budget-cap and price-tier leagues): a sale's cash
  shows as its own "Cash from sales" line, and the header value includes it, matching Home.
- **Market-data credit line**: credit Alpaca on price surfaces.
- **Appearance:** System / Light / Dark. One layout and component set with two complete
  themes; no screen mixes them.
- **Both themes, designed together, neither first** (2026-10-12, overruling the reset plan's
  "dark first"): "I don't want the app to only be in dark mode. I want us to build an app
  that can work well and is designed for either light or dark mode. Orchestrator just told
  me that it was dark mode first, then light. No. I want one that it doesn't matter what
  mode you're in, it's going to be built for either." So every direction on the board, every
  token, every screen and every gate is done in Light AND Dark at the same time; a screen is
  not approved in one theme without the other; the references for Light are E*TRADE and
  Yahoo's light surfaces, for Dark Sleeper, ESPN and Robinhood.

- **League › Schedule** (2026-10-05, option A, "keep it"; 3c-D4): the League tab keeps the
  full season schedule, every week in order: past weeks with your result and score, this
  week "● Live", next week "vs {name} · Next", then a closing playoffs line ("Then the
  playoffs: 4 teams · 2 weeks of playoffs · no byes."). Not dropped to Standings + History.

- **Manager rows** (2026-10-08, S-10): one row style everywhere a list of managers appears
  (League standings, Home's excerpt, History, the lobby, the Run it back list, the bracket).
  Giorgio: "just bold the users name. dont need to put the (you), people know their name.
  just bold it." Then, asked about the tint: "blue tint as well". So: your name is bold and
  your row keeps the light blue tint; everyone else's name is regular weight; no "(you)"
  label. Gains are coloured by sign; movement arrows on League only.
- **Draft recap** (2026-10-08): the designed League › History recap is NOT in 1.2.0 (Design
  Lead ruling, 1.3). Nothing in 1.2.0 links to it; the draft's ending is Draft complete.

## Draft

- **"A draft pick CAN NEVER be unused."** A missed turn is always auto-picked. There's no
  Skip, and no unfilled-slot state for people.
- **No late picks** (2026-10-13, relayed by the Orchestrator): once a manager's clock has
  expired, the server refuses their own pick (a 2-second grace for network latency only)
  and the auto-pick takes the turn. Judged on the server's clock, never the phone's.
  - **After the clock, only the auto-pick fills the turn** (2026-10-13), a stalled turn
    included: no manual rescue. "the auto pick has to work"
- **Auto-pick picks a good stock**: the manager's queue first, then the best available,
  meaning the largest market cap that fits. It must NEVER break the league's criteria
  (price brackets, category slots, budget, the draftable universe).
  - **The auto-pick never stalls on a stale price** (2026-10-13). Giorgio's ruling:
    after a manager's clock expires, only the auto-pick fills the turn, a stalled one
    included: "the auto pick has to work". So any stock that is legal at its LIVE price
    must be found. A stock is never ruled out on its cached catalog price when a live
    price could make it fit: when the cached price is up to 50% past a slot's
    bracket or the budget left, or the budget reserve is the only thing refusing it.
    Those stocks are live-priced, in batches. "No legal stock" is reported only after
    that. While prices are unavailable (a vendor outage, shown as Paused), the turn
    keeps retrying and fills on its own once prices come back.
- **The auto-pick always stays within the league's rules** (2026-10-13). Giorgio: "auto
  draft needs to work. if a user wants to auto draft it has to work and pick a stock
  within the paramters". And: "if a player runs out of time, then it auto picks for them.
  there can never be an instance where a player doesnt get a pick. its like fantasy
  football, you run out of time and it auto drafts for you."
  - The auto-pick is the missed-turn path. There's no auto-draft switch to opt into.
  - It only takes a stock that fits the price range, the category and the budget. With
    the never-stall rules above it always finds one, unless no stock fits at all.
  - If no stock fits, the turn waits and keeps retrying. Nobody is notified (see below).
  - This supersedes the same day's "closest stock" and "cheapest anyway" rulings.
- **No notification when the auto-pick is slow or stuck** (2026-10-13). Giorgio: "Drop the
  wrong 'pick manually' notification and don't add a new one. The commissioner can't do
  anything about it anyway." The commissioner still gets the one "waiting on prices"
  notice during a price outage.
- **Draft budget: no cushion, never stuck** (2026-10-13, budget-cap leagues). Giorgio:
  "safety cushion? when did i ever say there should be a safety cushion?"
  - A pick must leave enough budget to fill the manager's remaining slots at current
    prices, exactly. No extra 10% on top.
  - Never stuck: if prices moved so a manager's remaining slots no longer fit the budget
    left, a pick that doesn't make that gap worse is still allowed, so the draft keeps
    going.
  - Never over budget: a pick can never cost more than the budget left.
  - Same rule for manual picks and the auto-pick.
- **Pick clock:** 60 s default, commissioner-configurable 30–90 s.
- **Draft order:** a league setting with two modes, Random or Manual, never an automatic
  commissioner-first. Both lock at T−1h. If Manual was never saved, the random order
  locks. The order is set at the later of T−1h and the league reaching 4 members. A
  joiner after T−1h picks last. (Since 2026-10-14 nobody can join after T−1h; see "Share hides
  while teams are locked" under League lifecycle.)
- **The draft starts by itself** (2026-10-06): "the draft is not something that is
  started manually. It should be something that starts at the minute that is selected by
  the commissioner. So if the commissioner sets it for noon tomorrow, the draft room will
  open at 11 a.m. and the draft will automatically start at noon."
  - The countdown ("Draft starts in …") shows as soon as a draft date is set.
  - At T−1h the draft room opens and the order is set.
  - Two pushes to everyone: when the room opens (with your draft position), and when
    the draft starts.
- **When a draft can't start** (2026-10-06):
  - The commissioner is warned BEFORE the room opens, with time to fix it.
  - The real gate is room-open time (T−1h). If the league still isn't ready then, the
    draft is postponed, everyone is notified, and the commissioner fixes it and picks a
    new time. No late start: "people still need an hour heads up and notice."
- **Draft time** (2026-10-06): only in 15-minute increments (:00 / :15 / :30 / :45), and at
  least one hour out. It can't change once the room opens, except when postponed.
- **Draft-time changes** (2026-10-06): "Anytime a draft time is changed, everyone receives
  a notification to know exactly when it's happening." Everyone means every member,
  including the person who made the change: "Everyone in the league gets the
  notifications when draft times are changed."
- **Setting the draft time** (2026-10-06, "B on both", the UX audit's "Your call" sections,
  PR #140; relayed by the Orchestrator):
  - The draft-time picker commits ONLY on a full-width "Set draft time" button. The × closes
    without saving. Where a time is optional, "Set later" is a text button.
  - On Home, when the commissioner has no draft time set, "Set draft time" is the primary
    action and opens the picker in place ("Pick a time, and the countdown starts here."),
    with "Build your queue" secondary.
- **Your turn in the draft room** (2026-10-06, Giorgio's board review): your turn must be
  impossible to miss. "That top part of the screen should like flash a color when they're
  up just to make sure that they're they really notice it", with text "that's very hard to
  miss" (a colour change and bold), plus "a sound notification or a buzz".
- **You're always told it's your turn** (2026-10-11): "if a draft is happening, the player
  should be notified if its their turn even if they close the app." Every turn, the FIRST
  pick included, gets an "It's your turn" push the moment it starts, whether the app is
  closed or open. With the app open (any tab), it buzzes and chimes once per turn and the
  banner adds no second sound; in silent mode, just the buzz.
- **The draft board's look** (2026-10-06): Giorgio is "not a fan" of the current draft
  board UI. A redesign is wanted, but later ("save that for later"), not in the current
  pass.
- **The clock card: no ", then N", no "60-second picks"** (2026-10-13, on the W4 Draft room,
  relayed by the Orchestrator): "I don't like the then blank blank picked twice. I think it
  just should show the you're on the clock and then what round and pick number it is. I don't
  think it needs that last thing at the bottom." His words were about the your-turn card. On
  BOTH clock cards (yours and someone else's) exactly two things go: the snake suffix (", then
  12": the round line reads "Round 2 of 6 · Pick 11") and the "60-second picks" line. Nothing
  else changes: the headline ("You're on the clock" / "{Name} is up"), the clock ring and its
  digits, the status lines (a stalled turn, auto-pick waiting for prices) and, on someone
  else's card, the lines that tell you when you're up ("You took AAPL · you're up in 2 picks",
  U-09; "3 picks until you", UX rule 10) all stay.
- **No "Auto" tag on the draft board** (2026-10-13, final; the A/B was cancelled): "no auto
  tag". A tile shows the pick, the category code and the ticker; an auto-pick is said in the
  pick log's words and to VoiceOver, never as a mark on the tile.

## Trading

- **Trades are whole positions**: a sell is the entire position, and a buy invests the
  whole source. No partial amounts.
- **Per-slot (fixed_notional) leagues:** a replacement buy uses exactly the sold slot's
  sale proceeds. The user picks which freed slot funds a buy.
- **Budget-cap and price-tier leagues:** one share per buy, the whole position per sell,
  and a sale's cash returns to the budget (budget-cap). Price-tier leagues have no budget.
- **Price-tier trades** (2026-10-06, option A, "Replace in the same tier"): selling frees
  that stock's slot; a buy must fit a free slot by its price and takes it ("Fills your
  $100–$200 slot"). A tier is set by the entry price and never moves. Category slots name
  their category ("Fills your Tech slot"); a slot with neither is "Flex".
- Trading follows market hours (the server refuses closed-market trades).
- **Trading window** (2026-10-08): the market-hours rule stays. Giorgio considered a
  fantasy-style lock (trade only while the market is closed) and ruled against it: "im
  leaning keeping it like a real portfolio where i cant buy/sell after hours." Decision on
  the Planner's three options: "Immediate A with C as the long term plan", where A = trade
  only while the market is open, and C = later, orders placed after hours that fill at the
  next open (Robinhood-style). C is parked as a future plan, not built now.
- **Search and save any time** (2026-10-08): "a user should still be able to search a stock
  when they arent allowed to buy. they should still be able to search and add stocks to a
  watchlist or something to save for later." Search never depends on market hours; a
  watchlist exists (plan: [`plans/2026-10-08-trading-window-and-watchlist.md`](plans/2026-10-08-trading-window-and-watchlist.md)).
- **The watchlist is per league** (2026-10-08): "by league. if im in multiple fantasy football
  leagues, each one has its own waiver wire. if i want to buy apple in one league, i may not
  be able to in another if another player has it, i already have it, or it doesnt fit my
  team by one of the league rules." A per-player list "makes no sense".
- **The watchlist is not a queue** (2026-10-08): "multiple players can save the same stock,
  its like a player on the waiver wire. i can want to add them but so can someone else."
  Saving reserves nothing. Separately, "there should be a way to save stocks to keep an eye
  on them, and a way to queue them to add the next day that works like the waiver wire."
- **The waiver wire: daily claims** (2026-10-08). Giorgio chose daily moves over a weekly
  lineup lock: "a user should be able to trade daily. this is based on fantasy football,
  doesnt need every same rule. an investor should be able to make moves mid week. so our
  'waiver wire' will be a daily thing. you can claim stocks after the close of each day. if
  no one else claims that day, you get it. if two or more people claim, then we have the
  order decide. the order works like fantasy football, starts as reverse draft order. then
  shifts based on wins/loss and claims made."
  - A claim is placed only while the market is closed (Claim is Buy's closed-market twin;
    during market hours you just Buy). It is processed at the next market open, 9:30 ET, at
    the opening price, before live trading opens for that day.
  - A claim is "Buy X, funded by selling Y" (or by cash in a budget-cap league); if the claim
    loses, Y is not sold. Whole positions only, as always.
  - Claims are blind: you cannot see who else has claimed a stock or how many. Holdings stay
    visible ("Owned by …" as shipped); you only ever see leaguemates.
  - The order: starts as reverse draft order; ANY successful claim (contested or not) moves
    you to the back of the line; after each week is scored the order resets to reverse
    standings (last place first, standings tiebreaks apply).
  - After the run, the loser is told who won and why, in one short clause.
- **Where the watchlist lives** (2026-10-09, "C and approved", board `#call-watchlist`): a
  Watchlist tab inside "Buy a stock" (the player pool, as ESPN / Sleeper / Yahoo keep it) plus
  a "Watching" section on the Portfolio tab ("See all (N)" opens the tab); one list behind
  both. Rows: ticker + one status line (availability in this league, or "Claimed · fills Mon
  9:30 AM ET"); Buy only while the market is open; Claim only while closed, also on "No free
  … slot" rows since the claim names the sale that frees the slot. Names: Save/Saved (star)
  and Claim/Claims; never "Queue" (the draft's word) or "Order".
- **League features follow fantasy football, not a brokerage** (2026-10-08): anything that
  belongs to a league (watchlist, draft, waivers-like queues, standings, trades between
  managers) is modelled on how ESPN / Sleeper / Yahoo fantasy football do it; brokerage
  conventions (Robinhood) apply only to money surfaces (portfolio value, a stock's price and
  chart, buy/sell mechanics). Giorgio: "i need you to research fantasy football so that this
  doesnt come up." Reference: [`design/FANTASY_CONVENTIONS.md`](design/FANTASY_CONVENTIONS.md).
- **You can only sell what you own** (2026-10-09, on seeing 1.1.0's trade
  screen): "the sell option still has a search bar...thats not correct. i can only sell what
  i have so it should be a dropdown list or something. i shouldnt be able to search any
  stock, only see what i haave. cant sell what you dont own." So: you can only sell a stock
  you hold; the sheet of a stock you don't own does not offer Sell at all (enforced in 1.2.0
  by fix/sell-only-held); the 1.1.0 search-to-sell screen is retired with 1.2.0. A stock you
  DO hold can be sold from wherever its sheet opens, including from search (2026-10-10,
  option A, board #call-sell-from-search): the same stock's sheet looks the same from any
  entry point.

## League lifecycle

- **League size** (2026-10-06): a league needs at least 4 managers to draft, and every
  manager is a real person. Bots and the manual Start button are testing tools for the
  test account only; they are never a product feature, and no rule about players is ever
  written around them. (Code: `MIN_DRAFT_MEMBERS = 4` in
  `supabase/functions/draft-control/rules.ts`; the draft order also waits for 4.)
- **Playoffs:** the commissioner sets any playoff team count P from 2 up to the number of
  managers (never more). The bracket is derived (weeks = ceil(log2 P); byes to the top
  seeds). Rounds are named by teams left: Final / Semifinals / Quarterfinals / Round of
  16; a first round with byes is "Wild card".
- **Leaving a league** (2026-10-06): "a player cannot leave a league after a draft, they
  are locked in for that season." The window: "you can only leave before a season starts
  (the hour before the draft) or after it is over."
  - So leaving is allowed until T−1h and after the season. After the season, "leave" hides
    the league for that player; history is kept.
  - When someone leaves before the draft, the commissioner must reconfirm: "move forward
    with 1 less" or "invite someone new to replace".
- **The leave sheets keep "Stay" as a button** (2026-10-06, Giorgio overruled the Design
  Lead's G-3): "I want stay as a button." "Leave league" stays the red button.
- **Share hides while teams are locked** (2026-10-13; Giorgio picked B (board #call-share-locked),
  relayed by the Orchestrator during the W4 League gate): the invite row's Share is hidden from an
  hour before the draft until the season ends, for members and the commissioner alike; the invite
  code itself stays visible. Share is shown before the draft (a renewed season too), when a code
  can be used; hidden while locked and after the season, until a renewal (a completed season
  refuses a join: preview-league's 'season_completed'). No new copy.
  **No joins once the room opens** (2026-10-14, Giorgio, relayed by the Orchestrator): "once
  the draft room opens (an hour before) the league is considered started. no one can join and
  the share link cannot work". The server now enforces it (20261123000000): from T−1h a code is
  refused by join-league and by the preview, the same moment Share hides, with the
  started-draft refusal ('draft_started'), so no new copy. Run it back answers lock at the same
  moment (Giorgio, 2026-10-14; see Run it back). A league short of 4 managers when
  its room would open is postponed then, at the T−1h gate, never left for the start (the
  auto-start gate already did this; now pinned by test). A postponed draft has no time, so
  its code works again and Share comes back.
- **The commissioner** (2026-10-06): "A commissioner cannot leave, but a commissioner can
  transfer that title to someone else and then leave." "A commissioner can only hand over
  the title before or after a season." The season runs from when the draft room opens
  (T−1h) to the season's end. Transfer is a separate action from leaving.
- **Run it back** (2026-10-04): a finished league can be renewed with the same group, as a
  new season.
  - Only the commissioner starts it.
  - Every Season 1 player answers "I'm in" / "I'm out" and can flip until the draft is set.
    **Answers lock when the draft room opens** (2026-10-14, Giorgio, relayed by the
    Orchestrator): from T−1h an "I'm in" or "I'm out" is refused ("The draft has started, so
    answers are locked."), as joining is (see "Share hides while teams are locked"). This
    SUPERSEDES the design's rev 3.1 "free flips until the draft starts". A postponed draft
    takes answers again.
  - The commissioner sees each reply on "Who's running back". "Running back" is Giorgio's
    copy, with the name in bold.
  - The draft can't be set while replies are pending.
  - Newcomers can join by code and aren't blocked by Season 1's team count.
  - It's always a NEW draft (no keepers), and settings carry over.
  - Ships switched ON in 1.2.0 (Giorgio, 2026-10-11: "run it back on 1.2.0 ON").

## Onboarding

All 2026-10-14, in the Planner session. Plan: [`plans/2026-10-14-onboarding.md`](plans/2026-10-14-onboarding.md).
Research: [`design/reviews/onboarding-best-practices-2026-10-14.md`](design/reviews/onboarding-best-practices-2026-10-14.md).

- **Plan before build:** "that onboarding is going to be very important when a when a user
  first downloads the app. And I don't want it to be done without our clear plan implemented."
- **The first-time user is the invited friend:** "this app would mainly be shared through like
  invited friends. One person finds it, thinks of the idea, and they share it with their group
  of friends to join. I think that's going to be the main way in which users are like discover
  the app and join."
- **The invite is a link, not a code:** "just sending a text code isn't going to do anything if
  they don't have the app downloaded. So it should be a link that then would... do like one of
  two things. If they already have the app downloaded, it'll automatically like bring them to
  the app. And then from there, once they make their account and onboard, it'll automatically
  have them join that league. Or if they don't have the app, it'll redirect them to like the
  web page version just on a browser. And the same thing, if they make, once they make an
  account, they join the league. And then there's going to obviously be something on that web
  page that prompts them to download the app." The join from a link is automatic (no extra
  tap); the web page does one job (join) then "You're in {league}. Get the app to draft and
  play."
- **Three sign-in options:** "we should absolutely give the option. So there should be three
  options. One is just like email and password. Then we absolutely need to add sign in with
  Apple and Google. Because I feel like most users are going to just want to click that and
  then have their thing linked."
- **A pre-generated username:** "when they get to that, like creating their username screen, I
  feel like one good practice is to, when possible, give like a pre-generated thing so they
  don't have to type out something long… we're already going to have like a pre-set username
  that they can just go with and they can change later." One username screen after ANY sign-in,
  pre-filled, one tap to keep; the email form has no username field; changeable in Profile.
  **The suggestion is a gamertag, never a name** (2026-10-14, board `#call-ob-username`: none of
  the three drawn styles): "I want the username to be generated not by putting someone's first
  name and then two digits, but doing it in the style that kind of like Xbox does for their gamer
  tags. So when you first log in, make an account, it gives you like typically some sort of
  adjective or word and then like a animal. So it'll be like helpedhornet151 or something like
  that. Something kind of playful and also unique that way. I mean, if there's a bunch of signups
  and it's all like Bob 11, Bob 12, Bob 13, I feel like that's just kind of that. And also, we
  don't know if users want to keep their name visible. So let's not expose their first names if
  maybe that's something they don't want." So the generator is always {adjective or word}
  {animal}{digits} (e.g. "HelpfulHornet151"), and it never uses a first name or anything else
  from Apple, Google or the email address: a privacy rule as well as a style. The line under the
  field, "You can change it later in Profile.", is approved.
  **Clarified the same day (2026-10-14, W2 auth review) (A):** the rule is never SHOW or USE a name.
  His words: "I meant never show it. Like if someone joins the app, I would rather the username
  not automatically have their actual name in it just in case they don't want that shown. But
  obviously if we're taking in their, they're using Google or Apple or something like that that
  shares their name, then that's fine. It was mainly just changing how the username is
  automatically generated." The decision: the name from Apple / Google is stored (by Supabase, in
  `auth.users.raw_user_meta_data`, `auth.identities.identity_data` and each JWT's `user_metadata`)
  but never read or shown by the app, and the username generator never uses it. No scrub trigger.
  The app requests the email scope only (Apple asks for no name scope at all) and nothing in the
  app reads, copies or logs that metadata.
- **Email links use PKCE one-time codes (B)** (decision, 2026-10-14, W2 auth): the email-confirmation
  link and the password-reset link carry a one-time code (`flowType: 'pkce'`), not session tokens.
  Rationale: a link opened on another device, or intercepted by another app, can't be used, because
  the code only exchanges with the verifier held by the app that started the flow (so no stored
  nonce is needed any more). Opened on another device, the confirmation simply falls back to signing
  in with the password (accepted). "Didn't receive it? Send again" stays, on both Check-your-email
  variants (invite and no invite); it repeats `signUp` for the same address, because Supabase's
  `resend()` sends no code challenge.
- **Google uses native one-tap with the nonce check skipped; Apple keeps its nonce (C)** (decision,
  2026-10-14, W2 auth; "option 1"): Google's sign-in is `@react-native-google-signin`'s native
  one-tap, its ID token passed to `signInWithIdToken` with no nonce, and the Supabase Google
  provider has "Skip nonce checks" ON. Apple sends a SHA-256-hashed nonce and passes the raw value.
  Rationale: Google's sign-in itself stays verified (signature, and audience = our own client IDs);
  the nonce would only add replay protection, which the native Google library can't supply. The
  residual risk: a captured Google ID token could be replayed within its validity window. It is
  bounded to tokens issued to OUR iOS / web client IDs, because the Google provider's Client IDs
  list must hold exactly those two and nothing else.
- **The three cards show only on a cold install** (no invite): "B, cards only for cold
  installs." Skip is remembered forever; link arrivals never see them; "How it works" lives in
  Profile. The card titles stay as approved on 2026-09-29. **The scenes are B, the real
  screens** (2026-10-14, board `#call-ob-cards`): the draft squares with their category lines,
  the Matchup scoreboard with the lead changing, and FINAL with the real scoreboard; not the
  2026-09-29 "VS" and tug-bar scenes.
- **Email confirmation:** "Apple and Google sign-ins are already verified, but if you just do
  email and password, you have to confirm your email. I think that way we can block fake
  addresses. I think it's still good for security's sake." The confirmation link must bring an
  invited friend straight back into the join.
- **Push permission** is asked right after joining or creating a league, with one line of why,
  never during sign-up (recommendation taken).
- **The new onboarding strings** (2026-10-14, approved via the Planner, shown the board frames:
  "fine"), verbatim:
  - **"Not now"**, a text link under the notifications pre-prompt's "Continue". A user who taps it
    is never pre-prompted again; notifications stay reachable in Settings.
  - **Check your email** after an email sign-up: with an invite, "We sent a link to {email}. Tap
    it to finish joining {league}." with "Didn't receive it? Send again"; with no invite, "We sent
    a link to {email}. Tap it to finish creating your account."
  - **The "Email confirmed" chip** (✓, in the chip's capitals) above "Pick a username" when the
    confirmation link brings you back.
- **The inviter's name** shows on the invite page and the link-arrival preview ("{Roberto}
  invited you to {Stock Scudetto}"); the inviter only, nobody else (recommendation taken;
  amends the 2026-10-11 "no commissioner name" rule for link arrivals only).
- **Before sign-in the invite shows the league's name and the inviter, nothing else**
  (2026-10-14, board `#call-ob-arrival`: **B**). The no-sign-in preview returns only the name,
  the inviter and why a link can't be used (the Planner's security ruling), so the arrival, in
  the app and on the web page, is "{inviter} invited you to {league}" (no inviter: "You're
  invited to {league}"; while the preview loads, or when it can't be reached: "You're invited to
  a league", the B call's own fallback), then Continue with Apple, Continue with Google, Use
  email. No Managers / Draft / Stakes / Season card before sign-in.
  - **The facts move to "You're in {league}"** (same call: **C1**): a card with Managers, Stakes
    and Season under the draft sentence in the app; the web page, which has no draft sentence,
    adds a Draft row. Not on the pre-draft Home.
  - **When the link can't be used**, the yellow warning panel replaces the buttons, with "Sign in"
    under it (approved via the Planner), verbatim: "{league} is full. Ask whoever invited you if
    they can make room." / "{league} isn't taking new players right now." / "This invite link
    doesn't work anymore. Ask for a new one."
  - **A dead link has no heading** (the Planner, 2026-10-14): that screen is only "This invite
    link doesn't work anymore. Ask for a new one." and "Sign in".
  - **"Ask whoever invited you" belongs to the invite-link flow only** (the Planner, 2026-10-14):
    a "full" refusal after the join, when the friend arrived by link, also reads "{league} is
    full. Ask whoever invited you if they can make room." Everywhere else (a typed code, and so
    on) the shipped "Ask your commissioner if they can make room." stays.
- **No theme choice in onboarding** (System by default, Profile › Appearance), and the game's
  unfamiliar ideas (the week window, dollars decide) are taught in place, one line, once, on
  the first pre-draft Home and in the first draft room, never on a launch card.
  - **The pre-draft Home line:** "Your week runs Monday's open to Friday's close. Best
    performance wins." (the plan's line, with its ending set by "Generic scoring copy" above:
    onboarding says "best performance wins", never "best dollar gain").
  - **The draft-room line** (the Planner, 2026-10-14), verbatim: "Out of time? We pick for you:
    your queue first, then the best stock that fits your league's rules." Shown the first time
    someone enters any draft room, in the same first-time tip above the board; it goes away on
    a tap of its × or on that person's first pick, and never shows again. "First pick" means
    the first pick recorded for them, an auto-pick included (the line explains auto-picks); a
    refused pick does not count (Design Lead, onboarding W4 gate, 2026-10-15).
- **One no-league empty state on every tab** (Home, Matchup, League, Portfolio): Create a
  league / Join with a code (recommendation taken).

## How decisions get made

- Every product/design choice goes to Giorgio as side-by-side mockups ("Your call" on the
  board), with a recommendation, never as prose only.
- **The board shows only open calls** (2026-10-12): "the app screens like page that it shows
  me when it wants me to pick between different mockups needs to be cleaned up. There are so
  many sections up top for me to choose from. It is kind of difficult to find what I need
  to. It there should be like an archive of picks that have been decided, and that should
  only show me like the ones that are in progress. Because it's turning into it's because
  it's getting too messy." So: the top navigation and the opening of the board list ONLY the
  "Your call" sections still awaiting Giorgio, newest first; every decided call moves to a
  collapsed **Archive** at the end, stamped with the decision and date (and the PR that
  recorded it). A section is archived the moment its decision is recorded here. Approved
  key screens stay on the board as the reference, under their own heading, not mixed with
  the calls.
- A rule is recorded here the moment it's decided. If a rule here and the code disagree,
  the code is wrong until Giorgio says otherwise.
- **UX standard** (2026-10-06): every screen and flow is designed, built and reviewed against
  the eleven rules in [`design/UX_RULES.md`](design/UX_RULES.md). Audit findings graded P0/P1
  block the 1.2.0 cut; P2/P3 go to a 1.3 backlog. A product rule beats a UX rule; a UX rule
  that seems to contradict one is a question for Giorgio, not a finding. Plan:
  [`plans/2026-10-06-ux-rulebook.md`](plans/2026-10-06-ux-rulebook.md).
