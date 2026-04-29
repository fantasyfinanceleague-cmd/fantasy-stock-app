# Simulation Diagnostic — `process-week-results` Coverage Audit

## Purpose

The existing season simulation test runner reports **23/23 passing** as of the most recent run (`simulation-test-2026-03-22T01-14-14-878Z.log`). However, the playoff phase transition bug documented in `PLAYOFF_TRANSITION_FIX.md` exists in `supabase/functions/process-week-results/index.ts`.

This is a contradiction. One of three things must be true:

1. **The bug was introduced after the March 22nd test run** — re-running the simulation today would now fail.
2. **The simulation does not exercise the buggy code path** — the test harness manipulates `current_week` (or related state) in a way that bypasses the buggy logic in the edge function.
3. **The simulation has an assertion gap** — it processes the data and the data happens to look correct in the cases tested, but the sim never asserts the specific invariant that the bug violates.

Before any new tests are written, we need to know which of these is true. **Building more test infrastructure on top of a harness that gives false confidence is worse than having no harness at all.**

---

## Scope

**This is a read-only investigation.** Do not modify any production code, edge functions, migrations, or the simulation harness itself. The only output of this task is a written report.

Do **not** write new tests. Do **not** apply the fix from `PLAYOFF_TRANSITION_FIX.md`. Do **not** refactor anything. If you find additional issues during investigation, list them in the report; do not fix them.

---

## Tasks

### 1. Re-run the existing simulation

Locate the simulation test runner (likely under `scripts/`, `tests/`, or similar — search for the script that produced `simulation-test-*.log` files). Run it as-is and capture the output to a new log file.

Report:
- The exact command used
- The location of the new log file
- Pass/fail count
- Any failures with full error context

### 2. Read and summarize the bug

Open `PLAYOFF_TRANSITION_FIX.md` and `supabase/functions/process-week-results/index.ts`. In the report, describe in 3–5 sentences:
- What the buggy behavior is (what the code does today)
- What the correct behavior should be
- The specific lines/conditions where the bug lives
- The state transition(s) affected (e.g., `regular → playoffs`, `playoffs → completed`, mid-playoff week advancement)

### 3. Audit the simulation's exercise of the bug path

Read the simulation harness source code carefully. For each of the following, give a direct yes/no with the file path and line numbers as evidence:

- **Does the harness directly `UPDATE` the `current_week` column** between phase transitions (e.g., manually setting `current_week = 4` before invoking the playoff round), or does it rely entirely on the edge function to advance `current_week`?
- **Does the harness directly `UPDATE` the `phase` column** (or `status`, or whichever field tracks regular/playoffs/completed), or does it rely entirely on the edge function?
- **Does the harness invoke `process-week-results` once per week and let the function fully manage state**, or does it call the function multiple times per phase / set state in between calls?
- **For the `NEG:IDEMPOTENT` test specifically**, what state is the league in when the second invocation happens? Is it a state that would actually trigger the buggy `current_week` increment?

### 4. Audit the simulation's assertions

For each phase transition the sim covers (regular → playoffs, intra-playoff round advancement, playoffs → completed), list:
- What fields the sim reads from the database to validate
- What invariants it asserts (e.g., "current_week equals X", "phase equals 'completed'", "no further matchups exist")
- What it does **not** assert that the bug would violate

Specifically: does any test assert that `current_week` has a **specific expected value** after the season completes, or only that the season reached `completed` status?

### 5. Identify the coverage gap (if any)

Based on tasks 1–4, conclude which of the three hypotheses is correct:

- **Hypothesis A:** Bug was introduced post-March 22 → today's sim run should fail
- **Hypothesis B:** Sim bypasses the buggy code path via manual state manipulation
- **Hypothesis C:** Sim hits the buggy path but doesn't assert the violated invariant

If B or C, describe **the minimum new test case** (in prose, not code) that would catch the bug. Do not write the test — just specify what it would do and what it would assert.

---

## Deliverable

A single markdown file: `SIMULATION_AUDIT_REPORT.md` at the repo root, with these sections:

1. **Re-run results** — command, log path, pass/fail summary, any failures
2. **Bug summary** — 3–5 sentence description of the bug and affected state transitions
3. **Harness exercise audit** — answers to task 3, with file:line citations
4. **Assertion audit** — answers to task 4, with file:line citations
5. **Hypothesis conclusion** — A, B, or C, with reasoning
6. **Proposed minimum test case** — only if hypothesis is B or C
7. **Other concerns** — any unrelated issues noticed during investigation, listed but not fixed

Keep the report tight. No more than ~2 pages of markdown. Cite file paths and line numbers liberally; avoid prose summaries when a citation does the job.

---

## Out of scope

- Writing or modifying any test code
- Applying the `PLAYOFF_TRANSITION_FIX.md` fix
- Refactoring the simulation harness
- Auditing edge functions other than `process-week-results`
- Writing tests for the other 13 edge functions (separate spec, later)
