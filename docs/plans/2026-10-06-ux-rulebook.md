# UX rulebook and audit

Status: Draft (awaiting Giorgio's approval)
Planner session: "Planner" (Fable 5.1), 2026-10-06 · Orchestrator hand-off: —

## Goal

Give the app one written UX standard, [`docs/design/UX_RULES.md`](../design/UX_RULES.md)
(eleven rules drawn from the Laws of UX, each with a check), and then grade every key screen
and flow against it before 1.2.0 is cut. 1.2.0 is the first build where EVERY screen is on the
new UI; it should not be cut against a standard we are about to raise. Going forward, a fresh
Design Lead (with the full skill set the current one lacks) owns the rulebook, and a read-only
`ux-reviewer` runs it at every UI gate, so the session that writes a worker's brief is never the
only one grading the result.

## Giorgio's rules

All 2026-10-06, in the Planner session.

- On what this part produces: "C, rulebook first then audit."
- On who applies it: "A, fresh design lead."
- On whether a separate auditor should grade the current design before a new lead takes over:
  Giorgio asked; the Planner recommended one fresh Design Lead that audits and then leads, with
  independence made structural (a read-only reviewer at every gate). Giorgio accepted by moving
  on to the next decision.
- On the audit's teeth: "A, P0/P1 block 1.2.0".
- On scope (mobile only, seven screens plus the connecting flows; web out): "that scope works,
  go ahead".
- On timing against the in-flight 3c/3e work: "yes, go with the two-pass version".
- On league size, raised while discussing the Orchestrator's "sole real player" question: "Why
  would I create an app to to compete against your friends if you only need one real player in
  the league? Like that objectively does not make sense. Clearly, you need to have at least a
  minimum threshold of real players above one." Recorded in `PRODUCT_RULES.md` ("League size",
  commit `f5af1ad`) with the wording he approved: "yes, 4 is right, use that wording".

## Decisions

