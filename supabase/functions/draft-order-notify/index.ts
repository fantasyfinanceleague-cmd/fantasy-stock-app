// draft-order-notify — "the draft order is set" delivery, CRON ONLY.
//
// The draft order is finalized at the LATER of draft_date − 1h and the league
// reaching 4 members (20261013000000_draft_order_modes.sql). Any read or write
// finalizes lazily, so the ORDER is always right even if this never runs; what
// this function owns is TIMELINESS and the PUSH:
//   1. finalize_due_draft_orders() — finalize every due league nobody has
//      opened, which (in the same SQL transaction) creates one
//      league_notifications row per human member. Exactly once: the partial
//      UNIQUE index makes every other finalize path a no-op.
//   2. Deliver pending rows: claim (conditional UPDATE on the observed status +
//      attempt count, so an overlapping run cannot double-send), read the
//      member's CURRENT position, send via Expo, settle the status.
// Scheduled by supabase/migrations/deferred/20261013000001_schedule_draft_order_notify.sql,
// whose command posts only WHERE draft_order_notify_due() — an idle system
// makes no edge calls.
//
// SUCCESS-SIGNAL DISCIPLINE (CLAUDE.md): top-level `ok` means ONLY "the run
// completed". Per-row outcomes are counted separately; nothing here claims a
// push was delivered unless Expo returned an 'ok' ticket. The cron's
// net.http_post "succeeds" on enqueue regardless — verify by DATA
// (league_notifications.push_status), never by cron.job_run_details.
//
// AUTH: verify_jwt=false; the shared constant-time apikey guard
// (../_shared/cron-auth.ts, SB_SECRET_KEY_CRON, fail-closed) is the entire
// boundary. There is no caller identity: content is built server-side only.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { isAuthorized } from '../_shared/cron-auth.ts';
import { getTargetToken, sendExpoPush } from '../_shared/push.ts';
import {
  type DeliveryOutcome,
  draftOrderSetMessage,
  MAX_PUSHES_PER_RUN,
  nextPushStatus,
  STALE_SENDING_MS,
} from './plan.ts';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

interface NoticeRow {
  id: string;
  league_id: string;
  user_id: string;
  push_status: string;
  push_attempts: number;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);
  if (!isAuthorized(req)) return json({ error: 'Unauthorized' }, 401); // generic: no detail

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SECRET_KEY_INTERNAL')!);

  // ---- 1. On-time finalize (creates the notices) ---------------------------
  // Destructure-and-check: .rpc() resolves to { error } on a Postgres error.
  // A failure here does not stop delivery of notices that already exist.
  const { data: finalized, error: finErr } = await admin.rpc('finalize_due_draft_orders');
  if (finErr) console.error('finalize_due_draft_orders failed', JSON.stringify(finErr));

  // ---- 2. Deliver ----------------------------------------------------------
  const staleIso = new Date(Date.now() - STALE_SENDING_MS).toISOString();
  const { data: rows, error: selErr } = await admin
    .from('league_notifications')
    .select('id, league_id, user_id, push_status, push_attempts')
    .eq('kind', 'draft_order_set')
    .or(`push_status.eq.pending,and(push_status.eq.sending,push_attempted_at.lt.${staleIso})`)
    .order('created_at', { ascending: true })
    .limit(MAX_PUSHES_PER_RUN);
  if (selErr) {
    console.error('notice select failed', JSON.stringify(selErr));
    return json({ ok: false, reason: 'notice_query_failed', finalized: finalized ?? null }, 500);
  }

  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  interface LeagueInfo { name: string; mode: string; draftDate: string | null; started: boolean }
  const leagues = new Map<string, LeagueInfo | null>();

  async function leagueInfo(id: string): Promise<LeagueInfo | null | undefined> {
    if (leagues.has(id)) return leagues.get(id);
    const { data, error } = await admin
      .from('leagues').select('name, draft_order_mode, draft_date, draft_status').eq('id', id).maybeSingle();
    if (error) return undefined; // lookup failed: not cached, retried next row/tick
    const info = data
      ? {
        name: String(data.name ?? 'Your league'),
        mode: String(data.draft_order_mode ?? 'random'),
        draftDate: data.draft_date ?? null,
        started: (data.draft_status ?? 'not_started') !== 'not_started',
      }
      : null;
    leagues.set(id, info);
    return info;
  }

  async function deliver(row: NoticeRow): Promise<DeliveryOutcome> {
    const { data: pos, error: posErr } = await admin
      .from('league_draft_order').select('position')
      .eq('league_id', row.league_id).eq('user_id', row.user_id).maybeSingle();
    if (posErr) return 'lookup_failed';
    if (!pos) return 'not_in_order';
    const lg = await leagueInfo(row.league_id);
    if (lg === undefined) return 'lookup_failed';
    if (lg === null) return 'not_in_order'; // league deleted since (cascade would normally remove the row)

    const { token, enabled, lookupFailed } = await getTargetToken(admin, row.user_id);
    if (lookupFailed) return 'lookup_failed';
    if (!token || !enabled) return 'no_token';

    const res = await sendExpoPush(
      token,
      draftOrderSetMessage({
        leagueName: lg.name,
        leagueId: row.league_id,
        mode: lg.mode,
        position: Number(pos.position),
        draftDate: lg.draftDate,
        draftStarted: lg.started,
      }),
    );
    return res.sent ? 'sent' : res.reason;
  }

  for (const row of (rows ?? []) as NoticeRow[]) {
    const attempts = Number(row.push_attempts) + 1;
    // CLAIM: only if nobody moved the row since we read it.
    const { data: claimed, error: claimErr } = await admin
      .from('league_notifications')
      .update({ push_status: 'sending', push_attempts: attempts, push_attempted_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('push_status', row.push_status)
      .eq('push_attempts', row.push_attempts)
      .select('id')
      .maybeSingle();
    if (claimErr) { bump('claim_failed'); console.error('claim failed', row.id, JSON.stringify(claimErr)); continue; }
    if (!claimed) { bump('claim_lost'); continue; }

    let outcome: DeliveryOutcome;
    try {
      outcome = await deliver(row);
    } catch (e) {
      console.error('deliver threw', row.id, String(e));
      outcome = 'expo_error';
    }
    const status = nextPushStatus(outcome, attempts);
    // Check the EFFECT, not just the error: an UPDATE matching zero rows
    // resolves { data: null, error: null } (CLAUDE.md success signals #5).
    const { data: settled, error: setErr } = await admin
      .from('league_notifications')
      .update({ push_status: status, push_error: outcome === 'sent' ? null : outcome })
      .eq('id', row.id)
      .eq('push_status', 'sending')
      .select('id')
      .maybeSingle();
    if (setErr || !settled) {
      // The row stays 'sending' and is reclaimed after STALE_SENDING_MS — a
      // possible duplicate push, never a lost one.
      bump('settle_failed');
      console.error('settle failed', row.id, setErr ? JSON.stringify(setErr) : 'no row settled (reclaimed?)');
      continue;
    }
    bump(status === 'pending' ? `retry_${outcome}` : status);
  }

  return json({
    ok: true, // the run COMPLETED — not a claim that any push was delivered
    finalized: finErr ? null : finalized,
    finalize_error: finErr ? 'finalize_due_draft_orders_failed' : null,
    examined: (rows ?? []).length,
    outcomes: counts,
  });
});
