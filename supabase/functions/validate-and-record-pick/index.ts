// validate-and-record-pick — the server-side draft legality gate (Phase 3,
// DR-001 / SIMULATOR_MIGRATION_SPEC).
//
// Before this function, pick legality lived only in the clients: RLS on
// `drafts` gates league MEMBERSHIP, not legality, and clients wrote picks with
// direct .from('drafts').insert(). This function is now the single write path
// the clients use; RLS remains the membership backstop underneath it.
//
// A pick is legal iff (validate via ../_shared/draft-validation.ts):
//   * it is the target's turn in the canonical snake order
//   * the symbol is not already owned in the league (net of drops)
//   * the price fits an unfilled slot bracket (price_tiers leagues)
//     — category eligibility is NOT checked until Phase 4 seeds the
//       categories tables; slots are treated as flex (see PHASE4-CATEGORIES
//       markers in the shared module)
//   * the fill fits the remaining budget (budget_cap leagues)
//
// Fill-at-draft: entry_price comes from the app-key Alpaca path
// (../_shared/alpaca-price.ts — same chain as quote); quantity is
// notional_per_slot/entry_price for fixed_notional, else 1.
//
// Callers: the picker themself, OR any league member on behalf of a bot
// ('bot-*' target — mirrors the "League members can create bot picks" RLS
// policy), OR any league member skipping the CURRENT picker's turn when that
// picker is a bot (action:'skip', the stuck-bot escape hatch).
//
// Auth: gateway verify_jwt=true + in-code getUser() (join-league pattern).
// Writes use the service-role client, so membership is checked in-code.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchFillPrice } from '../_shared/alpaca-price.ts';
import {
  computeDraftOrder,
  type LeagueRules,
  type PickRow,
  SKIP_SYMBOL,
  type Slot,
  type TradeRow,
  validatePick,
  validateSkip,
} from '../_shared/draft-validation.ts';

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
let requestOrigin = '';
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...getCorsHeaders(requestOrigin) },
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
  requestOrigin = req.headers.get('Origin') || '';
  if (req.method === 'OPTIONS') return new Response('ok', { headers: getCorsHeaders(requestOrigin) });
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
    const action = body.action === 'skip' ? 'skip' : 'pick';
    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    const targetId = String(body.for_user_id ?? user.id).trim();

    if (!leagueId) return json({ ok: false, reason: 'bad_request' }, 400);
    if (action === 'pick' && !symbol) return json({ ok: false, reason: 'bad_request' }, 400);

    // Picking for someone else is only allowed for bots (both actions).
    if (targetId !== user.id && !targetId.startsWith('bot-')) {
      return json({ ok: false, reason: 'forbidden_target' }, 403);
    }

    // ---- Load league + membership (service role; membership checked here) --
    const { data: league, error: lgErr } = await admin
      .from('leagues')
      .select('id, commissioner_id, num_rounds, draft_status, stake_mode, budget_amount, notional_per_slot')
      .eq('id', leagueId)
      .maybeSingle();
    if (lgErr) return json({ ok: false, reason: 'unhandled' }, 500);
    if (!league) return json({ ok: false, reason: 'league_not_found' }, 404);
    if (league.draft_status !== 'in_progress') {
      return json({ ok: false, reason: 'draft_not_in_progress' }); // 200: game-flow refusal
    }

    const { data: members, error: memErr } = await admin
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId);
    if (memErr) return json({ ok: false, reason: 'unhandled' }, 500);

    const memberIds = (members ?? []).map((m) => String(m.user_id));
    if (!memberIds.includes(user.id)) return json({ ok: false, reason: 'not_a_member' }, 403);
    if (!memberIds.includes(targetId)) return json({ ok: false, reason: 'target_not_member' }, 403);

    const order = computeDraftOrder(String(league.commissioner_id ?? ''), memberIds);
    const numRounds = Number(league.num_rounds) || 6;

    // ---- Load picks / trades / slots --------------------------------------
    const { data: pickData, error: pErr } = await admin
      .from('drafts')
      .select('user_id, symbol, entry_price, quantity, pick_number, slot_id')
      .eq('league_id', leagueId)
      .order('pick_number', { ascending: true });
    if (pErr) return json({ ok: false, reason: 'unhandled' }, 500);
    const picks = (pickData ?? []) as PickRow[];

    // Trades should not exist mid-draft, but the ownership check must not
    // assume that — a re-drafting league could carry ledger history.
    const { data: tradeData, error: tErr } = await admin
      .from('trades')
      .select('user_id, symbol, action, quantity, price')
      .eq('league_id', leagueId);
    if (tErr) return json({ ok: false, reason: 'unhandled' }, 500);
    const trades = (tradeData ?? []).map((t) => ({ ...t, user_id: String(t.user_id) })) as TradeRow[];

    // ---- Skip: forfeit the current turn (stuck-bot escape hatch) ----------
    if (action === 'skip') {
      // Humans may only skip THEMSELVES; members may skip a bot's turn.
      if (targetId !== user.id && !targetId.startsWith('bot-')) {
        return json({ ok: false, reason: 'forbidden_target' }, 403);
      }
      const decision = validateSkip(targetId, order, picks.length, numRounds);
      if (!decision.legal) return json({ ok: false, reason: decision.reason }); // 200: game-flow refusal (join-league pattern)

      const { data: inserted, error: insErr } = await admin
        .from('drafts')
        .insert({
          league_id: leagueId,
          user_id: targetId,
          symbol: SKIP_SYMBOL,
          entry_price: 0,
          quantity: 0,
          round: decision.round,
          pick_number: decision.pickNumber,
          draft_date: new Date().toISOString(),
        })
        .select('*')
        .single();
      if (insErr) {
        if ((insErr as { code?: string }).code === '23505') {
          return json({ ok: false, reason: 'pick_conflict' }); // 200: race lost, client refetches + retries
        }
        return json({ ok: false, reason: 'unhandled' }, 500);
      }
      const complete = decision.pickNumber >= order.length * numRounds;
      const statusError = complete ? await markDraftComplete(admin, leagueId) : null;
      return json({ ok: true, pick: inserted, draft_complete: complete, status_update_error: statusError });
    }

    // ---- Pick: price server-side, validate, record ------------------------
    if (!ALPACA_KEY || !ALPACA_SECRET) return json({ ok: false, reason: 'server_config_error' }, 500);
    const fill = await fetchFillPrice(symbol, ALPACA_KEY, ALPACA_SECRET);
    if (fill.price == null) {
      return json({ ok: false, reason: 'no_price', symbol, detail: fill.error }); // 200: game-flow refusal
    }

    const { data: slotData, error: sErr } = await admin
      .from('league_draft_slots')
      .select('id, slot_index, slot_count, price_min, price_max, category_id')
      .eq('league_id', leagueId)
      .order('slot_index', { ascending: true });
    if (sErr) return json({ ok: false, reason: 'unhandled' }, 500);
    const slots: Slot[] = (slotData ?? []).map((s) => ({
      id: String(s.id),
      slotIndex: Number(s.slot_index),
      slotCount: Number(s.slot_count),
      priceMin: s.price_min == null ? null : Number(s.price_min),
      priceMax: s.price_max == null ? null : Number(s.price_max),
      categoryId: s.category_id == null ? null : String(s.category_id),
    }));

    const rules: LeagueRules = {
      stakeMode: (league.stake_mode ?? null) as LeagueRules['stakeMode'],
      budgetAmount: league.budget_amount == null ? null : Number(league.budget_amount),
      notionalPerSlot: league.notional_per_slot == null ? null : Number(league.notional_per_slot),
      numRounds,
    };

    const decision = validatePick({
      rules,
      slots,
      order,
      picks,
      trades,
      pickerId: targetId,
      symbol,
      price: fill.price,
    });
    if (!decision.legal) return json({ ok: false, reason: decision.reason }); // 200: game-flow refusal (join-league pattern)

    const { data: inserted, error: insErr } = await admin
      .from('drafts')
      .insert({
        league_id: leagueId,
        user_id: targetId,
        symbol,
        entry_price: fill.price,
        quantity: decision.quantity,
        round: decision.round,
        pick_number: decision.pickNumber,
        draft_date: new Date().toISOString(),
        slot_id: decision.slotId,
      })
      .select('*')
      .single();
    if (insErr) {
      // Unique (league_id, pick_number) index = the race backstop: a
      // concurrent pick got this number first. The client refetches and
      // retries — legality is re-derived from the new state, never reused.
      if ((insErr as { code?: string }).code === '23505') {
        return json({ ok: false, reason: 'pick_conflict' }); // 200: race lost, client refetches + retries
      }
      return json({ ok: false, reason: 'unhandled' }, 500);
    }

    const complete = decision.pickNumber >= order.length * numRounds;
    const statusError = complete ? await markDraftComplete(admin, leagueId) : null;
    return json({
      ok: true,
      pick: inserted,
      price_source: fill.source,
      draft_complete: complete,
      status_update_error: statusError,
    });
  } catch (_e) {
    return json({ ok: false, reason: 'unhandled' }, 500);
  }
});

// Destructure-and-check per CLAUDE.md: .update() resolving is NOT success.
// Returns an error string (surfaced to the caller) or null.
async function markDraftComplete(
  // deno-lint-ignore no-explicit-any
  admin: any,
  leagueId: string,
): Promise<string | null> {
  const { error } = await admin
    .from('leagues')
    .update({ draft_status: 'completed' })
    .eq('id', leagueId);
  return error ? 'draft_status_update_failed' : null;
}
