# UX audit, October 2026

The audit the UX rulebook plan calls for ([`../../plans/2026-10-06-ux-rulebook.md`](../../plans/2026-10-06-ux-rulebook.md),
W2 and W5), graded against the eleven rules in [`../UX_RULES.md`](../UX_RULES.md). Owner: the
Design Lead. Priorities use the plan's fixed definitions (P0 broken or misleading; P1 a rule
broken on Home, Matchup or Draft, or inside a money/draft flow; P2 elsewhere or an
inconsistency; P3 polish). **P0 and P1 block the 1.2.0 cut.**

- **Pass 1** (this section): 2026-10-06, designs and branch code, before 3c/3e reach their gates.
- **Pass 2**: appended at each 3c / 3e gate, on the built screens on the simulator.
- **Final sweep**: appended after 3c and 3e merge, on `main`.

---

## Pass 1 · 2026-10-06

### What was examined (and what wasn't)

The verdict below covers exactly this evidence. "Not examined" means no verdict, not a pass.

| Evidence | Version | How |
|---|---|---|
| Key-screens board | `design/auto-start-strings` @ `21f5df6` (PR #135, the newest board) | Built and rendered in a browser, Light; every frame in Home, Matchup, League, Draft room, Portfolio + stock sheet, Home phases, Game (3c), Run it back, Auto-start, Trading (3e), Join |
| Merged Home (3b-2) | `main` @ `396864d` | **Source code only** (`app/(tabs)/index.tsx`, `components/home/*`, `lib/home/*`) |
| 3c game | `ui/mobile-game` @ `8ee0e28` | Source code (draft room, standings, matchup libs) |
| 3c-2 setup / auto-start client | `ui/mobile-league-setup` @ `656e192` (contains 3c) | Source code |
| 3e money | `ui/mobile-money` @ `31edba6` | Source code (trade review, refusals, sheet host) |
| Server refusals | `main` @ `396864d`, plus `feat/draft-auto-start` @ `3f0eb8d` (PR #133) for auto-start | Every `reason` in the six functions read from source, with status codes |

**Not examined in pass 1** (each is a gap, carried to pass 2 or the final sweep):

- **Anything on a device.** The plan asks for merged Home on the simulator; I haven't started
  one (it's shared, and the Orchestrator approves its use). So no Light/Dark device captures, no
  XL/XXXL text, no Reduce Motion recordings, no stress fixture, no tap-latency (rule 9's 400 ms)
  for any screen. The handoff's Home follow-ups **F1** (tab labels at XXXL) and **F2** (Reduce
  Motion evidence for the Season → 1W chart) are still open and unverified. *(Update: merged
  Home was then checked on the simulator, and F1 and F2 both pass. See "Pass 1b" below.)*
- **The league pill sheet** (one of the seven in-scope screens): not examined in pass 1.
- **3e's committed captures** (`docs/design/reviews/captures/ui-mobile-money/*.png`) and 3c's
  built screens: deliberately left for pass 2, where they are graded against this pass's
  findings.
- **3f join and the `sp/` primitives:** merged without a capture gate (handoff §2). I read
  join's refusal code (rule 8 table below); its screens get a capture check in the final sweep.
- **Create league steps 1 and 4, the slot editor, League settings and the "{Name} is ready"
  screen:** not on the board yet (queued frames, handoff §4), so there is no spec to grade.
- **Web:** out of scope (plan, decision 6).

### Summary

| | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| Open | 4 | 22 | 11 | 11 |

(Counts as of the simulator pass below: U-27 left P1 when it turned out to be built; U-49 to U-51 were added on device.)

All P0s and the spec-level P1s were relayed to the Orchestrator for the 3c-2 and 3e workers
on 2026-10-06 (status column). Two P1s are layout changes and went to Giorgio as "Your call"
mockups (board `#call-ux-pass1`, PR #140); **he chose B for both on 2026-10-06** (U-16, U-17).

**Rules that pass on the designs** (no finding): rule 1 (every product departure has its
in-place line: whole-position sells on the sheet, the tiebreak beside the score, the Bye chip,
"the draft starts automatically", "If you step away, we'll auto-pick from your queue"); rule 6
(Home's hero follows the phase in every phase frame); rule 2 except the two accepted
exceptions (U-42).

### Findings

`Status`: **relayed** = sent to the worker as a change via the Orchestrator · **call** = a
"Your call" mockup for Giorgio · **board** = a board frame the Design Lead owes · **backlog** =
P2/P3 for 1.3 unless cheap. Paths are `apps/mobile/` unless noted.

#### P0

| ID | Screen | Rule | What's wrong | Fix | Status |
|---|---|---|---|---|---|
| U-01 | Draft room (3c) | 8 | `lib/game/draftRoom.ts:72-73`: `would_strand_slot` and `budget_reserve` render the literal strings "[new copy: would_strand_slot]" and "[new copy: budget_reserve]". The server sends both on main. | Use the ruled board copy (`#game`, "Pick refused" frames) plus the shared next step (rule 8 table). | relayed |
| U-02 | Draft room (3c) | 8 | `lib/game/draftRefusals.ts:50-58`: a stalled turn shows "[new copy: stalled_waiting]" and "[new copy: stalled_commissioner]". | The board's "Draft paused" copy (rule 8 table, `stalled`). | relayed |
| U-03 | Draft room (3c) | 9 | `components/game/DraftRoom.tsx:125` renders the clock as `0:${secondsLeft}`, so a 75 s or 90 s clock (the commissioner range is 30–90 s) reads "0:75" or "0:90". A wrong number on the clock. | Format m:ss. | relayed |
| U-04 | Draft room (3c) | 9 | On a network failure or a 5xx, `DraftRoom.tsx:96-99` shows "That pick can't be made." The pick may have been recorded (a timeout after the write), so the screen claims a refusal it doesn't know about. No refresh follows the error. | Unknown outcome: "Couldn't confirm your pick. Checking…", refresh, and let the board speak. Same rule 3e already follows ("We couldn't confirm the trade…"). | relayed (as P1; raised to P0 here: it misstates a draft outcome) |

#### P1

| ID | Screen | Rule | What's wrong | Fix | Status |
|---|---|---|---|---|---|
| U-05 | Draft room (3c) + Home drafting card | 10 | The room shows "Round {r} · Pick {p}" only; Home shows "Round 2 · Pick 11 · you're up in 3 picks". Neither says how many rounds. The plan's walkthrough check (2) is "Round N of M · K picks until you". | Room: "Round {r} of {rounds} · Pick {p}" and, off the clock, "{k} picks until you" (`picksUntilTurn` exists). Home: add "of {rounds}". | relayed |
| U-06 | Draft room (3c) | 4 | The built room shows no open slots and no budget left; the player must remember them from Portfolio or the lobby. (The board's key screen 4 has the strip, "Your roster · 1 of 6 · $2,000 per slot", under the search results; the build dropped it.) | Build the board's roster strip; budget-cap leagues show the budget left in place of the per-slot amount. | relayed (corrected) |
| U-07 | Draft room (3c) | 9 | While a pick is sending, the Draft button only greys out (no label, no spinner). | "Sending…", disabled. | relayed |
| U-08 | Draft room (3c), Home (main) | 9 | `DraftRoom.tsx` returns `null` while loading; merged Home also returns `null` while loading (`app/(tabs)/index.tsx:96-99`, "a skeleton card is a later polish item"). Both are blank screens. | Skeletons (`components/Skeleton.tsx` exists). Home's fix can ride 3c-2, which already touches Home. | relayed |
| U-09 | Draft room (3c) | 11 | After your own pick the built room clears the search and refreshes: no ending. (The board has one: key screen 4's "After the pick" state, "You took AAPL · next pick 14".) | Build the board's after-pick state, with "you're up in {k} picks" (Home's wording) in place of "next pick 14"; last pick: "You took {SYMBOL} · that's your team". | relayed (corrected) |
| U-10 | Draft complete | 11 | When every pick is in, the room pushes the legacy `/(tabs)/draft` route ("Finishing the draft…"), whose finalize error shows raw text in parentheses (`draft.tsx:440`, e.g. "Edge Function returned a non-2xx status code" or `schedule_plan_refused:…`). The board has no draft-complete frame. | A designed ending: your roster, then "Week 1 starts Mon {date} 9:30 AM ET". Worker leaves a `DraftComplete` seam; the Design Lead draws it. | relayed; drawn `3edfaf6` |
| U-11 | Draft room (3c) | 8 | Every `PICK_REFUSAL_LINES` entry is a fragment with no next step ("That stock is over your remaining budget"), two use em dashes, and the client never reads non-2xx bodies (`rate_limited`, `not_a_member`, `forbidden_target` arrive as 4xx and fall to the generic line). | The rule 8 table's lines; a shared `readFunctionRefusal` helper that reads `error.context.json()` (as 3e's `recordTradeOutcome.ts` and main's `joinPreview.ts` already do). | relayed |
| U-12 | League standings (3c) | 7 | `components/game/StandingsTable.tsx` renders every row and highlights yours, but doesn't pin it. With 16 managers you scroll to find yourself. Graded P1 (League is otherwise P2) because the plan's walkthrough check (4) makes it a cut criterion. | When your row is out of view, pin a copy of it at the foot of the card (same row component). | relayed |
| U-13 | League standings (3c) | 8 / a11y | `StandingsTable.tsx:36` VoiceOver label says "up N" for a move down. A wrong fact for a screen-reader user. | "down N" for negative moves. | relayed |
| U-14 | Draft room, trade review | 11 | `lib/notifications.ts` shows every foreground banner, so a push can land while your pick clock runs or a trade review is open: the two protected moments. | Suppress foreground banners while it's your turn in the room and while a trade review is open. | relayed |
| U-15 | Home, season complete (3c) | 10 | The member's "Are you in for Season 2?" card (`RenewalAsk`) is mounted only on the League tab (`LeagueRenewal.tsx`). The board puts it on Home and the League tab; rule 10 requires Home. | Mount it on Home's season-complete branch for members, beside the commissioner-only `RunItBackCard` (`index.tsx:148`); it leaves once they answer. | relayed |
| U-16 | Draft time sheet (3c-2) | 3 | The confirm is a header "Done" text link in the top corner; the only full-width button is "Set later". Also the picker saves as it spins and Done only closes, so a swipe-away half-saves. | ★B: full-width "Set draft time" at the bottom, × to close without saving, "Set later" as a text button. | decided B (Giorgio, 2026-10-06); relayed to 3c-2 |
| U-17 | Home, no draft time, commissioner (3c-2) | 10 | The one task blocking the league is the draft time, but the card's primary is "Build your queue" and its line sends the commissioner to League settings. | ★B: primary "Set draft time" opening the sheet in place; queue secondary. | decided B (Giorgio, 2026-10-06); relayed to 3c-2 |
| U-18 | Home, no draft time (main) | 10 | On main, a league with no draft date just loses the date and countdown lines: nothing says it's missing (walkthrough check 5). | Fixed on 3c-2 ("No draft time yet"; members "{Commissioner} will set the draft time."). Verify at the 3c-2 gate. | fixed on branch |
| U-19 | Trade review (3e) | 9 | The sheet's swipe (`MoneyHost.tsx:44`) and the review's "Edit" link (`TradeReviewPanel.tsx:73`) stay live while submitting; `reviewMachine.canDismiss()` is never called. A trade can execute with its outcome never shown. | Gate both on `canDismiss()`; §9B already says a mid-confirm trade review doesn't dismiss. | relayed |
| U-20 | Trade review (3e) | 9 | `useTradeSubmit` has no reset: after a refusal, Edit and a new review in the same sheet keep the old `refused` state with no button. (Code-read; confirm on device.) | RESET when a review opens (`StockSheetBody.tsx:186`). | relayed |
| U-21 | Trade review (3e) | 9 | Submitting shows a spinner with the label unchanged. | "Selling…" / "Buying…", disabled. | relayed |
| U-22 | Buy, which sale pays (3e) | 8 | `proceeds_unavailable` computes a `back_to_picker` footer that `TradeReviewPanel` never renders, and the "Which sale pays?" picker on the board isn't built (`whichSalePays` unused). The refusal has no next step, and a buy with two sales' cash can't choose its source. | Build the picker per the board; render "Pick another sale" for that refusal. | relayed |
| U-23 | Trade review (3e) | 8 | Every refusal other than `trade_conflict` and `calendar_unavailable` removes the primary button and leaves only the top "Edit" link, so none has a next step. `symbol_owned` reads "Owned by another manager" (a fragment; `ownerName` is never passed, `reviewPresentation.ts:51`). | The rule 8 table's next steps; pass the owner's name. | relayed |
| U-24 | Draft blockers card (3c-2) | 8 | Every `confirm_roster` refusal (`draft_started`, `invalid_playoff_teams`, `playoff_teams_exceeds_members`, `playoff_teams_not_applicable`, `not_commissioner`) shows "Your choice wasn't saved. Try again." Retrying can't fix any of them. | The rule 8 table's lines. | to relay |
| U-25 | League settings (3c-2) | 8 | `lib/game/settingsSave.ts:35-41`: any slot-save failure, a network error included, says the roster is locked because "The draft has started". Graded P1 though League settings is P2 ground: it misstates why. | Say the lock only on `league_rules_locked`; else "Your league details saved, but the roster didn't. Try again." | relayed |
| U-26 | Board, Draft room key screen | 10 / 11 | Key screen 4 lacks "of M" and "picks until you", and there is no draft-complete frame. Rule 11 requires every ending on the board. (Pass 1 first said the roster strip and after-pick state were missing too; they're on the board, below the fold of my capture. Corrected.) | Design Lead adds "of 6", the picks-until line and a draft-complete frame (W3). | drawn `3edfaf6` |
| U-27 | Board, season complete | 11 | Corrected: the non-champion ending IS built and approved (3b-2, rulings B6/S8: "{n}th place", "{League} · {record}", neutral disc); only the board lacked the frame. Downgraded from P1 to a board gap. Open question for Giorgio (rule 6, not a finding): the non-champion hero never names who won. | Board frame documents the build. | drawn `46a93de` |

#### P2

| ID | Screen | Rule | What's wrong | Fix | Status |
|---|---|---|---|---|---|
| U-30 | Create league done (3c-2) | 11 | The "{Name} is ready" ending is built (`createLeagueDone.ts`) but not drawn, so it has never been reviewed. | Draw it (queued, handoff §4). | board |
| U-31 | Run it back (3c) | 8 | A failed renewal is an `Alert.alert('Not started', …)`; refusals belong in the card. | Inline warn-tint line in the card. | backlog |
| U-32 | Trade review (3e) | 8 | 4xx `not_authenticated`, `league_not_found` fall to "That trade didn't go through." | "Your session ended. Sign in again." / "This league isn't available anymore." | relayed (if cheap) |
| U-33 | Trade review (3e) | 8 | `no_price` and `invalid_price` say "Try again" with no way to. | A "Try again" link, as `calendar_unavailable` has. | relayed |
| U-34 | Trade review (3e) | 8 | The unconfirmed copy ("Check your history before trying again.") has no link to the history. | "Open trade history" link. | backlog |
| U-35 | Join (main) | 8 | A 401 (expired session) shows "Couldn't reach the league. Check your connection…". | Session-ended line. | backlog |
| U-36 | Standings, Home vs League | 5 | Home's `StandingsCard` row and League's `StandingsTable` row are two components for the same manager row. | One manager row component, used by both (and the draft order, per rule 5). | backlog |
| U-37 | Trade review (3e) | 8 | `roster_full` and `not_draftable` have messages but no next step. | Rule 8 table. | relayed |
| U-38 | Join, `sp/` primitives | — | Merged without a capture gate (handoff §2). | Capture check in the final sweep. | sweep |
| U-39 | Leave league | 8 | No client calls `leave-league` on any branch; the League settings row is flag-gated with no `onPress`. Not graded as a UX finding (nothing to grade); escalated as a scope gap to the Orchestrator. All its reasons are in the rule 8 table so the build has them. | Assign the leave/transfer client to a workstream before 1.2.0. | escalated |

#### P3

| ID | Screen | Rule | What's wrong | Fix | Status |
|---|---|---|---|---|---|
| U-40 | Home standings excerpt | 5 | When you're below the top 3, the excerpt jumps 1, 2, 3, 9 with no break. | A thin gap or "…" row before your pinned row. | backlog |
| U-41 | Matchup, final | 11 | Only a win is drawn; the loss ending isn't. | Draw the loss banner. | board |
| U-42 | Pick clock (5 segments), chart range (5) | 2 | Five options. **Accepted with a reason:** each is one value scale, not five separate choices, and the native pattern is a segmented scale. | — | accepted |
| U-43 | Board, Create league · Draft step | 5 | Still labelled "Draft date"; everything else says "Draft time" (#135). | Rename in the frame. | fixed `3edfaf6` |
| U-44 | Board, draft frames | — | Product frames show "Bot" badges (Atlas · Bot). Bots are test-only (`PRODUCT_RULES.md`). | Replace with real sample managers. | fixed `3edfaf6` |
| U-45 | Home invite share (3c-2) | — | `PreDraftCard` share text hardcodes "Stockpile"; the name comes from `brand.name`. | Use `brand.name`. | backlog |
| U-46 | Trade review (3e) | 8 | "Trading hours unavailable. Try again shortly." doesn't follow the "X didn't load" pattern. | "Trading hours didn't load. Try again in a moment." | backlog |
| U-47 | Join (main) | 8 | `invalid_code` at join time (after a good preview) shows the generic line. | Reuse the preview's bad-code line. | backlog |
| U-48 | Draft room | 8 | `would_strand_slot` carries no manager or slot names, so only the generic line can show. | Backend: add `manager_name`, `slot_label` to the refusal (1.3). | backlog |

**Not findings** (checked and accepted): the Buy/Sell segmented control sits beside the sell
action, but it is a mode selector, not a second action (rule 3 is about actions); the
blockers card shows a disabled "Pick a new draft time" under "Move forward", but only one
primary is ever enabled (rule 2).

---

### Rule 8 table: refusal → message → next step

Every `reason` the six functions can return on `main` @ `396864d` (plus PR #133's auto-start
reasons). **Status codes matter:** reasons sent with a non-2xx status are readable only through
`error.context.json()` (functions-js throws `FunctionsHttpError` with the Response as
`context`). Lines marked **ruled** are Giorgio's or an earlier Design Lead ruling; lines marked
**new** are this audit's copy, ruled by the Design Lead (flag any to Giorgio on request).
"Today" is the best client on a branch (3c-2 for picks and draft control, 3e for trades, main
for join).

**Shared next step for a refused pick** (appended when it's your turn): "Your clock is still
running. Pick another stock." **new**

#### record-trade (3e)

| reason | HTTP | Message | Next step | Today |
|---|---|---|---|---|
| `market_closed` | 200 | "Trading opens {Mon 9:30 AM ET}." (title "Market closed"); no `next_open_at`: "Trading is closed right now." | Review button disabled, time shown | ✓ |
| `calendar_unavailable` | 503 | "Trading hours didn't load. Try again in a moment." **new** | "Try again" link | ✓ (copy U-46) |
| `trade_conflict` | 200 | "Nothing was traded: your league changed while this trade was going through. Try again." **ruled** (returned only after every CAS attempt wrote nothing) | "Try again" (re-fetches, then the player resubmits) | ✓ |
| `proceeds_unavailable` | 200 | "That sale's cash isn't available anymore. Pick another." **ruled** | "Pick another sale" → the picker | ✗ U-22 |
| `no_proceeds` | 200 | "There's no cash in your slots to invest." **ruled** | none (terminal) | ✓ |
| `no_eligible_slot` | 200 | Tier sentence from `price` + `open_slots` (**ruled**, option A, "Fills your $100–$200 slot" family); without them "This price doesn't fit an open slot." | "Sell a {range} stock first" → Portfolio **new** | message ✓, step ✗ U-23 |
| `symbol_owned` | 200 | "{Owner} already owns {SYMBOL}. A stock has one owner per league." **new** | "Pick another stock" | ✗ U-23 |
| `over_budget` | 200 | "{SYMBOL} costs more than your budget left." **new** | "Pick another stock" | ✗ U-23 |
| `roster_full` | 200 | "Your roster is full. Sell a holding first." | "Go to Portfolio" | step ✗ U-37 |
| `not_draftable` | 200 | "{SYMBOL} isn't in this league's list of stocks." **new** | "Pick another stock" | step ✗ U-37 |
| `not_owned` | 200 | "You don't hold {SYMBOL} anymore." **new** | Close; Portfolio refreshes | partial |
| `no_price` | 200 | "We can't price {SYMBOL} right now. Try again shortly." | "Try again" link | ✗ U-33 |
| `invalid_price` | 200 | "{SYMBOL}'s price isn't usable right now. Try again shortly." **new** | "Try again" link | ✗ U-33 |
| `draft_not_completed` | 200 | "Trading opens after the draft." | none | ✓ |
| `rate_limited` | 429 | "Too many trades in a row. Wait a moment and try again." | none (waiting is the step) | ✓ |
| `not_a_member` | 403 | "You're not in this league." | League pill | ✓ |
| `not_authenticated` | 401 | "Your session ended. Sign in again." **new** | Sign in | ✗ U-32 |
| `league_not_found` | 404 | "This league isn't available anymore." **new** | League pill | ✗ U-32 |
| `bad_request`, `method_not_allowed` | 400 / 405 | "That trade didn't go through." (client bug; never the player's doing) | Close | ✓ |
| `server_config_error`, `unhandled`, network | 500 / — | "We couldn't confirm the trade. Check your history before trying again." **ruled** | "Open trade history" | message ✓, link ✗ U-34 |

#### validate-and-record-pick (3c draft room)

| reason | HTTP | Message | Next step | Today (3c-2) |
|---|---|---|---|---|
| `would_strand_slot` | 200 | "Taking {SYMBOL} would leave {manager} with no stock that fits their {slot} slot. Every slot has to be fillable." **ruled**; generic "Taking {SYMBOL} would leave another manager with no stock for one of their slots." | shared | ✗ placeholder U-01 |
| `budget_reserve` | 200 | "{SYMBOL} would leave too little budget for your remaining picks." **ruled** (generic; the server sends no amounts) | shared | ✗ placeholder U-01 |
| `symbol_owned` | 200 | "{SYMBOL} is already taken." **new** | shared | fragment U-11 |
| `no_eligible_slot` | 200 | "{SYMBOL} doesn't fit any of your open slots." **new** (no `open_slots` on picks) | shared | fragment U-11 |
| `over_budget` | 200 | "{SYMBOL} costs more than your budget left." **new** | shared | fragment U-11 |
| `not_draftable` | 200 | "{SYMBOL} isn't in this league's list of stocks." **new** | shared | fragment U-11 |
| `no_price`, `invalid_price` | 200 | "{SYMBOL} has no usable price right now." **new** | shared | fragment / generic U-11 |
| `not_your_turn` | 200 | "It's {manager}'s pick now." **new** | none; the room shows whose turn | fragment U-11 |
| `pick_conflict` | 200 | "Someone picked at the same moment. Pick again." **new** | the board refreshes; shared | em dash U-11 |
| `draft_complete` | 200 | "The draft is over. Your team is set." **new** | → draft-complete ending (U-10) | fragment U-11 |
| `draft_not_in_progress` | 200 | "The draft isn't running right now." **new** | the room refreshes its state | fragment U-11 |
| `rate_limited` | 429 | "Too many tries at once. Wait a moment, then pick again." **new** | shared | unreadable U-11 |
| `stalled` (auto-pick) | 200 | Headline "No stock left fits {manager}'s next slot"; members "The clock is stopped and nobody is skipped. The commissioner has been told."; commissioner "The clock is stopped and nobody is skipped. The draft continues once the slot can be filled." **ruled** (board, minus "You've been notified;" on the commissioner's line, since they are reading it) | none (should-never-happen; the server recovers) | ✗ placeholder U-02 |
| `price_unavailable` (auto-pick) | 200 | "Auto-pick is waiting for prices. Nobody is skipped." **new** | none | not shown |
| `not_overdue`, `stale_pick_number`, `clock_not_running`, `draft_not_complete`, `skip_disabled` | 200 | Not player-facing (the client's own backstop or unreachable). Never shown. | — | ✓ ignored |
| `not_a_member`, `forbidden_target`, `target_not_member`, `league_not_found`, `bad_request`, `not_authenticated` | 4xx | "That pick didn't go through." **new**; 401 → "Your session ended. Sign in again." | shared, or Sign in | generic U-11 |
| `draft_order_invalid`, `server_config_error`, `unhandled`, network | 500 / — | "Couldn't confirm your pick. Checking…" **new** | automatic refresh | ✗ U-04 |

#### draft-control (3c-2 auto-start; PR #133 server)

| reason | Where | Message | Next step | Today |
|---|---|---|---|---|
| start blockers: `roster_reconfirm_required`, `playoff_teams_exceeds_members`, `not_enough_members`, `slots_infeasible`, `budget_infeasible`, `no_stake_mode`, `invalid_playoff_teams`, `renewal_replies_pending` | Commissioner blockers card, at-risk / postponed pushes | The blocker clauses **ruled** on the board (`#call-auto-start`: "Sofia F. left the league"; "8 playoff teams, but 7 teams are in"; "fewer than 4 teams have joined"; "some slots can't be filled"…) | Each blocker carries its fix (reconfirm buttons, playoff stepper); others → League settings | ✓ (`autoStart.ts:232-261`) |
| `draft_postponed` | Lobby, Home | "The draft is postponed." family **ruled** | Commissioner: fix, then "Pick a new draft time"; members: wait | ✓ |
| `draft_start_retrying` | Lobby at 0:00 | "Still starting. This can take a minute." | none (the cron retries) | ✓ |
| `no_draft_date` | Home, lobby | "No draft time yet" + "{Commissioner} will set the draft time." | Commissioner: "Set draft time" (U-17) | ✓ / call |
| `draft_date_not_reached`, `not_started_state`, `feasibility_unavailable`, `room_did_not_open`, `start_failed` | — | Not shown as blockers (the state shows instead) | — | ✓ |
| `confirm_roster` → `draft_started` | Blockers card | "The draft has started, so the teams are set." **new** | none | ✗ U-24 |
| `confirm_roster` → `playoff_teams_exceeds_members`, `invalid_playoff_teams` | Blockers card | "{P} playoff teams, but {M} teams are in. Lower the playoff teams first." **new** | the stepper | ✗ U-24 |
| `confirm_roster` → `playoff_teams_not_applicable` | Blockers card | "This league has no playoffs to change." **new** | none | ✗ U-24 |
| `not_commissioner`, `not_a_member`, `league_not_found` | 4xx | "Only the commissioner can change this." / "That didn't go through." **new** | none | generic U-24 |
| `check_setup` → `slots_infeasible`, `budget_infeasible`, `feasibility_unavailable` | Create league / settings | "There aren't enough eligible stocks to fill every manager's slots. Loosen a slot rule or a price bracket." / "The budget isn't enough to fill every manager's slots. Raise the budget or change the price brackets." / "We couldn't check the draft setup just now. Try again in a moment." **ruled** (board) | the settings themselves / "Try again" | not verified |
| `add_bots` → `bots_not_allowed`, `no_bots_needed`, `bot_id_conflict` | Test tool | Not graded: bots are test-only (`PRODUCT_RULES.md`). | — | — |
| Draft time save: `draft_time_locked`, `draft_time_too_soon`, `draft_time_invalid` (a PostgREST raise, not draft-control) | Draft time sheet | "The draft time can't change once the draft room opens." / "Pick a time at least an hour from now." / "Pick a time ending in :00, :15, :30 or :45." | inline, the picker | ✓ (`autoStart.ts:382-389`; the picker already prevents the last two) |

#### join-league and preview-league (3f, merged)

| reason | Message | Next step | Today |
|---|---|---|---|
| `invalid_code` (preview) | "No league has that code. Check it and try again." **ruled** | under the field; Find league | ✓ |
| `league_full` | "{League} is full: {max} of {max} managers. Ask {commissioner} if they can make room." **ruled** | "Try another code" | ✓ |
| `draft_started` | "{League} has already drafted…" / "{League} is drafting right now, so it can't take new managers this season." **ruled** | "Try another code" | ✓ |
| `already_member` | "You're already in {League}." **ruled** | "Open the league" | ✓ |
| `invite_expired` | "This invite has expired. Ask your commissioner for a new code." **ruled** | "Try another code" | ✓ |
| `season_completed` | "{League}'s season is over. Ask your commissioner whether they're running it back." **ruled** | "Try another code" | ✓ |
| `invalid_code` (at join, after a good preview) | Reuse the bad-code line | Find league | generic U-47 |
| `rate_limited` (429) | "Too many tries. Wait a moment, then try again." | none | ✓ |
| `not_authenticated` (401) | "Your session ended. Sign in again." **new** | Sign in | ✗ U-35 |
| `bad_request`, `unhandled`, network | "Couldn't reach the league. Check your connection, then try again." **ruled** | Find league | ✓ |

#### leave-league (no client yet, U-39)

| reason | Message | Next step |
|---|---|---|
| `locked_in` (`window` order_set or season) | "Teams are locked in from an hour before the draft until the season ends." **ruled** | none; the row stays disabled with this line |
| `transfer_first` | "Make someone else commissioner first, then you can leave." **new** (Q4 = A, transfer first) | "Make commissioner" row |
| `not_commissioner` (transfer) | "Only the commissioner can hand over the title." **new** | none |
| `target_invalid` (transfer) | "Pick a manager in this league." **new** | the picker |
| `not_member` | "You're not in this league anymore." **new** | League pill |
| `successor_not_allowed`, `bad_request` | Client bug; "That didn't go through." | none |
| `rate_limited` | "Too many tries. Wait a moment, then try again." | none |

---

### Rule 11 table: flow → peak → ending

| Flow | Peak | Ending | On the board | Built |
|---|---|---|---|---|
| Sign up → first run | Onboarding, card 3 | Get started → Home with no leagues (Create · Join) | ✓ | ✓ (3b-1, approved) |
| Create league | The invite code appears | "{Name} is ready": the code to share and the draft time | ✗ U-30 | 3c-2, unreviewed |
| Join | The preview (what you're joining) | "You're in {League}" → its pre-draft Home | ✓ | ✓ (main) |
| Set the draft time | — | The countdown on Home, the time in League settings | ✓ | 3c-2 (U-16, U-17) |
| Room opens | "Draft room open · You pick 4th" | The lobby with the order | ✓ | 3c-2 |
| A pick | "You're on the clock" | "You took {SYMBOL} · you're up in {k} picks" | ✓ (key screen 4, After the pick) | ✗ U-09 |
| The draft | Your first pick; the snake board filling | Draft complete: "Your team is set", your roster, "Week 1 starts Mon 9:30 AM ET. You play {opponent}" | ✓ `3edfaf6` | ✗ U-10 (legacy hand-off) |
| Week 1 | Monday open, scores start | Matchup before the season: "Week 1 starts Mon 9:30 AM ET" | ✓ | 3c |
| A trade (sell) | Review sell | "Sold {SYMBOL}" with the cash in the slot: Invest now / Later | ✓ | 3e (pass 2) |
| A trade (buy) | Review buy ("Fills your $100–$200 slot") | "Bought {SYMBOL}", the slot it filled | ✓ | 3e (pass 2) |
| Friday | The reveal: scores lock, the winner, one celebratory beat | Final banner "{Name} wins Week {n} · W 5–1" and next week's opponent | win ✓, loss ✗ U-41 | 3c |
| Season end | The champion medallion | Season complete: your finish, record, best week; commissioner "Run it back?"; members the "Are you in?" ask | ✓ (champion; others `3edfaf6`) | 3c (ask not on Home, U-15) |
| Run it back | "Who's running back" filling up | The review → Schedule the draft → Season 2's pre-draft Home | ✓ | 3c |
| Leave (before the draft) | — | The leaver lands on Home without the league | ✗ | ✗ (U-39) |

**Protected moments** (nothing interrupts them): your pick clock and an open trade review.
Today a foreground push can land in both (U-14). No toast or sheet exists in either flow on
the branches read.

---

### Pass 1b · merged Home on the simulator (2026-10-06)

**Examined:** `main` @ `7610aa0`, iPhone 17e simulator (8CDB3007), Expo Go, dev fixtures only
(`EXPO_PUBLIC_SHELL_FIXTURE=leagues` fakes the session; `EXPO_PUBLIC_HOME_FIXTURE` fakes Home's
data; no sign-in, no Supabase reads or writes for Home). States: `live_open` in Light, Dark,
XL (accessibility-extra-large) and XXXL (accessibility-extra-extra-extra-large), and with Reduce
Motion on; `complete_runner_up` in Light. Captures: `captures/ux-audit-home/`.
**Not examined on device:** the other Home phases, VoiceOver, tap latency (rule 9's 400 ms), the
loading state (fixtures load instantly, so U-08 stays a code finding), offline, and the stress
fixture beyond XL/XXXL.

| Check | Result | Evidence |
|---|---|---|
| **F1** · tab labels at XXXL (handoff follow-up) | **PASS.** All four labels show, capped, legible. | `05-live-light-XXXL-F1.png` |
| **F2** · Reduce Motion, Season → 1W chart (handoff follow-up) | **PASS.** The 1W line is fully drawn in the first frame after the tap (frames 44 → 45 of a 10 fps extraction; frame 45 equals frame 60); no draw-in. | `07-F2-…-frames-43-44-45-60.png`, `07-F2-….mov` |
| Light / Dark | Pass; both themes complete, no mixed surfaces. | `01`, `02`, `03` |
| XL / XXXL reflow | Pass with polish (U-51); the scoreboard stacks names and keeps both scores on one line. | `04`, `05`, `06` |
| Rule 6 / 7 on device | Hero first, this week's matchup second; your standings row highlighted. | `01`, `02` |
| Non-champion season complete | Matches the board frame (`46a93de`): "2nd place", "Stock Scudetto · 5–1", neutral disc. | `08-complete-runner-up-light.png` |

New findings (added to the counts above):

| ID | Screen | Rule | What's wrong | Fix | Status |
|---|---|---|---|---|---|
| U-49 | Home season chart (`sp/SegmentedControl`) | 5 | The selected LAST segment ("Season") sits flush against the track's right end, so the track's rounded corner is cut off; the first segment ("1W") has its inset. Likely a width that ignores the track padding. Check every SegmentedControl (Buy/Sell, Standings/Schedule/History). | Give the selected pill the same inset on both ends. | P3, backlog (or ride any sp/ fix) |
| U-50 | Home standings excerpt | 5 / §9A | Season gains show no sign ("$512.40") while the hero shows "+$343.59" and League's table uses a sign on every row. | `sign="always"` on the excerpt's Money. | P2, relay to 3c-2 (touches Home) |
| U-51 | Home hero at XL/XXXL | — | The sub-line wraps with "·" stranded at line ends and a leading space on the next line; the "2nd of 6 · 4–1 · Week 6 of 14" meta wraps right-aligned under "Your team". | Wrap on the separators (each fact its own Text), left-align the meta when it wraps. | P3, backlog |

### Rulings after pass 1 (2026-10-06)

Copy and questions the 3c-2 worker raised while fixing the P0s (relayed by the Orchestrator).
Design Lead rulings; new copy, so Giorgio may still overrule.

- **Queue editor, "Not saved":** "Your queue can hold up to 50 stocks." approved.
  "Some of these stocks can't be queued. Remove them and try again." approved as the generic;
  when the server names the symbols, name them instead ("{SYMBOL} and {SYMBOL} can't be
  queued. Remove them and try again.").
- **Stalled turn, manager's name unknown:** not "the next manager" ("No stock left fits the
  next manager's next slot" stacks two "next"s). The fallback headline is "No stock left fits
  the next open slot".
- **`would_strand_slot` names:** the server sends no manager or slot names, so players get the
  ruled generic line, which is clear on its own. The specific line ("…with no stock that fits
  their Tech slot") is a **backend ask for 1.3** (add `manager_name` and `slot_label` to the
  refusal; P3, U-48), not a 1.2.0 blocker.
- **"Paused" header chip on the Draft paused frame:** not needed. The paused card directly
  under the header already carries the "Draft paused" tag and headline, and §9B says a tag
  must not repeat an adjacent one. The header keeps the League tab's own phase chip. I'll
  drop the chip from the board frame (board item).

### Rulings, 3c-2 round 2 (2026-10-06)

New copy from `ui/mobile-league-setup` @ `7bd56e9`. Design Lead rulings.

- **Transfer sheet:** "Make someone else commissioner" (title), "Hand over" (disabled until
  a manager is picked), "Hand over to {Name}" once picked, "Cancel": approved. Add one line
  under the title so the consequence is said before the tap (rule 1): "The new commissioner
  takes over right away. You stay in the league."
- **Leave, no draft time:** not a missing line. Without a time the window is still known:
  "You can leave until an hour before the draft."
- **Leave, season number unknown:** "Your season stays in the league's History…" without the
  number: approved.
- **Leave, network / server / unknown error:** not "That didn't go through." Leaving is
  destructive and the outcome is unknown, so re-read the membership first (verify the
  effect): still a member → "You're still in {League}. Try again."; gone → the normal "left"
  state; re-read fails → "We couldn't confirm that. Check your connection, then try again."
- **Draft complete, calendar doesn't cover Week 1:** "Week 1 starts soon." approved.
- **Draft complete, a Week 1 bye:** don't drop the opponent silently. "Week 1 starts Mon 9:30
  AM ET. You have a bye that week." (a notice, not an explanation, per the bye rule). The
  button becomes "See Week 1's matchups" (All matchups), since there is no matchup of yours.
- **Home, first draft time save failed:** "The draft time wasn't saved. Try again." The
  postponed flow keeps "The new draft time wasn't saved. Try again."
- **Queue refusals:** "{A} can't be queued. Remove it and try again." and "{A}, {B} and {C}
  can't be queued. Remove them and try again." approved.
- **Pick fallbacks:** "It's another manager's pick now." and "That stock…" forms (no symbol
  known) approved.
- **After your own auto-pick:** a distinct line, not "You took X". The player didn't pick it,
  and the auto-pick rule is a departure that gets explained where it happens (rule 1):
  "Auto-picked {SYMBOL} for you · you're up in {N} picks". The pick log keeps its source
  ("from your queue" / "best available").
- **Members' League settings row** (Invite code, Commissioner, Leave league; reachability
  fix): fine for the gate. Members see only those three rows, with no commissioner controls
  shown, not even disabled ones; Commissioner is a read-only name; the invite code has Share.

### Backlog (1.3)

P2/P3 items marked **backlog** above, unless a worker picks one up cheaply on the way past:
U-31, U-34, U-35, U-36, U-40, U-45, U-46, U-47, U-48, U-49, U-51 (the `would_strand_slot` names backend ask).

---

## Pass 2 · 3c-2 gate (2026-10-06)

**Verdict: BLOCK.** Two P1s on the Draft room (G-1, G-2). Everything pass 1 assigned to 3c-2 is
fixed; the block is on two rule breaks that were in the draft room since 3c and that pass 1
missed (it graded the room's copy and states, not its board and clock). Fix G-1 and G-2, re-capture
the four draft-room states, and this gate passes; the P2/P3 below can ride as a follow-up list.

### Scope examined

| Evidence | Version | How |
|---|---|---|
| `ui/mobile-league-setup` | `5b51858` (round diff `7bd56e9..5b51858`, 8 commits; whole branch since pass 1 `656e192..5b51858`, 33 commits) | Source, read-only scratch checkout |
| Captures | `docs/design/captures/ui-mobile-league-setup/`, 43 PNGs, 22 states (20 in Light and Dark, 3 Light only), iPhone 17e, standard text, fixture data | Every image reviewed |

**Not examined** (no verdict): XL / XXXL text and Reduce Motion for this round's screens (the
captures are standard text only; no recordings), VoiceOver, tap latency, the finished-league
League tab (observation 4 has no capture; graded from the worker's report), the stress
fixture. The `ux-reviewer` subagent is defined but wasn't loaded in this session (agents load at
session start), so this is the Design Lead's review alone; the reviewer should run at the 3e gate.
The Orchestrator's own checks (deno 1125/0, functions 618/0, architecture map, gitleaks, four
mutation tests) are taken as reported.

### Pass 1 findings assigned to 3c-2

All **fixed**, verified in code at `5b51858` and, where a capture exists, on screen.

| ID | Check | Result |
|---|---|---|
| U-01, U-02 | No "[new copy: …]" string left in `lib/`, `components/`, `app/` | fixed |
| U-03 | Clock is m:ss (`draftRoom.ts:149`) | fixed |
| U-04 | Unknown pick outcome: "Couldn't confirm your pick. Checking…" + re-read | fixed |
| U-05 | "Round 2 of 6 · Pick 11" in the room; Home `upNextLine` has "of {rounds}" | fixed |
| U-06 | "Your roster · 2 of 6 · $1,000 per slot" strip in the room | fixed |
| U-07 | `PICK_SENDING` "Sending…" | fixed |
| U-08 | `DraftRoomSkeleton`, `HomeSkeleton` | fixed |
| U-09 | "You took AAPL · you're up in 2 picks"; auto form "Auto-picked AAPL for you · …" | fixed |
| U-10 | Draft complete: "Your team is set", roster, Week 1 line, "See your Week 1 matchup" | fixed |
| U-11 | Rule 8 table lines + shared next step; `readFunctionRefusal` reads non-2xx bodies | fixed |
| U-12, U-13 | Standings pins your row (same component); VoiceOver says "down N" | fixed (code) |
| U-14 | `foregroundQuiet` silences foreground banners while your clock runs (`93c0440`) | fixed (draft side; the trade side is 3e's) |
| U-15 | `HomeRenewalAsk` on Home | fixed (code) |
| U-16, U-17 | Giorgio's B for both, as drawn | fixed |
| U-24 | `confirm_roster` per-reason lines (`autoStart.ts:406-416`) | fixed |
| U-25 | The lock is named only on `slots_locked` / `rules_locked` | fixed |
| U-50 | Home's standings excerpt signs its gains ("+$512.40") | fixed |
| Round-2 rulings 1, 2, 4, 6, 7, 10, 11 + the last-pick auto line | All on screen as ruled (transfer note, "You can leave until…", the re-read line "You're still in Summer Cup. Try again.", the bye line, members' three rows) | fixed |

### Gate report

1. **Specificity.** The leave and transfer sheets, the draft-time sheet and Draft complete are
   authored for this app. The draft room is not yet: a plain number grid and a text clock could
   be any draft app (G-1, G-2). The board's key screen 4 (ring clock, manager columns, your picks
   in team blue, the snake track) is what makes it ours.
2. **Squint test.** Home, Draft complete, the sheets: pass (one primary each). **Draft room, on
   the clock: fail.** Blurred, the 36-cell grid dominates; "You're on the clock" and "0:42" read
   at the same weight as "Paolo M. is up" does off the clock.
3. **Scorecard** (0–4): accessibility 3 (labels and live regions in place; Dynamic Type not
   captured) · performance not examined · theming 4 (both themes complete, no mixed surfaces) ·
   platform conformance 3 (native wheel picker, sheets; "‹ Cancel" mixes a back chevron with a
   modal's Cancel, G-7) · adaptivity not examined (standard text only).
4. **Persona walk.**
   - *The invitee* (member): League settings shows exactly Invite code, Commissioner, Leave league
     with its window line; the leave sheet says what happens. **Red flag:** in the draft room they
     can't tell which column or picks are theirs (G-1).
   - *The commissioner*: no-time Home → Set draft time → the B sheet → set; transfer then leave
     reads in the right order ("Make someone else commissioner first."). No red flag.
   - *The active trader*: not this branch (3e).
5. **Findings** (new in pass 2):

| ID | Screen | Rule | Drift class | What's wrong | Fix | P | Answer |
|---|---|---|---|---|---|---|---|
| G-1 | Draft room board | 7 (and 4) | conceptual mismatch | The board has no manager header row and never marks your picks (`DraftRoom.tsx` cells: no `myUserId` styling); the on-clock outline is the only mark. Key screen 4 has initials over each column, yours in team blue, and your picks outlined in `you`. In a 6–16 manager snake you can't find your own picks. | Header row of manager initials (yours `youText`, bold); your picks: `you` border + `youTint` fill; keep the on-clock outline in `accent`. | **P1** | escalated to the 3c-2 worker as a fix (no Giorgio decision needed: it's the approved key screen) |
| G-2 | Draft room clock card | 6 | one-off implementation | On your turn, "You're on the clock" is a bold `callout` and the clock a `headline` (`DraftRoom.tsx:215-220`), the same weight as the off-turn state. Rule 6: the screen's one emphasised element answers the moment's question ("is it my pick, and how long have I got?"). | Your turn: "You're on the clock" in `title` with `liveText`, the clock in score type (`score.md`), `loss` in the last 10 s (already wired). The ring from key screen 4 is P2 follow-up G-9. | **P1** | escalated (fix) |
| G-3 | Leave sheets | 2 / 3 | one-off implementation | Observation 1. "Leave league" (filled red) sits directly on "Stay" (filled primary; filled white in Dark): two primaries, and a destructive one adjacent to a filled one. | Ruling below: Leave stays `destructive` (filled), "Stay" becomes `ghost` like the transfer sheet's Cancel. | P2 | follow-up |
| G-4 | Draft room pick log | 5 | local defect | Observation 2. Your own auto-pick reads "Auto-picked · from their queue" (`draftRoom.ts:11`). | Viewer-aware: "from your queue" for your picks. | P2 | follow-up |
| G-5 | TeamSoFarGrid (room + Home) | 5 | local defect | Observation 3. Empty space under the slots; filled-slot labels sit low in their tiles. | Centre labels vertically; trim the bottom padding. | P3 | follow-up |
| G-6 | League tab, finished league | 5 | local defect | Observation 4 (no capture; worker's report). The "Run it back" strip lacks card padding; names in medal rows 1–3 don't line up with rows 4–6 (the 36 pt disc is wider than the rank numeral). | Card padding; give the rank cell a fixed width that fits the disc. | P3 | follow-up |
| G-7 | League settings (modal) | 1 | local defect | "‹ Cancel": a back chevron on a modal's Cancel. | "Cancel" text only (iOS modal), or a true back chevron with "League" if it's a push. | P3 | follow-up |
| G-8 | Transfer sheet | 4 | local defect | Every row's subtitle is "Member": the same word six times carries nothing. | Drop the subtitle. | P3 | follow-up |
| G-9 | Draft room clock | 4 motion | conceptual mismatch | Key screen 4's ring (the screen's authored moment) isn't built. | Ring per key screen 4, with its Reduce Motion fallback. | P2 | follow-up |

   **Fixture notes, not findings:** the capture fixture shows a legacy skip ("—" at pick 4),
   which a current draft can't produce; the transfer list shows all six managers because the
   shell fixture's user id matches none of them (`transferCandidates` does exclude you,
   `leaveLeague.ts:202-210`); and the member lobby shows the commissioner's no-time line
   (observation 5).

### Rulings on the worker's observations

1. **Leave sheets' buttons:** Leave league stays **filled red** (`destructive`, the `loss-fill`
   token's stated role: "Sell / destructive button fill"); **Stay becomes `ghost`**, matching the
   transfer sheet's Cancel. One filled action per sheet, and the safe choice is never a second
   primary. The board's red-outline DangerBtn is updated to the filled form in the next board
   pass. (G-3, P2.)
2. **Your own auto-pick in the log:** "Auto-picked · from your queue" (and "Auto-picked · best
   available" unchanged). (G-4, P2.)
3. **Roster grid:** a real defect; centre the labels and trim the space. (G-5, P3.)
4. **Finished League tab:** both real; card padding and a fixed rank-cell width. (G-6, P3.)
5. **Member lobby no-time line:** fixture limit, accepted; no change.