| # | Question | Decision | Board section / date |
|---|---|---|---|
| 1 | Rulebook, audit, or both? | Both, rulebook first | Planner chat, 2026-10-06 |
| 2 | Which of the 30 Laws of UX apply? | 18 (Giorgio's 10 + 8 the Planner brought), collapsed to 11 rules; 7 skipped as untestable or already the program's premise | `UX_RULES.md`, 2026-10-06 |
| 3 | Who applies the rulebook? | A fresh "Design Lead" session with the full skill set, after a handoff from the current one | Planner chat, 2026-10-06 |
| 4 | Separate auditor vs the new lead auditing? | One fresh Design Lead audits then leads; independence is structural: a read-only `ux-reviewer` subagent at every gate | Planner chat, 2026-10-06 |
| 5 | What do findings do to 1.2.0? | P0/P1 block the cut; P2/P3 go to a 1.3 backlog | Planner chat, 2026-10-06 |
| 6 | Audit scope | Mobile only: Home, Matchup (live/final), League, Draft room, Portfolio, stock detail sheet, league pill sheet; plus the flows (sign up → create/join → draft date → room → draft → week 1 → Friday → season end → Run it back) and the two most-hit refusals (closed market, no slot fits). Light/Dark, XL text, Reduce Motion, stress fixture. Web out (paused; 3d not started; the rulebook applies to it from day one) | Planner chat, 2026-10-06 |
| 7 | Timing vs 3c/3e | Two passes: pass 1 now on designs (merged Home on the simulator + the 3c/3e board specs); pass 2 at each branch's gate on the built screens | Planner chat, 2026-10-06 |
| 8 | League size | 4 real managers minimum; bots are test-only | `PRODUCT_RULES.md`, 2026-10-06 |

Decisions the audit will *generate* (rules 3, 7, 10, 11 change what is on screen) go to
Giorgio as "Your call" mockups on the key-screens board, and are recorded in
`PRODUCT_RULES.md` when made. They are not pre-decided here.

## Open questions

None blocking. One non-blocking question for the Orchestrator and Design Lead to settle during
the build:

- Whether 3c and 3e each get one pass-2 audit at their existing gate, or whether pass 2 is run
  once on an integration branch after both merge. One per branch is the recommendation
  (findings land while the worker still has context); a final sweep on main before the 1.2.0
  cut catches cross-screen inconsistencies (rule 5).

(The reviewer's model was an open question; it is decided in "Models" below: Sonnet.)

## Scope

**In:**
- `docs/design/UX_RULES.md`: the eleven rules with their checks (written on this plan's branch).
- A Design Lead handoff note and a fresh Design Lead session chartered on the rulebook.
- The audit document `docs/design/reviews/ux-audit-2026-10.md`: pass 1 (designs) and pass 2
  (built screens), with the two tables rules 8 and 11 require.
- "Your call" board sections for the audit's layout-changing findings.
- The `ux-reviewer` subagent (`.claude/agents/ux-reviewer.md`, read-only) and its place in the
  gate report in `UI-UX-PROGRAM.md`.
- P0/P1 fixes as gated worker branches before the 1.2.0 cut; a P2/P3 backlog.

**Out (and why):**
- The web app (3d): paused behind `APP_PAUSED`, 1.2.0 is phone-only, the rebuild has not
  started; the rulebook binds it when it does.
- The landing page (3a, PR #45): parked by the app-first rule of 2026-09-29.
- iPad: decided phone-only for 1.2.0 (2026-10-05).
- Reopening approved product rules. The audit grades execution against the rules; a rule that
  seems wrong goes to Giorgio as a question, not as a finding.
- Re-auditing the motion language, tokens or the 11 pt / 44 pt craft floor: those checks
  already exist in the gate and stay as they are.

## How it works

### The player's side

Nothing in this plan ships a feature on its own. What changes for players is that by 1.2.0:

- every server refusal they can hit on a money or draft action tells them what happened and
  what to do next (rule 8);
- the draft, onboarding and the season show where they are and what is left, and anything
  waiting on them sits on Home until done (rule 10);
- each key flow has a designed ending: after a pick, after a trade, draft complete, week over,
  season over (rule 11);
- the primary action is where the thumb is, and their own row is never lost in a list
  (rules 3, 7);
- nothing claims a trade or pick happened before the server says so, and nothing leaves them
  waiting with a blank screen (rule 9).

### The system's side

Step by step, each step depending on the one before:

1. **Rulebook** (done on this branch): `docs/design/UX_RULES.md`. The Design Lead owns it
   afterwards; changes are proposed to Giorgio, never made silently.
2. **Handoff.** The current Design Lead writes a one-page handoff: what is DESIGN-APPROVED
   (3b-1 #73, 3b-2 Home @ `5c003c2` with follow-ups F1 tab labels at XXXL and F2 Reduce-Motion
   chart), where 3c (`ui/mobile-game`, `ui/mobile-league-setup`) and 3e (`ui/mobile-money`) stand
   in their gates, open "Your call" sections, and anything mid-conversation with a worker. The
   Orchestrator then starts a fresh session titled exactly "Design Lead" (it is a SendMessage
   address) with: `UX_RULES.md`, `DESIGN_DIRECTION.md`, `UI-UX-PROGRAM.md`, `PRODUCT_RULES.md`,
   the board (`docs/design/screens/`, `data.js` as the one dataset), and the handoff.
3. **Pass 1: audit the designs.** The fresh Design Lead grades (a) the merged Home screen on the
   simulator and (b) the 3c/3e board specs, against all eleven rules, writing
   `docs/design/reviews/ux-audit-2026-10.md`: one row per finding (screen · rule · what is wrong
   · priority · suggested fix), plus the **rule 8 table** (every `reason` from `record-trade`,
   `validate-and-record-pick`, `draft-control`, `join-league`, `leave-league`, `preview-league`
   → in-place message → next step) and the **rule 11 table** (flow → peak → ending). Spec-level
   P0/P1 go to the 3c/3e workers as changes before they build that part.
4. **Your calls.** Findings under rules 3, 7, 10, 11 that change layout become side-by-side
   mockups on the board with a recommendation. Giorgio decides; each decision goes into
   `PRODUCT_RULES.md`.
5. **`ux-reviewer`.** Giorgio creates `.claude/agents/ux-reviewer.md` (the auto-mode classifier
   blocks agents from editing `.claude/`), modelled on `security-reviewer.md`: `tools: Read,
   Grep, Glob`, no Bash, no Write; its brief is the "What the reviewer reports" section of
   `UX_RULES.md`. `UI-UX-PROGRAM.md`'s gate gains step (6): the reviewer's findings table and the
   Design Lead's answer to each (fixed / accepted with a reason / escalated).
6. **Pass 2: audit the built screens.** At each of 3c's and 3e's design gates, the Design Lead
   and the reviewer audit the built screens on the simulator: Light/Dark, XL text, Reduce Motion
   recordings, the stress fixture (20-char names, 40-char leagues, $1M+ values, 16 managers,
   1000+ rows, offline/slow). Findings append to the audit document.
7. **Fixes.** P0/P1 become worker branches gated the normal way plus the reviewer. P2/P3 go to a
   "Backlog (1.3)" section of the audit document.
8. **Final sweep and cut.** After 3c and 3e merge, one reviewer pass on `main` for cross-screen
   consistency (rule 5). 1.2.0 is cut only when open P0/P1 = 0 and Giorgio has done his full
   walkthrough with his real account.

### Existing code and documents this builds on

- Screens: `apps/mobile/app/(tabs)/_layout.tsx` (tab order Home · Matchup · League · Portfolio,
  plus the hidden draft route); the Home lib (`apps/mobile/lib/home/`), `draftOrder.ts`,
  `usePreDraftData.ts` (which already carries `minMembers`, `finalizeAt`, `waiting`: the data
  rule 10's Home hooks need).
- Server refusals (rule 8), as they exist today:
  `record-trade`: `not_a_member`, `symbol_owned`, `over_budget`, `no_eligible_slot`,
  `market_closed`, `not_owned`, `trade_conflict`, `proceeds_unavailable`, `calendar_unavailable`,
  `draft_not_completed`, `rate_limited`; `validate-and-record-pick`: `not_your_turn`,
  `draft_not_in_progress`, `draft_complete`, `pick_conflict`, `no_price`, `skip_disabled`;
  `draft-control`: `not_commissioner`, `roster_reconfirm_required`, `slots_infeasible`,
  `not_started_state`; `preview-league`: `invalid_code`; and the shared `not_authenticated`,
  `bad_request`, `method_not_allowed`, `unhandled`.
- The gate: `docs/design/UI-UX-PROGRAM.md` "Design review gate" (lines 39–60 as of main
  `f4bab24`), the impeccable additions of 2026-10-05, `DESIGN_DIRECTION.md` §4, §9, §9A, §9B.
- The board: `docs/design/screens/` (`key-screens.html`, `inventory-board.jsx` with the existing
  "Your call" pattern), `data.js`.
- The reviewer pattern: `.claude/agents/security-reviewer.md` (read-only, Sonnet, reports only).
- Product rules that the audit must not reopen: `docs/PRODUCT_RULES.md`.

## Risks and edge cases

- **Handover under load.** The Design Lead changes while 3c/3e are mid-gate. Mitigation: the
  fresh lead's first job is auditing those very specs (pass 1), so it knows them before it rules
  on them; the handoff names exactly where each gate stands.
- **Churn on in-flight branches.** The standard rises under 3c/3e. Accepted by Giorgio
  ("go with the two-pass version"); spec-level findings reach workers before they build that
  part, and the branches were always going to pass through a gate.
- **A P0 that needs backend.** Rule 8 may reveal a refusal the server returns but the client
  cannot yet distinguish (the response shape, not the reason, is the gap). That becomes its own
  small workstream; it never downgrades the finding. It is `supabase/functions/` work, so it
  needs `node scripts/gen-architecture.mjs` and a byte-verified deploy from the deploy checkout
  (CLAUDE.md).
- **Verdict scope.** A clean reviewer report on three screens is not clearance for seven.
  `UX_RULES.md` requires the reviewer to list what it examined, per the "scope of the verdict
  must match the scope of the evidence" lesson (CLAUDE.md, instance 5).
- **Rule 9 vs the server's own lesson.** Optimistic UI on money or picks would fabricate a
  success the server may refuse (`trade_conflict`, `pick_conflict`, `market_closed`). The rule
  forbids it; the reviewer checks it on `record-trade` and `validate-and-record-pick` call sites.
- **Reopening rules.** The rulebook will tempt "Home hero should be X" findings. Approved product
  rules stand; the Design Lead escalates a doubtful rule as a question.
- **Giorgio live in the simulator.** No worker edits code while he is doing a walkthrough
  (3b-1 lesson).
- **`.claude/` edits.** The `ux-reviewer` agent file is created by Giorgio by hand; agents and
  workers must not batch it with other changes (the classifier rejects it).
- **The rulebook grows.** Eleven rules is a size a worker can hold. New laws are added only by
  collapsing into an existing rule or by Giorgio's decision, never by appending.

## Done means

- [ ] `docs/design/UX_RULES.md` is on `main` with all eleven rules and their checks.
- [ ] `docs/PRODUCT_RULES.md` carries the league-size rule (4 real managers; bots test-only).
- [ ] A session titled "Design Lead" exists with the full skill set and the rulebook as charter;
      the old Design Lead's handoff note is in `docs/design/reviews/`.
- [ ] `docs/design/reviews/ux-audit-2026-10.md` exists, with: every in-scope screen and flow
      graded under pass 1; the rule 8 table covering every refusal reason listed above; the rule
      11 table covering every flow in scope; priorities assigned by the Design Lead using the
      definitions below.
- [ ] Every layout-changing finding (rules 3, 7, 10, 11) has a "Your call" board section and a
      recorded decision in `PRODUCT_RULES.md`.
- [ ] `.claude/agents/ux-reviewer.md` exists (read-only), and `UI-UX-PROGRAM.md`'s gate includes
      its findings table and the Design Lead's three-way answer.
- [ ] 3c and 3e each passed a pass-2 audit at their gate; the final sweep on `main` is recorded.
- [ ] Open P0 + P1 = 0 before the 1.2.0 cut; P2/P3 are listed under "Backlog (1.3)".
- [ ] Giorgio's check by hand: on the simulator with his real account, (1) a closed-market
      trade and a no-slot trade each explain themselves and say what to do next; (2) the draft
      shows "Round N of M · K picks until you"; (3) after a pick and after a trade there is a
      designed ending, not a bare return to the list; (4) his own standings row is visible
      without searching; (5) with a league missing its draft date, Home says so.

**Priority definitions (fixed; the reviewer proposes, the Design Lead assigns):**

| | Means | Example |
|---|---|---|
| P0 | The player cannot finish a core task, or the screen misleads: a wrong or hidden number, stale state shown as current, a money or draft refusal with no explanation | A sell that fails with a blank error; a Home hero showing last week's result as this week's |
| P1 | A rule broken on a high-traffic screen (Home, Matchup, Draft) or inside a money/draft flow, costing a step, a missed tap or a blind wait | Primary action in the top corner of the draft screen; a 2 s load with nothing on screen |
| P2 | A rule broken elsewhere (League, Portfolio, sheets) or an inconsistency between screens | Standings and schedule using different row styles for the same manager |
| P3 | Polish | Spacing off the 8 pt grid |

## Suggested workstreams

The Orchestrator decides the final split.

| # | Workstream | Depends on | Who |
|---|---|---|---|
| W0 | Push this plan branch (`plan/ux-rulebook`: `PRODUCT_RULES.md` league size, `UX_RULES.md`, this plan) and open its docs PR | — | Orchestrator |
| W1 | Design Lead handoff note, then the fresh "Design Lead" session chartered on the rulebook | W0 | Current Design Lead → Orchestrator |
| W2 | Pass 1 audit (merged Home + 3c/3e specs) → `ux-audit-2026-10.md` with the rule 8 and rule 11 tables; spec-level P0/P1 relayed to the 3c/3e workers | W1 | Design Lead |
| W3 | "Your call" board sections for the layout-changing findings; Giorgio decides; `PRODUCT_RULES.md` updated | W2 | Design Lead (board), Planner (rules doc) |
| W4 | `ux-reviewer` agent file (Giorgio, by hand) and the `UI-UX-PROGRAM.md` gate step (6) | W0 | Giorgio + Orchestrator |
| W5 | Pass 2 audits at the 3c and 3e gates; findings appended | W2, W4 | Design Lead + reviewer |
| W6 | P0/P1 fix branches, gated; P2/P3 backlog section | W3, W5 | Workers (mobile; backend only where rule 8 needs a response-shape change) |
| W7 | Final sweep on `main`; Giorgio's walkthrough; 1.2.0 cut | W6 | Reviewer, Giorgio, Orchestrator |

W1 and W4 can run in parallel after W0. W2 should start the same day the fresh Design Lead
exists, because every day 3c/3e build to the old standard is a day of fixes later.

## Models

Giorgio's standing rule (2026-09-25): plan on Opus, implement on the cheapest tier that fits,
and the Orchestrator re-runs tests and reviews diffs before any push so the cheaper tier is
held to the same bar. Applied here, per role and per workstream. The Orchestrator switches a
worker with `set_session_model` after its planning turn (the switch applies from the next
turn; a downgrade needs no prompt, an upgrade asks Giorgio).

| Role / workstream | Model | Why |
|---|---|---|
| Planner (this session) | Fable 5.1 | Product and UX judgement across the whole app; one session, short-lived per plan |
| Orchestrator | Opus 5.5 (its own) | Reviews every diff and verifies every branch; the quality backstop that lets everything below run cheaper |
| **Design Lead** (fresh, long-lived) | **Opus 5.5** for audit, gate and "Your call" turns; the Orchestrator may drop it to **Sonnet 5.5** for mechanical turns (writing up tables already decided, board JSX edits from an agreed brief) | The audit and the gates are the judgement-heavy work in this plan (squint test, reference pattern, priority); mockup code from a settled brief is not |
| Current Design Lead, W1 handoff note | Whatever it runs on now | One last turn; not worth a switch |
| `ux-reviewer` subagent (W4, W5, W7) | **Sonnet 5.5** | Same tier as `security-reviewer`: it judges against a fixed eleven-item list, which is Sonnet work; Haiku would miss the squint and reference-pattern checks |
| W0 push + docs PR | Orchestrator's own turn | Mechanical; no worker |
| W2 pass-1 audit | Design Lead on Opus | Judgement |
| W3 "Your call" mockups | Design Lead: brief and recommendation on Opus; board JSX on Sonnet | Brief = judgement; JSX from a brief = well-specified implementation |
| W3 `PRODUCT_RULES.md` update | Planner | Verbatim recording |
| W6 mobile fix workers | Turn 1 (read + plan + report + WAIT) on Opus; then **Sonnet 5.5** for implementation | The standard pattern; UI fixes against a written finding and an approved mockup are well-specified |
| W6 backend response-shape work (rule 8, if any) | Sonnet after an Opus plan turn; **Opus 5.5 throughout** if it touches auth, RLS, grants or partial-state logic | CLAUDE.md: security and partial-state design stay on Opus |
| Recon inside any worker (where is X called, which screens use Y) | **Haiku** (`explorer` subagent) | Read-only grep/glob; keeps the worker's own context clean |
| Docs-only workers (audit doc formatting, backlog section) | **Haiku** | Mechanical |

Not used: Fable for any worker or for the Design Lead. Its strength is long-horizon planning,
which is this session's job; as a builder or reviewer it costs about twice Opus for no gain
here.
