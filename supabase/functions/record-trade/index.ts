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
//   fixed_notional (2026-09-29): a buy reinvests the SALE PROCEEDS of the
//   slot it fills, not a fresh notional stake — see fixedNotionalFunding /
//   resolveFunding in ../_shared/draft-validation.ts and the migration header
//   at supabase/migrations/20261006000000_trades_funded_by_trade_id.sql. The
//   caller may name which of their own open sales to reinvest via
//   `sold_trade_id`; omitted = server default (oldest unclaimed, FIFO).
//
// DROP ('sell'): legal iff the caller's net position is > 0; always sells the
//   ENTIRE position at the current quote, freeing the symbol league-wide.
//
// PREVIEW ('preview'): read-only. Returns the caller's fixed_notional funding
//   state for the league (open sale proceeds + unfilled-slot count + the
//   league's stake) so a client can build the "reinvest which sale?" picker
//   without re-deriving the walk itself. No vendor call, no write. Other
//   stake modes get an empty/zero shape back.
//
// Mid-week scoring: NO new mechanism here. A buy lands as a plain trades row;
// snapshot-week-end's close.ts derives the entered_mid_week snapshot from
// exactly that row (weighted-average entry price over 'buy' rows), and
// holdings netting in the snapshot jobs handles sells. Reusing that path —
// rather than forking it — is a spec requirement.
//
// user_id: trades.user_id is UUID (auth.uid()), so bots ('bot-*', TEXT ids)
// cannot trade — only the authenticated caller trades, for themself.
//
// PRICE ROUNDING: trades.price is NUMERIC(10,2) — Postgres rounds it to
// cents on insert regardless of what JS sends. Sizing a fixed_notional
// quantity off the UNROUNDED Alpaca quote (the pre-fix behaviour) then leaves
// stored total_value slightly inconsistent with stored price × quantity — a
// few cents to a few dollars per trade on a cheap stock (CLAUDE.md, "verify
// the effect, not the status"). Fixed by rounding the fill price to cents
// ONCE, right after the quote, and using that rounded price for every
// downstream computation and for the insert.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { fetchFillPrice } from '../_shared/alpaca-price.ts';
import { fetchEligibleCategoryIds } from '../_shared/category-eligibility.ts';
import { tradeRefusalReason } from './gate.ts';
import {
  fixedNotionalFunding,
  type LeagueRules,
  type PickRow,
  type Slot,
  type TradeRow,
  validateTradeAdd,
  validateTradeDrop,
} from '../_shared/draft-validation.ts';
import {
  decideMarketGate,
  marketLabel,
  tradeGateResponse,
  type CalendarRow,
  type Coverage,
  type MarketGate,
} from '../_shared/market-hours.ts';

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

// ---- Market hours gate (2026-09-30, docs/audits/2026-09-30-week-window-
// audit.md S5/U2) --------------------------------------------------------
// Reads market_calendar + market_calendar_coverage once per request. A
// READ ERROR is deliberately NOT folded into decideMarketGate's own
// "coverage: null" fail-closed path — that path means "never refreshed" or
// "refresh lapsed", both legitimate calendar states decideMarketGate must
// reason about (e.g. distinguishing a holiday from no-coverage). A
// *read* error is a third, distinct thing (a transient DB problem) and
// must surface as its own calendar_unavailable, never silently degrade
// into "no sessions today" — that would let a read error be misreported as
// e.g. a holiday (CLAUDE.md "success signals" #1: a failure must never
// read as a routine, legitimate outcome).
interface MarketCalendarReads {
  sessions: CalendarRow[];
  coverage: Coverage | null;
  readError: boolean;
}

