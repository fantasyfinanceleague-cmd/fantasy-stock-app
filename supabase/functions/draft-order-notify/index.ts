// draft-order-notify — the draft-lifecycle push delivery, CRON ONLY.
//
// Draft auto-start (2026-10-06, 20261111000000) made this the delivery for
// every draft push: the room opening (T-1h, with your position), the start, a
// postponement (everyone), and the commissioner's at-risk warning. A run:
//   1. open_due_draft_rooms() — every league the auto-start gate cleared whose
//      room time has come: finalize the order and write one 'draft_room_open'
//      row per human (late joiners too). Exactly once per draft time.
//   2. finalize_due_draft_orders() — #67's on-time finalize for everything
//      else. Its 'draft_order_set' rows are in-app records now (push marked
//      skipped at insert), so this sends nothing by itself.
//   3. Deliver pending rows of DELIVERED_KINDS ('draft_time_set' only after 2
//      quiet minutes, so a burst of edits is one push): claim (conditional UPDATE on
//      the observed status + attempt count, so an overlapping run cannot
//      double-send), read the CURRENT context (draft_notice_context: position,
//      names, state), decide (plan.ts decideNotice: a notice whose event no
//      longer holds is skipped, never sent), send via Expo, settle the status.
// Scheduled by supabase/migrations/20261111000003_schedule_draft_order_notify.sql,
// whose command posts only WHERE draft_order_notify_due() OR
// draft_room_notices_due() — an idle system makes no edge calls.
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
  decideNotice,
  DELIVERED_KINDS,
  type DeliveryOutcome,
  fairOrder,
  isDebouncing,
  MAX_PUSHES_PER_RUN,
  nextPushStatus,
  type NoticeContext,
  RENEWAL_KINDS,
  type RenewalKind,
  renewalNoticeMessage,
  STALE_SENDING_MS,
} from './plan.ts';

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

interface NoticeRow {
  id: string;
  league_id: string;
  user_id: string;
  kind: string;
  created_at: string;
  subject_user_id: string | null;
  detail: Record<string, unknown> | null;
  push_status: string;
  push_attempts: number;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);
  if (!isAuthorized(req)) return json({ error: 'Unauthorized' }, 401); // generic: no detail

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SB_SECRET_KEY_INTERNAL')!);

  // ---- 1. Open due rooms (creates the room-open notices) ---------------------
  // Destructure-and-check: .rpc() resolves to { error } on a Postgres error.
  // A failure here does not stop delivery of notices that already exist.
  const { data: opened, error: openErr } = await admin.rpc('open_due_draft_rooms');
  if (openErr) console.error('open_due_draft_rooms failed', JSON.stringify(openErr));

  // ---- 2. On-time finalize for everything else (#67) -------------------------
  const { data: finalized, error: finErr } = await admin.rpc('finalize_due_draft_orders');
  if (finErr) console.error('finalize_due_draft_orders failed', JSON.stringify(finErr));

  // ---- 2. Deliver ----------------------------------------------------------
  const staleIso = new Date(Date.now() - STALE_SENDING_MS).toISOString();
  const { data: rows, error: selErr } = await admin
    .from('league_notifications')
    .select('id, league_id, user_id, kind, created_at, subject_user_id, detail, push_status, push_attempts')
    .in('kind', [...DELIVERED_KINDS, ...RENEWAL_KINDS])
    .or(`push_status.eq.pending,and(push_status.eq.sending,push_attempted_at.lt.${staleIso})`)
    .order('created_at', { ascending: true })
    .limit(MAX_PUSHES_PER_RUN * 4); // oldest first, then shared fairly across leagues (fairOrder)
  if (selErr) {
    console.error('notice select failed', JSON.stringify(selErr));
    return json({ ok: false, reason: 'notice_query_failed', opened: opened ?? null, finalized: finalized ?? null }, 500);
  }

  const counts: Record<string, number> = {};
  const bump = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);

  // Run it back only: a cached league name lookup (renewalNoticeMessage needs
  // nothing else). draft_notice_context covers DELIVERED_KINDS' own league info.
  interface RenewalLeagueInfo { name: string }
  const renewalLeagues = new Map<string, RenewalLeagueInfo | null>();
  async function leagueInfo(id: string): Promise<RenewalLeagueInfo | null | undefined> {
    if (renewalLeagues.has(id)) return renewalLeagues.get(id);
    const { data, error } = await admin.from('leagues').select('name').eq('id', id).maybeSingle();
    if (error) return undefined; // lookup failed: not cached, retried next row/tick
    const info = data ? { name: String(data.name ?? 'Your league') } : null;
    renewalLeagues.set(id, info);
    return info;
  }

  async function deliver(row: NoticeRow): Promise<DeliveryOutcome> {
    // Run it back: renewal notices carry their whole content in `detail`, and
    // their recipient is not in a draft order and may not be a league member yet
    // (a pending invitee), so they skip draft_notice_context entirely and use
    // their own lookup (league name only).
    if ((RENEWAL_KINDS as readonly string[]).includes(row.kind)) {
      const rl = await leagueInfo(row.league_id);
      if (rl === undefined) return 'lookup_failed';
      if (rl === null) return 'not_in_order';   // league deleted (a cancelled renewal cascades here)
      const message = renewalNoticeMessage({
        kind: row.kind as RenewalKind,
        leagueName: rl.name,
        leagueId: row.league_id,
        detail: row.detail ?? {},
      });
      if (!message) return 'unknown_kind';
      const { token, enabled, lookupFailed } = await getTargetToken(admin, row.user_id);
      if (lookupFailed) return 'lookup_failed';
      if (!token || !enabled) return 'no_token';
      const rr = await sendExpoPush(token, message);
      return rr.sent ? 'sent' : rr.reason;
    }

    // Every other DELIVERED_KINDS row: the generic auto-start context + decision.
    const { data: ctx, error: ctxErr } = await admin.rpc('draft_notice_context', { p_notice_id: row.id });
    if (ctxErr) return 'lookup_failed';
    if (!ctx) return 'not_in_order'; // league deleted since (cascade would normally remove the row)
    const decision = decideNotice(ctx as NoticeContext);
    if (!decision.send) return decision.outcome;

    const { token, enabled, lookupFailed } = await getTargetToken(admin, row.user_id);
    if (lookupFailed) return 'lookup_failed';
    if (!token || !enabled) return 'no_token';

    const res = await sendExpoPush(token, decision.message);
    return res.sent ? 'sent' : res.reason;
  }

  // A draft-time change waits for 2 quiet minutes (plan.ts TIME_SET_QUIET_MS):
  // left pending and unclaimed, so a further change can still re-stamp it.
  const now = new Date();
  for (const row of fairOrder(((rows ?? []) as NoticeRow[]).filter((r) => !(r.push_status === 'pending' && isDebouncing(r.kind, r.created_at, now))), MAX_PUSHES_PER_RUN)) {
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
    opened: openErr ? null : opened,
    open_error: openErr ? 'open_due_draft_rooms_failed' : null,
    finalized: finErr ? null : finalized,
    finalize_error: finErr ? 'finalize_due_draft_orders_failed' : null,
    examined: (rows ?? []).length,
    outcomes: counts,
  });
});
