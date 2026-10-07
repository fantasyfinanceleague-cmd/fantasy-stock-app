# UX rules

**The UX standard every screen and flow is designed, built and reviewed against.**
Approved by Giorgio on 2026-10-06 (plan: [`../plans/2026-10-06-ux-rulebook.md`](../plans/2026-10-06-ux-rulebook.md)).
It sits beside [`DESIGN_DIRECTION.md`](DESIGN_DIRECTION.md) (visual identity, tokens, motion,
the craft floor) and [`../PRODUCT_RULES.md`](../PRODUCT_RULES.md) (what the product does).
This file says how a screen must *behave for the person using it*.

- **Owner:** the Design Lead. It proposes changes to Giorgio; it never edits a rule silently.
- **Checked by:** the `ux-reviewer` subagent at every UI gate, and by the Design Lead's gate
  report (see [`UI-UX-PROGRAM.md`](UI-UX-PROGRAM.md), "Design review gate").
- **Source:** the eighteen Laws of UX that apply to this app ([lawsofux.com](https://lawsofux.com/)),
  collapsed into eleven rules so that one decision is checked once, not six times.
- **Precedence:** a product rule beats a UX rule. If applying a rule here would change what the
  product does (not how it looks or responds), that is a question for Giorgio, not a finding.

Each rule has three parts: **what we do**, **what it means here** (this app's screens), and
**how the gate checks it**. A rule with no check is advice, and advice drifts.

---

## 1. Familiar first

*From: Jakob's law, Mental model.*

**What we do.** Follow iOS conventions and the patterns of the apps our players already use:
Robinhood for money, Sleeper for leagues. We depart from them only with a stated reason.
Where the product deliberately differs from what a fantasy or brokerage app does, we say so
**at the moment it matters**, in place, not on a rules page nobody reads.

**What it means here.** Whole-position trades (no partial sells), dollars decide (percent is only
the tiebreak), byes are no result, the draft starts by itself, a missed turn is auto-picked:
every one of these contradicts a habit the player brings. Each gets a one-line explanation
where the player meets it: the trade sheet, the standings row, the draft countdown.

**How the gate checks it.** Each screen names its reference pattern (which app, which screen).
Each deliberate departure from that pattern or from the fantasy/brokerage model has an in-place
one-liner, and the reviewer can point at it.

## 2. Few choices, one primary

*From: Hick's law, Choice overload.* (Existing rule, DESIGN_DIRECTION gate; kept here.)

**What we do.** At a decision point, at most four options are visible, and exactly one is the
primary action.

**What it means here.** A sheet with Buy / Sell / Watch / Close is at the limit. League settings
are grouped so no group asks more than four things at once. Draft time is a picker, not a form.

**How the gate checks it.** Count the options at each decision point; find the one primary.

## 3. Reachable targets

*From: Fitts's law.*

**What we do.** Every tappable thing is at least 44 × 44 pt (existing rule). The screen's primary
action sits in the thumb zone (the bottom third) or is a full-width control. A destructive action
is never adjacent to the primary one.

**What it means here.** Make pick, Confirm trade, Join, Set draft time: bottom of the screen or
full width. Leave league and Sell never sit beside Buy or Confirm.

**How the gate checks it.** Measure the hit area; check the primary action's position; check
that no destructive control touches a primary one.

## 4. Chunk it

*From: Miller's law, Chunking, Working memory, Cognitive load.*

**What we do.** Groups of five to seven. Money and numbers formatted in chunks ($1,234.56, never
1234.56). And the rule that matters most: **never make the player remember something from
another screen.** Whatever limit a decision is subject to is shown where the decision is made.

**What it means here.** The trade sheet shows the budget, the slot it fills ("Fills your
$100–$200 slot") and the sale that pays for it. The draft shows the slots still open and the
budget left. The join preview shows what you are joining (stake mode, slots, draft date) before
you join. The playoff setting shows how many managers the league has.

**How the gate checks it.** Any list over seven items is sectioned or grouped. Every sheet shows
the limit it enforces. The reviewer asks, for each decision: "what would I need to have
memorised from elsewhere?" The answer must be nothing.

## 5. One cue per group

*From: Law of proximity, Common region, Similarity, Uniform connectedness.*

**What we do.** A group is made by **one** visual cue: space, or a card, or a rule line, never
several stacked. The same kind of thing looks the same on every screen: one row style for a
manager, one for a holding, one for a matchup.

**What it means here.** `Card` is the container; spacing on the 8 pt grid is the separator.
A manager row in standings, in the schedule and in the draft order is the same component.

**How the gate checks it.** The squint test (blurred, the groups still read in order). The
"same component for the same thing" check across every screen on the branch and on main.

## 6. One thing stands out

*From: Von Restorff effect, Selective attention.*

**What we do.** Each screen has exactly one emphasised element, and it answers **the question
of the day**.

**What it means here.** Home's hero answers the phase: before the draft, "when is the draft?";
Monday, "what do I hold?"; mid-week, "am I winning?"; Friday, "did I win?"; after the season,
"who won?". Team colours mark people, green/red mark money (existing rule), so emphasis never
competes with the money signal.

**How the gate checks it.** Blurred, one primary element shows. The Home hero matches the
league's phase in every state of the stress fixture.

## 7. First and last

*From: Serial position effect.*

**What we do.** The most important fact is first; the action is last. Tabs are ordered by how
often they are used. In any list the player is part of, their own row is pinned or marked,
never lost in the middle.

**What it means here.** Tab order Home · Matchup · League · Portfolio stands unless usage says
otherwise. Standings pin the player's row. The draft order marks "you". A matchup puts the
player's team first.

**How the gate checks it.** Per screen, the reviewer names what is first and what is last and
why. Any list containing the player shows them without scrolling to find themselves.

## 8. The system carries the complexity

*From: Tesler's law, Postel's law, Paradox of the active user.*

**What we do.** Safe defaults. Forgiving input: search accepts a company name or a ticker in
any case; league codes ignore case and spaces; pickers cannot produce a value the server will
refuse. **Every refusal the server can return is explained in place, with what to do next.**
Players do not read manuals; the refusal is the only place they will read the rule.

**What it means here.** The draft-time picker offers only :00/:15/:30/:45 and at least an hour
out, so `draft_time` can never be refused for shape. The server's refusal reasons each map to a
message and a next step: `market_closed` → "Market's closed. Opens Mon 9:30 ET."; `no_eligible_slot`
→ "No free slot fits $X. Sell a $100–$200 position first."; `roster_reconfirm_required` → the
commissioner's reconfirm choice; `not_your_turn`, `over_budget`, `symbol_owned`,
`trade_conflict` (retry), `calendar_unavailable` (try again shortly) likewise. The full table
lives in the audit document and is kept current.

**How the gate checks it.** The reviewer lists every `reason` the functions on the branch can
return (`record-trade`, `validate-and-record-pick`, `draft-control`, `join-league`,
`leave-league`, `preview-league`) and finds its in-place message and next step. A reason with
no message is a P0 on a money or draft action, P1 elsewhere.

## 9. Never leave them waiting blind

*From: Doherty threshold, visibility of system status (Nielsen).*

**What we do.** A visible response to every tap within 400 ms. Skeletons, not spinners, while a
screen loads. Optimistic updates where a wrong guess costs nothing (draft queue order, settings,
appearance), **never for money or picks**: a trade or a pick shows "Sending…" and then the
server's answer, and nothing on screen claims it happened before the server says so. The
system's state is always visible: the pick clock, market open/closed and when it opens next,
"scores Friday 5 pm ET", "snapshot pending".

**What it means here.** `record-trade` and `validate-and-record-pick` are the two places a
fabricated success would mislead someone about money or a roster. The client mirrors the
server's own lesson (CLAUDE.md: "verify the effect, not the status"): it renders the response,
not its hope.

**How the gate checks it.** Tap → a visible change under 400 ms on a throttled device (the
recording shows it). Every async state has a designed look, including failure. No money or
pick UI updates before the response.

## 10. Show progress, leave a hook

*From: Goal-gradient effect, Zeigarnik effect.*

**What we do.** Anything multi-step shows where you are and what is left. Anything that is
waiting **on you** stays visible on Home until it is done.

**What it means here.** Draft: "Round 11 of 16 · 3 picks until you". Onboarding: create →
invite → set the draft date, with the done steps ticked. Season: "Week 4 of 8", then the
playoff round name. Pending-on-you states that must surface on Home: no draft date set
(commissioner), a roster to reconfirm after someone left, an "I'm in / I'm out" reply for Run
it back, an invite code still unshared when the league is below four managers.

**How the gate checks it.** Every multi-step flow has a progress mark. Every pending-on-you
state in the stress fixture has a Home surface, and it disappears when the state resolves.

## 11. Design the peaks and the endings

*From: Peak-end rule, Flow.*

**What we do.** Each key flow has one authored peak and **a designed ending**. Nothing
interrupts a player mid-pick or mid-trade.

**What it means here.** The peaks exist (the Friday reveal; the signature moments S1–S6, H1–H6,
G1–G6, M1–M5). The endings are the gap: after a pick ("Yours. Next pick in 4 turns."), after a
trade (the confirmed position, the slot it filled), draft complete (the roster, the first week's
date), week over (the result, the record), season over (the champion, the player's finish, Run
it back). No push, sheet or toast arrives while the pick clock is running for you or a trade
sheet is open.

**How the gate checks it.** A table of flow → peak → ending exists in the audit document; every
ending is named and shown on the board. The reviewer confirms nothing interrupts the two
protected moments.

---

## What the reviewer reports

For every gate, the `ux-reviewer` returns:

1. **Scope examined:** which screens, which states (phase, theme, text size, Reduce Motion),
   which recordings. A finding's verdict never exceeds its evidence; "not examined" is a row,
   not an omission.
2. **Findings:** one row each: screen · rule # · what is wrong · proposed priority · suggested fix.
3. **Rule 8 table** (refusal → message → next step) and **rule 11 table** (flow → peak → ending)
   for the screens on the branch.

The Design Lead answers every finding one of three ways: **fixed**, **accepted with a reason**,
or **escalated to Giorgio**. Silence is not an answer. Priority definitions are in the plan.
