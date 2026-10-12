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
- **Giorgio's copy stays verbatim.** Propose changes; don't rewrite his words. A factual
  error goes to him as a decision.
- **Generic scoring copy:** rules, marketing and onboarding say "best performance wins",
  never "best return" or "biggest dollar gain", because capital varies by stake mode.
- **1.2.0 TestFlight** ships only when EVERY screen is on the new UI, after Giorgio's
  full walkthrough. Phone only (`supportsTablet: false`); iPad is a later project.
- **Bots and the manual draft Start are testing tools only** (2026-10-06): bots exist "simply to simulate drafts" and "will get removed"; they're "not going to be a feature in the actual app". A real league always has real players, so never design product behaviour, copy or decisions around bot-only or one-real-player leagues. The manual Start is likewise "simply for testing purposes"; auto-start is the real feature. See **League size** under League lifecycle.
- **Board review answers** (2026-10-06): "Buy a stock" (tappable-but-blocked ownership, the
  Portfolio entry row, the search copy) and the stock chart ("A week ago" as the comparison
  line): "fine".
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

## Home and Portfolio

- **Home shows only the selected league**, with the league pill ("+N" hint) to switch.
  There's no "your other leagues" row.
- **Home hero:** team value is the big number; under it "+$X · +Y% season gain · +$Z today".
  The Home chart plots season gain, week by week.
- **Portfolio's gain is "since the draft"** (value − cost). It's deliberately a different
  label from "season gain"; never reuse one for the other.
- **Stock chart ranges** (2026-10-05, option A): 1W / 1M / 3M / 1Y, with 1W the default.
  There's no 1D, because the price history (historical-bars) is daily bars only.
- **Cash from sales** (2026-10-05, option A, budget-cap and price-tier leagues): a sale's cash
  shows as its own "Cash from sales" line, and the header value includes it, matching Home.
- **Market-data credit line**: credit Alpaca on price surfaces.
- **Appearance:** System / Light / Dark. One layout and component set with two complete
  themes; no screen mixes them.

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
- **Auto-pick picks a good stock**: the manager's queue first, then the best available,
  meaning the largest market cap that fits. It must NEVER break the league's criteria
  (price brackets, category slots, budget, the draftable universe).
- **Pick clock:** 60 s default, commissioner-configurable 30–90 s.
- **Draft order:** a league setting with two modes, Random or Manual, never an automatic
  commissioner-first. Both lock at T−1h. If Manual was never saved, the random order
  locks. The order is set at the later of T−1h and the league reaching 4 members. A
  joiner after T−1h picks last.
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
- **The draft board's look** (2026-10-06): Giorgio is "not a fan" of the current draft
  board UI. A redesign is wanted, but later ("save that for later"), not in the current
  pass.

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
- **The commissioner** (2026-10-06): "A commissioner cannot leave, but a commissioner can
  transfer that title to someone else and then leave." "A commissioner can only hand over
  the title before or after a season." The season runs from when the draft room opens
  (T−1h) to the season's end. Transfer is a separate action from leaving.
- **Run it back** (2026-10-04): a finished league can be renewed with the same group, as a
  new season.
  - Only the commissioner starts it.
  - Every Season 1 player answers "I'm in" / "I'm out" and can flip until the draft is set.
  - The commissioner sees each reply on "Who's running back". "Running back" is Giorgio's
    copy, with the name in bold.
  - The draft can't be set while replies are pending.
  - Newcomers can join by code and aren't blocked by Season 1's team count.
  - It's always a NEW draft (no keepers), and settings carry over.

## How decisions get made

- Every product/design choice goes to Giorgio as side-by-side mockups ("Your call" on the
  board), with a recommendation, never as prose only.
- A rule is recorded here the moment it's decided. If a rule here and the code disagree,
  the code is wrong until Giorgio says otherwise.
- **UX standard** (2026-10-06): every screen and flow is designed, built and reviewed against
  the eleven rules in [`design/UX_RULES.md`](design/UX_RULES.md). Audit findings graded P0/P1
  block the 1.2.0 cut; P2/P3 go to a 1.3 backlog. A product rule beats a UX rule; a UX rule
  that seems to contradict one is a question for Giorgio, not a finding. Plan:
  [`plans/2026-10-06-ux-rulebook.md`](plans/2026-10-06-ux-rulebook.md).
