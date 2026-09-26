# Documentation index

Start with **[STATUS.md](STATUS.md)**: what's deployed, what's open, and the critical path.
Repo conventions and hard-won operational rules are in the root [`CLAUDE.md`](../CLAUDE.md).

| Folder / file | What it holds | Kept current? |
|---|---|---|
| [`STATUS.md`](STATUS.md) | Prod ledger, workstream status, open defects, critical path, branches | **Yes — update every session that changes prod** |
| [`decisions/`](decisions/) | Accepted decision records (DR-001: in-house simulated trading) | Yes — append new DRs, never rewrite accepted ones |
| [`architecture/`](architecture/) | Generated architecture map (`architecture.json`/`.html` — **never hand-edit**), hand-written `annotations.json`, prod `db-snapshot.json` + its capture SQL, map schema | Regenerate with `node scripts/gen-architecture.mjs`; re-capture the snapshot after grant/RLS/cron changes |
| [`migrations/`](migrations/) | Specs + reports for the Supabase API-key migration (`MIGRATION_PHASE_*`, `MIGRATION_STATUS.md`), RLS hardening (`RLS_HARDENING_SPEC.md`), the simulator migration (`SIMULATOR_MIGRATION_SPEC.md`, `simulator-recon.md`), and staged-not-applied SQL (`STAGED_*.sql`) | Status files yes; phase specs/reports are point-in-time records. Paths are referenced from migration comments — don't rename |
| [`design/`](design/) | UI/UX program charter (`UI-UX-PROGRAM.md` — roles, phases, UI worker contract), mobile UI overhaul spec (`STOCKPILE_UI_OVERHAUL.md`), landing-page spec, brand assets | Yes |
| [`fixes/`](fixes/) | Post-mortems of production incidents | Append-only |
| [`testing/`](testing/) | Season simulation harness guide + testing roadmap | Yes |
| [`assets/`](assets/) | Screenshots used by the root README | — |
| [`history/`](history/) | Superseded plans, old session logs, completed handoffs | **No — archive, read for context only** |

## Tests at a glance

| Suite | Command (repo root) |
|---|---|
| Edge-function pure modules (Deno, hermetic — no DB, no secrets) | `deno test supabase/functions/` |
| Architecture map freshness | `node scripts/gen-architecture.mjs --check` |
| Season simulation against a real project | `npm run test:simulation` — see [`testing/SEASON_SIMULATION_TEST.md`](testing/SEASON_SIMULATION_TEST.md) |
| Mobile lint / types | `cd apps/mobile && npm run lint && npx tsc --noEmit` |
| Web lint | `cd apps/web && npm run lint` |
