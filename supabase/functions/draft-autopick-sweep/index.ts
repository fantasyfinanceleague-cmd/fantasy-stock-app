// draft-autopick-sweep — the pick clock's SERVER BACKSTOP.
//
// Connected clients fire validate-and-record-pick action:'auto_pick' the
// moment a turn's clock hits zero; that is the responsive path. This function
// is the one that makes the product rule true when NOBODY is connected: "a
// draft must never be permanently stuck". Scheduled by the deferred cron
// migration supabase/migrations/deferred/20261010000001_schedule_draft_autopick_sweep.sql,
// whose command only posts here WHERE EXISTS an overdue turn — so an idle
// system makes no edge calls at all.
//
// Per overdue row of public.overdue_draft_turns() (service role):
//   * league no longer in_progress         -> 'not_in_progress' (nothing to do)
//   * every pick made, finalize failed     -> re-run the idempotent finalize
//     (heals a transient finalize failure without anyone opening the app)
//   * otherwise re-read get_draft_clock (the overdue list may be stale by the
//     time we reach this row) and run the SAME gate + autoPickTurn the client
//     path uses (../_shared/draft-write.ts). A bot's turn picks as a bot; a
//     human's turn picks from their queue, then best available.
// Races with clients (or an overlapping sweep) end at the drafts
// (league_id, pick_number) unique index: the loser gets 'pick_conflict' and
// writes nothing. Chained timeouts cannot burst: each recorded pick is the
// next turn's clock anchor, so the next turn is simply not overdue yet.
//
// SUCCESS-SIGNAL DISCIPLINE (CLAUDE.md): the response's top-level `ok` means
// ONLY "the sweep ran to completion". Per-league outcomes are in `results`
// and `errors`; nothing here claims every overdue turn was picked. The cron's
// net.http_post "succeeds" on enqueue regardless — verify by DATA (drafts rows
// with pick_source auto_*/bot and their recorded_at gaps), never by
// cron.job_run_details or net._http_response.
//
// AUTH: verify_jwt=false; the shared constant-time apikey guard
// (../_shared/cron-auth.ts, SB_SECRET_KEY_CRON, fail-closed) is the entire
// boundary — same contract as every other cron-only function here.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isAuthorized } from '../_shared/cron-auth.ts';
import { decideAutoPickGate } from '../_shared/auto-pick.ts';
import { autoPickTurn, fetchDraftClock, finalizeDraft, isDraftFull, loadDraftContext } from '../_shared/draft-write.ts';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

// Bounds per invocation. The cron re-fires every tick, so anything past these
// is picked up next tick rather than risking the edge wall-clock limit.
const MAX_LEAGUES_PER_RUN = 20;
const CONCURRENCY = 4;

interface LeagueOutcome {
  league_id: string;
  pick_number: number;
  outcome: string;
  pick_source?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);
  // Generic 401: no detail about why (missing vs wrong vs unset).
  if (!isAuthorized(req)) return json({ error: 'Unauthorized' }, 401);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const SECRET_KEY = Deno.env.get('SB_SECRET_KEY_INTERNAL')!;
  const ALPACA_KEY = Deno.env.get('ALPACA_API_KEY') ?? '';
  const ALPACA_SECRET = Deno.env.get('ALPACA_API_SECRET') ?? '';
  if (!ALPACA_KEY || !ALPACA_SECRET) return json({ ok: false, reason: 'server_config_error' }, 500);
  const admin = createClient(SUPABASE_URL, SECRET_KEY);

  // Destructure-and-check: .rpc() resolves to { error } on a Postgres error.
  const { data: overdue, error: odErr } = await admin.rpc('overdue_draft_turns');
  if (odErr) {
    console.error('overdue_draft_turns failed', JSON.stringify(odErr));
    return json({ ok: false, reason: 'overdue_query_failed' }, 500);
  }
  const rows = ((overdue ?? []) as Array<{ league_id: string; pick_number: number }>).slice(0, MAX_LEAGUES_PER_RUN);

  const results: LeagueOutcome[] = [];
  const errors: LeagueOutcome[] = [];

  async function sweepOne(row: { league_id: string; pick_number: number }) {
    const base = { league_id: String(row.league_id), pick_number: Number(row.pick_number) };
    try {
      const loaded = await loadDraftContext(admin, base.league_id);
      if (!loaded.ok) return errors.push({ ...base, outcome: loaded.reason });
      const ctx = loaded.ctx;
      if (ctx.league.draft_status !== 'in_progress') return results.push({ ...base, outcome: 'not_in_progress' });

      if (isDraftFull(ctx)) {
        const finalizeError = await finalizeDraft(admin, ctx.league, ctx.memberIds);
        return finalizeError === null
          ? results.push({ ...base, outcome: 'finalize_healed' })
          : errors.push({ ...base, outcome: `finalize_failed:${finalizeError}` });
      }

      const clock = await fetchDraftClock(admin, base.league_id);
      if (!clock) return errors.push({ ...base, outcome: 'clock_read_failed' });
      const gate = decideAutoPickGate(clock.picksMade + 1, clock);
      if (gate.kind !== 'go') return results.push({ ...base, outcome: gate.kind });

      const res = await autoPickTurn(
        admin,
        { alpacaKey: ALPACA_KEY, alpacaSecret: ALPACA_SECRET },
        ctx,
        clock.picksMade + 1,
      );
      if (res.ok) {
        const out = { ...base, pick_number: Number(res.pick?.pick_number ?? base.pick_number), outcome: 'picked', pick_source: res.pickSource };
        return res.statusError ? errors.push({ ...out, outcome: `picked_finalize_failed:${res.statusError}` }) : results.push(out);
      }
      // pick_conflict = someone else recorded it first: a success for the draft.
      if (res.reason === 'pick_conflict') return results.push({ ...base, outcome: 'pick_conflict' });
      return errors.push({ ...base, outcome: res.reason });
    } catch (e) {
      console.error('sweep: league failed', base.league_id, String(e));
      return errors.push({ ...base, outcome: 'unhandled' });
    }
  }

  // Bounded parallelism: leagues are independent; one slow Alpaca chain must
  // not serialize every other overdue draft behind it.
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    await Promise.all(rows.slice(i, i + CONCURRENCY).map(sweepOne));
  }

  if (errors.length > 0) console.error('sweep errors', JSON.stringify(errors));
  return json({
    ok: true, // the sweep RAN — not a claim that every overdue turn was picked
    examined: rows.length,
    overdue_total: (overdue ?? []).length,
    results,
    errors,
  });
});
