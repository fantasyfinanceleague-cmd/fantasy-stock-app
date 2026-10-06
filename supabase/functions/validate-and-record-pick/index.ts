// validate-and-record-pick — the server-side draft legality gate (Phase 3,
// DR-001 / SIMULATOR_MIGRATION_SPEC).
//
// Before this function, pick legality lived only in the clients: RLS on
// `drafts` gates league MEMBERSHIP, not legality, and clients wrote picks with
// direct .from('drafts').insert(). This function is now the single write path
// the clients use; RLS remains the membership backstop underneath it. The
// write helpers themselves live in ../_shared/draft-write.ts, shared with the
// draft-autopick-sweep cron so the two callers cannot drift.
//
// A pick is legal iff (validate via ../_shared/draft-validation.ts):
//   * it is the target's turn in the canonical snake order
//   * the symbol is not already owned in the league (net of drops)
//   * the price fits an unfilled slot bracket AND the symbol's category
//     eligibility intersects the slot's filter (Phase 4: category checks are
//     LIVE — overrides else rule-table else unclassified/flex-only)
//   * the fill fits the remaining budget (budget_cap leagues)
//
// Fill-at-draft: entry_price comes from the app-key Alpaca path
// (../_shared/alpaca-price.ts — same chain as quote); quantity is
// notional_per_slot/entry_price for fixed_notional, else 1.
//
// Callers: the picker themself, OR any league member on behalf of a bot
// ('bot-*' target — mirrors the "League members can create bot picks" RLS
// policy) — either with an explicit symbol (action:'pick', for_user_id=bot,
// the web-era shape) or letting the SERVER choose one (action:'bot_pick', see
// below — mobile has no client-side bot stock pool) — OR any league member
// (action:'skip' is REFUSED for everyone since 2026-10-05), OR any league member re-running draft
// finalization (action:'finalize', see below), OR any league member asking the
// server to auto-pick an EXPIRED turn (action:'auto_pick', see below).
//
// Every written row carries drafts.pick_source (20261010000000): 'manual' for
// action:'pick', 'bot' for bot_pick, and 'auto_queue'/'auto_best' for
// auto_pick. The UI's "Auto-picked" label is pick_source LIKE 'auto_%'.
// NO SKIP (2026-10-05): action:'skip' is refused (skip_disabled), and a turn
// with no legal stock returns reason 'stalled' with nothing written for the picker.
//
// action:'bot_pick': mobile's bot auto-picker. Any member's client may fire
// this when it's a bot's turn (mirrors web's client-driven botAutoPick, but
// the SERVER — not the client — chooses the symbol, via autoPickTurn in
// ../_shared/draft-write.ts: a best-available pool queried per OPEN price
// bracket, ranked by ../_shared/auto-pick.ts's strategy, each candidate tried
// through the SAME live-price + gatePick gate a human pick uses; a turn with no
// legal stock STALLS, it is never skipped). Instant — bots are not held to the clock while a client is
// connected; with nobody connected the draft-autopick-sweep cron picks for
// them once their clock expires.
//
// action:'auto_pick' {league_id, pick_number}: the pick clock (product rules,
// 2026-09-29). Connected clients fire it when their countdown for pick_number
// reaches zero. The SERVER decides whether the turn has really expired —
// public.get_draft_clock on the DB clock, never the client's — and whose turn
// it is (the target is never read from the request). Gate (auto-pick.ts
// decideAutoPickGate): already recorded -> {ok:true, already_recorded:true}
// with no Alpaca call; not yet expired -> {ok:false, reason:'not_overdue',
// deadline_at, server_now}. Then: the manager's draft queue in order, then
// best available; 'stalled' (never a SKIP) only when nothing is legal. A manual pick racing
// it is settled by the (league_id, pick_number) unique index — the first
// committed insert wins, the loser gets 'pick_conflict'.
//
// Draft completion: the final pick/skip FINALIZES the league — draft_status,
// the season schedule (matchups), initial standings, league dates, num_weeks and
// season 1 — atomically via the finalize_league_draft RPC, planned by
// ../_shared/schedule.ts. Because the status flip is inside that transaction, a
// failed finalize leaves the draft 'in_progress' with every pick made (never
// 'completed' with no schedule, which nothing could repair). That state heals
// on ANY later call for the league — pick, skip, or action:'finalize' — since
// each re-runs the idempotent finalize before refusing with draft_complete.
//
// Auth: gateway verify_jwt=true + in-code getUser() (join-league pattern).
// Writes use the service-role client, so membership is checked in-code.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchFillPrice } from '../_shared/alpaca-price.ts';
import { fetchEligibleCategoryIds } from '../_shared/category-eligibility.ts';
import { decideAutoPickGate } from '../_shared/auto-pick.ts';
import {
  autoPickTurn,
  fetchDraftClock,
  finalizeDraft,
  insertGatedPick,
  loadFeasibility,
  isDraftFull,
  leagueRules,
  loadDraftContext,
  loadSlots,
} from '../_shared/draft-write.ts';
import { currentTurn } from '../_shared/draft-validation.ts';
import { gatePick } from '../_shared/pick-gate.ts';