// deno-lint-ignore no-explicit-any
async function fetchMarketCalendar(admin: any): Promise<MarketCalendarReads> {
  const [covRes, sessRes] = await Promise.all([
    admin.from('market_calendar_coverage').select('covered_from, covered_through').maybeSingle(),
    admin.from('market_calendar').select('session_date, open_et, close_et').order('session_date', { ascending: true }),
  ]);
  if (covRes.error || sessRes.error) {
    console.error('market_calendar read error', covRes.error, sessRes.error);
    return { sessions: [], coverage: null, readError: true };
  }
  return {
    sessions: (sessRes.data ?? []) as CalendarRow[],
    coverage: covRes.data
      ? { covered_from: covRes.data.covered_from, covered_through: covRes.data.covered_through }
      : null,
    readError: false,
  };
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

    // ---- Market hours gate ------------------------------------------------
    // Deliberately BEFORE leagueId/action/symbol validation: a bare
    // {"action":"buy"} answers purely off the wall clock and this one read
    // (market_closed, or calendar_unavailable, or — once past this gate —
    // bad_request) with no league lookup and no write. That ordering is what
    // lets a post-deploy check exercise the gate with no real league/session.
    // `gate` is also reused for the preview's fail-soft market label below,
    // and `marketReads` is reused again right before the insert (no second
    // DB read) to close the window between this check and the write.
    let marketReads: MarketCalendarReads | null = null;
    let gate: MarketGate | null = null;
    if (action === 'buy' || action === 'sell' || action === 'preview') {
      marketReads = await fetchMarketCalendar(admin);
      if (marketReads.readError) {
        if (action === 'buy' || action === 'sell') {
          return json({ ok: false, reason: 'calendar_unavailable' }, 503);
        }
        // preview: fall through with gate left null -> fail-soft market:null
      } else {
        gate = decideMarketGate(new Date(), marketReads.sessions, marketReads.coverage);
        if ((action === 'buy' || action === 'sell') && !gate.open) {
          const resp = tradeGateResponse(gate);
          return json(resp.body, resp.status);
        }
      }
    }

    if (!leagueId || (action !== 'buy' && action !== 'sell' && action !== 'preview')) {
      return json({ ok: false, reason: 'bad_request' }, 400);
    }
    // preview needs no symbol — it reports the caller's funding state only.
    if ((action === 'buy' || action === 'sell') && !symbol) {
      return json({ ok: false, reason: 'bad_request' }, 400);
    }
    // fixed_notional only: which of the caller's own open sales a buy
    // reinvests. Validated as "actually one of theirs" by validateTradeAdd
    // (via resolveFunding), not here.
    const soldTradeId = body.sold_trade_id == null ? undefined : String(body.sold_trade_id).trim() || undefined;

    // ---- League + membership ----------------------------------------------
    const { data: league, error: lgErr } = await admin
      .from('leagues')
      .select('id, num_rounds, draft_status, season_status, stake_mode, budget_amount, notional_per_slot, allow_undraftable')
      .eq('id', leagueId)
      .maybeSingle();
    if (lgErr) return json({ ok: false, reason: 'unhandled' }, 500);
    if (!league) return json({ ok: false, reason: 'league_not_found' }, 404);
    // Trading opens once the draft is done; before that the draft IS the
    // acquisition path.
    // 200: game-flow refusal (join-league pattern). season_completed: Run it back
    // (record-trade/gate.ts): a finished season is frozen, and trading closes with it.
    const refusal = tradeRefusalReason(league);
    if (refusal) {
      return json({ ok: false, reason: refusal });
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
      .select('id, user_id, symbol, action, quantity, price, total_value, created_at, funded_by_trade_id')
      .eq('league_id', leagueId);
    if (tErr) return json({ ok: false, reason: 'unhandled' }, 500);
    // trades.user_id is UUID — normalize to string so every comparison against
    // drafts' TEXT user_id is string-vs-string (the documented cast footgun).
    const trades = (tradeData ?? []).map((t) => ({ ...t, user_id: String(t.user_id) })) as TradeRow[];

    // ---- Preview (read-only; no vendor call, no write) ----------------------
    // Returns the caller's fixed_notional funding state so a client can build
    // a "reinvest which sale?" picker without re-deriving the walk. Other
    // stake modes get an empty/zero shape — this endpoint exists for
    // fixed_notional; there is nothing to preview elsewhere.
    if (action === 'preview') {
      // Additive, never blocking: preview has no fill price and no write.
      // null (fail-soft) when the calendar itself couldn't be read/decided —
      // see marketLabel's doc for why a guessed status is worse than none.
      const market = gate ? marketLabel(gate) : null;
      if (league.stake_mode !== 'fixed_notional') {
        return json({ ok: true, stake_mode: league.stake_mode ?? null, stake: null, unfilled_slots: 0, sources: [], market });
      }
      const notional = league.notional_per_slot == null ? 1000 : Number(league.notional_per_slot);
      const funding = fixedNotionalFunding(user.id, picks, trades);
      return json({
        ok: true,
        stake_mode: 'fixed_notional',
        stake: notional,
        unfilled_slots: funding.unfilledSlots,
        sources: funding.open.map((o) => ({ trade_id: o.tradeId, symbol: o.symbol, amount: o.amount })),
        market,
      });
    }

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
    // Round to the cents trades.price actually stores (NUMERIC(10,2)) BEFORE
    // sizing or inserting anything — see the PRICE ROUNDING header note.
    const price = Math.round(fill.price * 100) / 100;
    if (!(price > 0)) return json({ ok: false, reason: 'no_price', symbol }); // 200: game-flow refusal

    // ---- Validate buy ------------------------------------------------------
    let quantity: number;
    // fixed_notional only: which sale this buy reinvests (null = filled a
    // previously-unfilled/skipped slot at full notional). Always null for a
    // sell and for every other stake mode.
    let fundedByTradeId: string | null = null;
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
        allowUndraftable: league.allow_undraftable === true,
      };

      // is_draftable gate (DR-001): a non-draftable BUY is refused unless the
      // commissioner set allow_undraftable. Missing symbols row => not draftable.
      const { data: symRow } = await admin
        .from('symbols').select('is_draftable').eq('symbol', symbol).maybeSingle();
      const isDraftable = symRow?.is_draftable === true;

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
        price,
        eligibleCategories,
        isDraftable,
        soldTradeId,
      });
      if (!decision.legal) return json({ ok: false, reason: decision.reason }); // 200: game-flow refusal
      quantity = decision.quantity;
      fundedByTradeId = decision.fundedByTradeId ?? null;
    } else {
      quantity = dropQuantity!; // validated above, before the vendor call
    }

    // ---- Market hours re-check (right before the write) --------------------
    // Closes the window between the gate above and this insert: league/
    // membership/position reads, the slot/category lookups, and the Alpaca
    // fill-price round trip can together take long enough to cross a close
    // (or an early close). Re-decides on a FRESH `now` but the SAME already-
    // fetched calendar rows — no second DB read. marketReads is guaranteed
    // non-null and readError:false here: action is buy or sell (preview
    // already returned above), which always fetches it, and a read error
    // would already have returned 503 at the gate above.
    const recheckGate = decideMarketGate(new Date(), marketReads!.sessions, marketReads!.coverage);
    if (!recheckGate.open) {
      const resp = tradeGateResponse(recheckGate);
      return json(resp.body, resp.status);
    }

    // ---- Record ------------------------------------------------------------
    // KNOWN RACE (accepted for launch, narrowed 2026-09-29 to the cross-user
    // case — see the funded_by_trade_id unique index in
    // 20261006000000_trades_funded_by_trade_id.sql, which now closes the
    // same-user concurrent-rebuy variant of this race with a 23505 below):
    // two concurrent buys of DIFFERENT users for the same symbol both pass
    // the in-memory ownership check before either row lands — trades has no
    // uniqueness backstop analogous to the drafts (league_id, pick_number)
    // index, and a partial unique index can't express "one OWNER at a time"
    // over a buy/sell ledger. The correct fix is an atomic SECURITY DEFINER
    // RPC (join_league_by_code pattern) that validates and inserts in one
    // transaction. Window is sub-second and the failure mode (two owners of
    // one symbol) is heal-able with a drop.
    const { data: inserted, error: insErr } = await admin
      .from('trades')
      .insert({
        league_id: leagueId,
        user_id: user.id, // UUID column — auth identity, never client-supplied
        symbol,
        action,
        quantity,
        price,
        total_value: Math.round(price * quantity * 100) / 100,
        funded_by_trade_id: fundedByTradeId,
      })
      .select('*')
      .single();
    if (insErr) {
      // 23505 on trades_funded_by_trade_id_unique specifically means another
      // request spent this same sale's proceeds first (or, vanishingly
      // rarely, exactly this trade concurrently) — a legality-time race the
      // in-memory check above cannot see. Matched by constraint name, not
      // bare code, so a FUTURE unique constraint on trades (unrelated to
      // proceeds) can't be mislabeled as this refusal.
      if (insErr.code === '23505' && (insErr.message ?? '').includes('trades_funded_by_trade_id_unique')) {
        return json({ ok: false, reason: 'proceeds_unavailable' }); // 200: game-flow refusal
      }
      return json({ ok: false, reason: 'unhandled' }, 500);
    }

    return json({ ok: true, trade: inserted, price_source: fill.source });
  } catch (_e) {
    return json({ ok: false, reason: 'unhandled' }, 500);
  }
});
