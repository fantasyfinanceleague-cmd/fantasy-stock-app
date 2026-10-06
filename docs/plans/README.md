# Plans

Before a new feature or big project is built, Giorgio and the **Planner** settle it here.
The **Orchestrator** then builds it from the plan. This folder holds those plans.

## Who does what

| Role | Session | Does | Doesn't |
|---|---|---|---|
| **Giorgio** | — | Decides every product rule; approves the plan; runs every prod step | — |
| **Planner** | "Planner" (Fable 5.1, Opus for security-heavy plans) | Talks it through with Giorgio; reads the code and docs; asks for mockups; writes the plan here; hands it to the Orchestrator | Write app code, start workers, push, open PRs, touch prod |
| **Orchestrator** | "Orchestrator" | Turns an approved plan into workers; verifies, opens PRs, walks Giorgio through releases | Make product decisions; change an approved plan's rules without Giorgio |
| **Design Lead** | "Design Lead" | Draws the "Your call" mockups and design specs on the board | — |

## The flow

1. **Explore.** Giorgio brings an idea to the Planner. The Planner reads what exists
   (code, [`../STATUS.md`](../STATUS.md), [`../PRODUCT_RULES.md`](../PRODUCT_RULES.md), the
   board) and asks questions until the goal and rules are clear.
2. **Decide.** Every product/design choice goes to Giorgio as side-by-side mockups. The
   Planner writes the brief, the Orchestrator relays it to the Design Lead, and the board
   section comes back. The Planner records each decision in the plan AND in
   `PRODUCT_RULES.md`, quoting Giorgio verbatim.
3. **Write the plan** as `docs/plans/YYYY-MM-DD-<topic>.md` from the template below.
   Commit it on a branch `plan/<topic>`. No pushing; the Orchestrator pushes docs.
4. **Hand off.** When Giorgio approves, the Planner messages the Orchestrator:
   `PLAN READY: docs/plans/<file> @ <sha> (approved by Giorgio on <date>)`.
5. **Build.** The Orchestrator splits the plan into workers, verifies their work, opens
   PRs and runs the releases with Giorgio. A product question that comes up mid-build
   goes to Giorgio directly; the Planner updates the plan and `PRODUCT_RULES.md`.
6. **Close.** When it ships, the Orchestrator marks the plan's status `Shipped` with the
   PRs, and `STATUS.md` records what's live.

Small fixes and bugs don't need a plan; they go straight to the Orchestrator.

## Plan template

```markdown
# <Title>

Status: Draft | Approved (Giorgio, YYYY-MM-DD) | Building | Shipped (PRs …)
Planner session: … · Orchestrator hand-off: <sha>

## Goal
One paragraph: what changes for players, and why now.

## Giorgio's rules
Verbatim quotes, dated. Each one also goes in docs/PRODUCT_RULES.md.

## Decisions
| # | Question | Decision | Board section / date |
|---|---|---|---|

## Open questions
Anything not yet decided. A plan isn't Approved while this has blocking items.

## Scope
In: …
Out (and why): …

## How it works
The behaviour, step by step, from the player's side, then the system's (server rules,
data, notifications, timing). Name existing code it builds on.

## Risks and edge cases
Security, partial state, concurrency, time zones, migrations of existing data,
interactions with live features.

## Done means
Testable acceptance criteria, including what Giorgio checks by hand.

## Suggested workstreams
How the Orchestrator might split it (backend / mobile / design), with dependencies.
The Orchestrator decides the final split.
```