function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (origin.endsWith('.vercel.app') && origin.startsWith('https://')) return true;
  if (origin.startsWith('http://localhost:')) return true;
  return false;
}
function getCorsHeaders(origin: string) {
  const allowedOrigin = isAllowedOrigin(origin) ? origin : 'https://fantasy-stock-app.vercel.app';
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
// Origin is threaded per-request (NOT module state): edge isolates interleave
// concurrent requests at await points, so module-level origin state could leak
// one request's allowed-origin CORS header onto another's response.
function jsonFor(origin: string) {
  return (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(origin) },
    });
}

// Fail-open rate limit (join-league pattern). Draft picks are bursty — a full
// bot round can fire several picks in seconds — so the per-user limit is
// higher than join-league's.
// deno-lint-ignore no-explicit-any
async function rateLimitOk(admin: any, userId: string, ip: string): Promise<boolean> {
  try {
    const calls = [
      admin.rpc('check_and_bump_rate_limit', { p_bucket: 'record-pick', p_subject: `user:${userId}`, p_limit: 60 }),
    ];
    if (ip) {
      calls.push(admin.rpc('check_and_bump_rate_limit', { p_bucket: 'record-pick', p_subject: `ip:${ip}`, p_limit: 120 }));
    }
    const results = await Promise.all(calls);
    return results.every((r) => r.data !== false);
  } catch {
    return true; // FAIL-OPEN
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('Origin') || '';
  const json = jsonFor(origin);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(origin) });
  if (req.method !== 'POST') return json({ ok: false, reason: 'method_not_allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
  const PUBLISHABLE_KEY = Deno.env.get('SB_PUBLISHABLE_KEY')!;
  const SECRET_KEY = Deno.env.get('SB_SECRET_KEY_INTERNAL')!;
  const ALPACA_KEY = Deno.env.get('ALPACA_API_KEY') ?? '';
  const ALPACA_SECRET = Deno.env.get('ALPACA_API_SECRET') ?? '';

  const authed = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const admin = createClient(SUPABASE_URL, SECRET_KEY);

  try {
    const { data: auth } = await authed.auth.getUser();
    const user = auth?.user;
    if (!user) return json({ ok: false, reason: 'not_authenticated' }, 401);

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim();
    if (!(await rateLimitOk(admin, user.id, ip))) {
      return json({ ok: false, reason: 'rate_limited' }, 429);
    }

    const body = await req.json().catch(() => ({}));
    const leagueId = String(body.league_id ?? '').trim();
    const action = body.action === 'skip'
      ? 'skip'
      : body.action === 'finalize'
      ? 'finalize'
      : body.action === 'bot_pick'
      ? 'bot_pick'
      : body.action === 'auto_pick'
      ? 'auto_pick'
      : 'pick';
    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    // auto_pick never names a target: the server picks for whoever's turn it
    // is. for_user_id is ignored for it (defaults to the caller, which passes
    // the checks below as any member).
    const targetId = action === 'auto_pick' ? user.id : String(body.for_user_id ?? user.id).trim();
    const requestedPickNumber = Number(body.pick_number);

    if (!leagueId) return json({ ok: false, reason: 'bad_request' }, 400);
    if (action === 'pick' && !symbol) return json({ ok: false, reason: 'bad_request' }, 400);
    if (action === 'auto_pick' && !(Number.isInteger(requestedPickNumber) && requestedPickNumber >= 1)) {
      return json({ ok: false, reason: 'bad_request' }, 400);
    }

    // Picking for someone else is only allowed for bots (both actions).
    if (targetId !== user.id && !targetId.startsWith('bot-')) {
      return json({ ok: false, reason: 'forbidden_target' }, 403);
    }
    // bot_pick is bot-only by definition — a real user calling it "for
    // themself" (targetId === user.id) would otherwise slip past the check
    // above. Checked from the VERIFIED for_user_id string, never trusted as
    // an identity claim beyond "does it look like a bot id".
    if (action === 'bot_pick' && !targetId.startsWith('bot-')) {
      return json({ ok: false, reason: 'forbidden_target' }, 403);
    }

    // ---- Load league + membership (service role; membership checked here) --
    const loaded = await loadDraftContext(admin, leagueId);
    if (!loaded.ok) return json({ ok: false, reason: loaded.reason }, loaded.status);
    const ctx = loaded.ctx;
    const league = ctx.league;
    if (league.draft_status !== 'in_progress') {
      // A late auto_pick for the pick that FINISHED the draft is not an error:
      // report it as recorded (idempotent) rather than "not in progress".
      if (action === 'auto_pick' && requestedPickNumber >= 1 && requestedPickNumber <= ctx.picks.length) {
        if (!ctx.memberIds.includes(user.id)) return json({ ok: false, reason: 'not_a_member' }, 403);
        return json({ ok: true, already_recorded: true, pick_number: requestedPickNumber });
      }
      return json({ ok: false, reason: 'draft_not_in_progress' }); // 200: game-flow refusal
    }

    const memberIds = ctx.memberIds;
    if (!memberIds.includes(user.id)) return json({ ok: false, reason: 'not_a_member' }, 403);
    if (!memberIds.includes(targetId)) return json({ ok: false, reason: 'target_not_member' }, 403);

    const order = ctx.order;
    const numRounds = ctx.numRounds;
    const picks = ctx.picks;

    // ---- Every pick made but still in_progress: (re-)finalize -------------
    // Normally unreachable (the final pick finalizes). Reached only when that
    // finalize failed — then any call for the league retries it. Checked before
    // pricing so a retry never spends an Alpaca call on a finished draft.
    if (isDraftFull(ctx)) {
      const finalizeError = await finalizeDraft(admin, league, order);
      if (action === 'finalize') {
        return json({ ok: finalizeError === null, draft_complete: true, status_update_error: finalizeError });
      }
      return json({ ok: false, reason: 'draft_complete', status_update_error: finalizeError }); // 200: game-flow refusal
    }
    if (action === 'finalize') return json({ ok: false, reason: 'draft_not_complete' }); // 200: game-flow refusal

    // ---- Skip: REFUSED for everyone (2026-10-05, "a draft pick can never be
    // unused"). The stuck-bot escape hatch and the voluntary forfeit both went
    // with the SKIP sentinel; a turn with no legal stock stalls and is alerted.
    if (action === 'skip') return json({ ok: false, reason: 'skip_disabled' }); // 200: game-flow refusal

    // ---- Auto-pick: the pick clock expired (server-judged) ----------------
    if (action === 'auto_pick') {
      // The gate reads the ONE deadline definition (get_draft_clock) on the
      // DB clock. Cheap refusals first — no Alpaca call before 'go'.
      const clock = await fetchDraftClock(admin, leagueId);
      if (!clock) return json({ ok: false, reason: 'unhandled' }, 500);
      const gate = decideAutoPickGate(requestedPickNumber, clock);
      if (gate.kind === 'already_recorded') {
        return json({ ok: true, already_recorded: true, pick_number: requestedPickNumber });
      }
      if (gate.kind === 'not_overdue') {
        return json({ ok: false, reason: 'not_overdue', deadline_at: gate.deadlineAt, server_now: gate.serverNow });
      }
      if (gate.kind !== 'go') return json({ ok: false, reason: gate.kind }); // 200: game-flow refusal

      if (!ALPACA_KEY || !ALPACA_SECRET) return json({ ok: false, reason: 'server_config_error' }, 500);
      const result = await autoPickTurn(admin, { alpacaKey: ALPACA_KEY, alpacaSecret: ALPACA_SECRET }, ctx, requestedPickNumber);
      if (!result.ok) {
        return result.reason === 'unhandled'
          ? json({ ok: false, reason: 'unhandled' }, 500)
          : json({ ok: false, reason: result.reason }); // pick_conflict / price_unavailable: 200, client refetches
      }
      return json({
        ok: true,
        pick: result.pick,
        pick_source: result.pickSource,
        price_source: result.priceSource,
        draft_complete: result.complete,
        status_update_error: result.statusError,
      });
    }

    // ---- Bot pick: server chooses the symbol (mobile has no client-side bot
    // stock pool — see the header comment). Instant; not held to the clock. --
    if (action === 'bot_pick') {
      // Cheapest check first (same ordering validatePick itself documents):
      // refuse an out-of-turn bot_pick before spending anything on it. Without
      // this, any member could name an existing-but-not-current bot id (every
      // roster is visible to every member) and force several live Alpaca
      // calls per call purely to be told not_your_turn.
      const turn = currentTurn(picks.length, order, numRounds);
      if (!turn) return json({ ok: false, reason: 'draft_complete' }); // unreachable in practice — the every-pick-made branch above returns first
      if (turn.pickerId !== targetId) return json({ ok: false, reason: 'not_your_turn' });

      if (!ALPACA_KEY || !ALPACA_SECRET) return json({ ok: false, reason: 'server_config_error' }, 500);

      const result = await autoPickTurn(admin, { alpacaKey: ALPACA_KEY, alpacaSecret: ALPACA_SECRET }, ctx, turn.pickNumber);
      if (!result.ok) {
        return result.reason === 'unhandled'
          ? json({ ok: false, reason: 'unhandled' }, 500)
          : json({ ok: false, reason: result.reason }); // pick_conflict: 200, race lost, client retries
      }
      return json({
        ok: true,
        pick: result.pick,
        pick_source: result.pickSource,
        price_source: result.priceSource,
        draft_complete: result.complete,
        status_update_error: result.statusError,
      });
    }

    // ---- Pick: price server-side, validate, record ------------------------
    if (!ALPACA_KEY || !ALPACA_SECRET) return json({ ok: false, reason: 'server_config_error' }, 500);
    const fill = await fetchFillPrice(symbol, ALPACA_KEY, ALPACA_SECRET);
    if (fill.price == null) {
      // Vendor error detail (step/HTTP status) is logged, never returned — it
      // would leak app-key auth/quota state to any authenticated caller.
      console.error('no_price', symbol, JSON.stringify(fill.error));
      return json({ ok: false, reason: 'no_price', symbol }); // 200: game-flow refusal
    }

    const { slots, error: slotsErrored } = await loadSlots(admin, leagueId);
    if (slotsErrored) return json({ ok: false, reason: 'unhandled' }, 500);

    // is_draftable gate (DR-001): a non-draftable symbol is refused unless the
    // commissioner set allow_undraftable. A missing symbols row => not draftable.
    const { data: symRow, error: symErr } = await admin
      .from('symbols').select('is_draftable, last_price').eq('symbol', symbol).maybeSingle();
    // A failed read must never look like "not draftable" or "no cached price":
    // that would let applyPick keep a stranding stock in the pool.
    if (symErr) return json({ ok: false, reason: 'unhandled' }, 500);
    const isDraftable = symRow?.is_draftable === true;
    const cachedPrice = symRow?.last_price == null ? null : Number(symRow.last_price);

    const rules = leagueRules(league, numRounds);

    // Category eligibility is only consulted when this league defines
    // category-filtered slots — skip the three reads otherwise.
    const eligibleCategories = slots.some((s) => s.categoryId != null)
      ? await fetchEligibleCategoryIds(admin, symbol)
      : new Set<string>();

    // The ONE legality gate (../_shared/pick-gate.ts): the same validatePick
    // every auto-pick passes, producing the only thing insertGatedPick accepts.
    // Feasibility (2026-10-05): fail CLOSED — if the pool cannot be read the
    // outer catch returns 500 rather than gating a pick without it.
    const feasibility = await loadFeasibility(admin, ctx, slots, targetId);
    const gate = gatePick(leagueId, {
      rules,
      slots,
      order,
      picks,
      trades: ctx.trades,
      pickerId: targetId,
      symbol,
      price: fill.price,
      eligibleCategories,
      isDraftable,
    }, { state: feasibility.state, open: feasibility.open, cachedPrice, eligibility: eligibleCategories });
    if (!gate.ok) return json({ ok: false, reason: gate.reason }); // 200: game-flow refusal (join-league pattern)

    const ins = await insertGatedPick(admin, gate.pick, 'manual');
    if (!ins.ok) {
      // Unique (league_id, pick_number) index = the race backstop: a
      // concurrent pick — or an auto-pick for an expired clock — got this
      // number first. The client refetches and retries — legality is
      // re-derived from the new state, never reused.
      if (ins.reason === 'pick_conflict') {
        return json({ ok: false, reason: 'pick_conflict' }); // 200: race lost, client refetches + retries
      }
      return json({ ok: false, reason: 'unhandled' }, 500);
    }
    const inserted = ins.row;
    const decision = gate.pick;

    const complete = decision.pickNumber >= order.length * numRounds;
    const statusError = complete ? await finalizeDraft(admin, league, order) : null;
    return json({
      ok: true,
      pick: inserted,
      pick_source: 'manual',
      price_source: fill.source,
      draft_complete: complete,
      status_update_error: statusError,
    });
  } catch (_e) {
    return json({ ok: false, reason: 'unhandled' }, 500);
  }
});
