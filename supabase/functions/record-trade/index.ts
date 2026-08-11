// record-trade — server-side post-draft add/drop for the in-house simulator
// (Phase 3, DR-001 / SIMULATOR_MIGRATION_SPEC). Replaces the removed
// place-order broker path; TradeModal (mobile + web) submits here.
//
// ADD ('buy'): validates like a draft pick minus the turn check — symbol not
//   owned anywhere in the league, price + category eligibility fit an
//   unfilled slot (Phase 4: category checks LIVE), fill fits remaining budget
//   (budget_cap), roster not full — then fills at the current app-key quote.
//   Quantity is server-computed per stake mode (fractional for
//   fixed_notional); the client's quantity input is NOT trusted.
//
// DROP ('sell'): legal iff the caller's net position is > 0; always sells the
//   ENTIRE position at the current quote, freeing the symbol league-wide.
//
// Mid-week scoring: NO new mechanism here. A buy lands as a plain trades row;
// snapshot-week-end's close.ts derives the entered_mid_week snapshot from
// exactly that row (weighted-average entry price over 'buy' rows), and
// holdings netting in the snapshot jobs handles sells. Reusing that path —
// rather than forking it — is a spec requirement.
//
// user_id: trades.user_id is UUID (auth.uid()), so bots ('bot-*', TEXT ids)
// cannot trade — only the authenticated caller trades, for themself.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchFillPrice } from '../_shared/alpaca-price.ts';
import { fetchEligibleCategoryIds } from '../_shared/category-eligibility.ts';
import {
  type LeagueRules,
  type PickRow,
  type Slot,
  type TradeRow,
  validateTradeAdd,
  validateTradeDrop,
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

// Fail-open rate limit (join-league pattern).
// deno-lint-ignore no-explicit-any
async function rateLimitOk(admin: any, userId: string, ip: string): Promise<boolean> {
  try {
    const calls = [
      admin.rpc('check_and_bump_rate_limit', { p_bucket: 'record-trade', p_subject: `user:${userId}`, p_limit: 30 }),
    ];
    if (ip) {
      calls.push(admin.rpc('check_and_bump_rate_limit', { p_bucket: 'record-trade', p_subject: `ip:${ip}`, p_limit: 60 }));
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
    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    const action = String(body.action ?? '');
    if (!leagueId || !symbol || (action !== 'buy' && action !== 'sell')) {
      return json({ ok: false, reason: 'bad_request' }, 400);
    }

    // ---- League + membership ----------------------------------------------
    const { data: league, error: lgErr } = await admin
      .from('leagues')
      .select('id, num_rounds, draft_status, stake_mode, budget_amount, notional_per_slot')
      .eq('id', leagueId)
      .maybeSingle();
    if (lgErr) return json({ ok: false, reason: 'unhandled' }, 500);
    if (!league) return json({ ok: false, reason: 'league_not_found' }, 404);
    // Trading opens once the draft is done; before that the draft IS the
    // acquisition path.
    if (league.draft_status !== 'completed') {
      return json({ ok: false, reason: 'draft_not_completed' }); // 200: game-flow refusal (join-league pattern)
    }

    const { data: member, error: memErr } = await admin
      .from('league_members')
      .select('user_id')
      .eq('league_id', leagueId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (memErr) return json({ ok: false, reason: 'unhandled' }, 500);
    if (!member) return json({ ok: false, reason: 'not_a_member' }, 403);

    // ---- Positions ---------------------------------------------------------
    const { data: pickData, error: pErr } = await admin
      .from('drafts')
      .select('user_id, symbol, entry_price, quantity, pick_number, slot_id')
      .eq('league_id', leagueId);
    if (pErr) return json({ ok: false, reason: 'unhandled' }, 500);
    const picks = (pickData ?? []) as PickRow[];

    const { data: tradeData, error: tErr } = await admin
      .from('trades')
      .select('user_id, symbol, action, quantity, price')
      .eq('league_id', leagueId);
    if (tErr) return json({ ok: false, reason: 'unhandled' }, 500);
    // trades.user_id is UUID — normalize to string so every comparison against
    // drafts' TEXT user_id is string-vs-string (the documented cast footgun).
    const trades = (tradeData ?? []).map((t) => ({ ...t, user_id: String(t.user_id) })) as TradeRow[];

    if (!ALPACA_KEY || !ALPACA_SECRET) return json({ ok: false, reason: 'server_config_error' }, 500);

    // Sells validate ownership BEFORE the vendor call — an illegal drop must
    // not spend an Alpaca request. Buys need the price for bracket/budget
    // validation, so their order is fetch-then-validate.
    let dropQuantity: number | null = null;
    if (action === 'sell') {
      const decision = validateTradeDrop(user.id, symbol, picks, trades);
      if (!decision.legal) return json({ ok: false, reason: decision.reason }); // 200: game-flow refusal
      dropQuantity = decision.quantity;
    }

    // ---- Price (app-key quote path; last available quote off-hours) --------
    const fill = await fetchFillPrice(symbol, ALPACA_KEY, ALPACA_SECRET);
    if (fill.price == null) {
      // Vendor error detail (step/HTTP status) is logged, never returned — it
      // would leak app-key auth/quota state to any authenticated caller.
      console.error('no_price', symbol, JSON.stringify(fill.error));
      return json({ ok: false, reason: 'no_price', symbol }); // 200: game-flow refusal
    }

    // ---- Validate buy ------------------------------------------------------
    let quantity: number;
    if (action === 'buy') {
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
        numRounds: Number(league.num_rounds) || 6,
      };

      // Category eligibility only when this league has category slots.
      const eligibleCategories = slots.some((s) => s.categoryId != null)
        ? await fetchEligibleCategoryIds(admin, symbol)
        : new Set<string>();

      const decision = validateTradeAdd({
        rules,
        slots,
        picks,
        trades,
        userId: user.id,
        symbol,
        price: fill.price,
        eligibleCategories,
      });
      if (!decision.legal) return json({ ok: false, reason: decision.reason }); // 200: game-flow refusal
      quantity = decision.quantity;
    } else {
      quantity = dropQuantity!; // validated above, before the vendor call
    }

    // ---- Record ------------------------------------------------------------
    // KNOWN RACE (accepted for launch, flagged for follow-up): two concurrent
    // buys of the same symbol both pass the in-memory ownership check before
    // either row lands — trades has no uniqueness backstop analogous to the
    // drafts (league_id, pick_number) index, and a partial unique index can't
    // express "one OWNER at a time" over a buy/sell ledger. The correct fix is
    // an atomic SECURITY DEFINER RPC (join_league_by_code pattern) that
    // validates and inserts in one transaction. Window is sub-second and the
    // failure mode (two owners of one symbol) is heal-able with a drop.
    const { data: inserted, error: insErr } = await admin
      .from('trades')
      .insert({
        league_id: leagueId,
        user_id: user.id, // UUID column — auth identity, never client-supplied
        symbol,
        action,
        quantity,
        price: fill.price,
        total_value: Math.round(fill.price * quantity * 100) / 100,
      })
      .select('*')
      .single();
    if (insErr) return json({ ok: false, reason: 'unhandled' }, 500);

    return json({ ok: true, trade: inserted, price_source: fill.source });
  } catch (_e) {
    return json({ ok: false, reason: 'unhandled' }, 500);
  }
});
