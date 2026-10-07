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
//   Slotted leagues (price_tiers / category; 2026-10-06, "Replace in the same
//   tier"): a buy must fit a FREE slot by its price and takes it (written to
//   trades.slot_id through record_trade_atomic); selling frees that stock's
//   slot; the tier is set by the ENTRY price and never moves. Refusal is
//   no_eligible_slot + `price` + `open_slots` (the slots that still have room).
//   See userSlotOccupancy in ../_shared/draft-validation.ts.
//
// DROP ('sell'): legal iff the caller's net position is > 0; always sells the
//   ENTIRE position at the current quote, freeing the symbol league-wide.
//
// PREVIEW ('preview'): read-only. Returns the caller's fixed_notional funding
//   state for the league (open sale proceeds + unfilled-slot count + the
//   league's stake) so a client can build the "reinvest which sale?" picker
//   without re-deriving the walk itself. No vendor call, no write. Other
//   stake modes get an empty/zero shape back. For slotted leagues it also
//   returns `slots` (the caller's slot map: each slot + the symbols held in it
//   + free capacity), `unplaced`, and — given `price` — `would_fill` (the slot a
//   buy at that price would take, or null + `open_slots`).
//
// CONCURRENCY (2026-10-05): validation runs here in TS, but the INSERT is
//   record_trade_atomic — a league-wide lock + compare-and-swap of every
//   league-scoped input the validator read (trades/drafts id sets, rules,
//   slots). A request that loses a race re-reads and re-validates, so it gets
//   the right game refusal; trade_conflict only after MAX_ATTEMPTS losses.
//   See commit.ts and supabase/migrations/20261102000000_record_trade_atomic.sql.
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
import { fetchEligibleCategoryIds, fetchEligibleCategoryIdsBatch } from '../_shared/category-eligibility.ts';
import {
  fixedNotionalFunding,
  type TradeRow,
  unattributedHeldSymbols,
  validateTradeDrop,
} from '../_shared/draft-validation.ts';
import {
  commitWithRetry,
  decideTrade,
  type DraftRow,
  type LeagueRow,
  type LedgerState,
  readAllPages,
  type Reply,
  type SlotRow,
  slotPreview,
  slotsFromRows,
  type Step,
  type TradeRequest,
  unhandled,
} from './commit.ts';
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

const LEAGUE_COLUMNS = 'id, num_rounds, draft_status, stake_mode, budget_amount, notional_per_slot, allow_undraftable';

// Reads the league-scoped state the validator (and the CAS) work from. Every
// trades/drafts read is PAGINATED in a stable (created_at, id) order: an
// unranged read caps silently at PostgREST's max_rows, and a truncated ledger
// would both validate on partial state AND never match the RPC's count — a
// permanent trade_conflict (commit.ts readAllPages). `league` is passed in
// for the first attempt (already read up front) and re-read on retries,
// because the commissioner can change rules mid-season.
async function readLedger(
  // deno-lint-ignore no-explicit-any
  admin: any,
  leagueId: string,
  symbol: string,
  userId: string,
  withSlots: boolean,
  league: LeagueRow | null,
): Promise<Step<LedgerState>> {
  if (!league) {
    const { data, error } = await admin.from('leagues').select(LEAGUE_COLUMNS).eq('id', leagueId).maybeSingle();
    if (error) return { ok: false, reply: unhandled() };
    if (!data) return { ok: false, reply: { status: 404, body: { ok: false, reason: 'league_not_found' } } };
    if (data.draft_status !== 'completed') {
      return { ok: false, reply: { status: 200, body: { ok: false, reason: 'draft_not_completed' } } };
    }
    league = data as LeagueRow;
  }

  const picksRes = await readAllPages<DraftRow>((from, to) =>
    admin.from('drafts')
      .select('id, user_id, symbol, entry_price, quantity, pick_number, slot_id', { count: 'exact' })
      .eq('league_id', leagueId)
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(from, to)
  );
  if (!picksRes.ok) return { ok: false, reply: unhandled() };

  const tradesRes = await readAllPages<TradeRow>((from, to) =>
    admin.from('trades')
      .select('id, user_id, symbol, action, quantity, price, total_value, created_at, funded_by_trade_id, slot_id', { count: 'exact' })
      .eq('league_id', leagueId)
      .order('created_at', { ascending: true }).order('id', { ascending: true })
      .range(from, to)
  );
  if (!tradesRes.ok) return { ok: false, reply: unhandled() };
  // trades.user_id is UUID — normalize to string so every comparison against
  // drafts' TEXT user_id is string-vs-string (the documented cast footgun).
  const trades = tradesRes.rows.map((t) => ({ ...t, user_id: String(t.user_id) }));

  let slots: SlotRow[] | null = null;
  let eligibleCategories = new Set<string>();
  let heldEligibility: Map<string, Set<string>> | undefined;
  if (withSlots) {
    const { data: slotData, error: sErr } = await admin
      .from('league_draft_slots')
      .select('id, slot_index, slot_count, price_min, price_max, category_id')
      .eq('league_id', leagueId)
      .order('slot_index', { ascending: true });
    if (sErr) return { ok: false, reply: unhandled() };
    slots = (slotData ?? []) as SlotRow[];
    // Category eligibility only when this league has category slots.
    if (slots.some((s) => s.category_id != null)) {
      if (symbol) eligibleCategories = await fetchEligibleCategoryIds(admin, symbol);
      // A caller's UNATTRIBUTED held positions (pre-fix trade buys, or a deleted
      // slot) are placed by entry price + category, so their eligibility is
      // needed too — at most num_rounds symbols, three reads total. Global
      // facts, not CAS'd, same as the buy symbol's own eligibility.
      const legacy = unattributedHeldSymbols(userId, slotsFromRows(slots), picksRes.rows, trades);
      if (legacy.length > 0) heldEligibility = await fetchEligibleCategoryIdsBatch(admin, legacy);
    }
  }

  return { ok: true, value: { league, picks: picksRes.rows, trades, slots, eligibleCategories, heldEligibility } };
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
      .select(LEAGUE_COLUMNS)
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

    // ---- Positions (+ slots/eligibility for a buy) --------------------------
    // Slots are read for a buy (to validate) and for a preview (to report the
    // caller's slot map / the slot a buy would fill); a sell never reads them.
    const first = await readLedger(admin, leagueId, symbol, user.id, action === 'buy' || action === 'preview', league as LeagueRow);
    if (!first.ok) return json(first.reply.body, first.reply.status);
    const { picks, trades } = first.value;

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
      // Slotted leagues (price_tiers / category): the caller's slot map, and —
      // when the client sends the quote it is showing as `price` (+ `symbol`
      // for category leagues) — the slot a buy would fill. Advisory only.
      const probePrice = body.price == null ? undefined : Number(body.price);
      const slotInfo = slotPreview(first.value, user.id, probePrice);
      if (league.stake_mode !== 'fixed_notional') {
        return json({ ok: true, stake_mode: league.stake_mode ?? null, stake: null, unfilled_slots: 0, sources: [], market, ...slotInfo });
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
        ...slotInfo,
      });
    }

    if (!ALPACA_KEY || !ALPACA_SECRET) return json({ ok: false, reason: 'server_config_error' }, 500);

    // Sells validate ownership BEFORE the vendor call — an illegal drop must
    // not spend an Alpaca request. Buys need the price for bracket/budget
    // validation, so their order is fetch-then-validate.
    // (The commit loop below re-runs the same decision on this same state —
    // cheap and identical — and re-runs it on fresh state after a lost race.)
    if (action === 'sell') {
      const decision = validateTradeDrop(user.id, symbol, picks, trades);
      if (!decision.legal) return json({ ok: false, reason: decision.reason }); // 200: game-flow refusal
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

    // is_draftable gate (DR-001): a non-draftable BUY is refused unless the
    // commissioner set allow_undraftable. Missing symbols row => not draftable.
    // A global fact, read once (not part of the CAS — see the migration header).
    let isDraftable = true;
    if (action === 'buy') {
      const { data: symRow } = await admin
        .from('symbols').select('is_draftable').eq('symbol', symbol).maybeSingle();
      isDraftable = symRow?.is_draftable === true;
    }

    const request: TradeRequest = {
      action: action as 'buy' | 'sell',
      userId: user.id,
      symbol,
      price,
      isDraftable,
      soldTradeId,
    };

    // ---- Validate + record (atomic) ----------------------------------------
    // Each attempt: validate (validateTradeAdd/Drop), re-check market hours
    // right before the write, then record_trade_atomic, which inserts only if
    // the league's trades/drafts/rules/slots are exactly what was validated.
    //
    // The market re-check (#89) closes the window between the gate above and
    // the write: league/membership/position reads, the slot/category lookups,
    // and the Alpaca fill-price round trip can together take long enough to
    // cross a close (or an early close). Re-decides on a FRESH `now` but the
    // SAME already-fetched calendar rows — no second DB read. marketReads is
    // guaranteed non-null and readError:false here: action is buy or sell
    // (preview already returned above), which always fetches it, and a read
    // error would already have returned 503 at the gate above.
    //
    // This replaces the old "KNOWN RACE" (STATUS §4 item 10): the cross-user
    // same-symbol buy race, and the same-user double sell / double buy /
    // skipped-slot double buy, are all closed by the CAS. The
    // trades_funded_by_trade_id_unique index stays as a second layer.
    const reply: Reply = await commitWithRetry({
      readState: () => readLedger(admin, leagueId, symbol, user.id, action === 'buy', null),
      decide: (state) => decideTrade(request, state),
      marketRecheck: () => {
        const recheckGate = decideMarketGate(new Date(), marketReads!.sessions, marketReads!.coverage);
        if (recheckGate.open) return null;
        const resp = tradeGateResponse(recheckGate);
        return { status: resp.status, body: resp.body as Record<string, unknown> };
      },
      commit: (plan, expect) =>
        admin.rpc('record_trade_atomic', {
          p_league_id: leagueId,
          p_user_id: user.id, // auth identity, never client-supplied
          p_symbol: symbol,
          p_action: action,
          p_quantity: plan.quantity,
          p_price: price,
          p_total_value: Math.round(price * plan.quantity * 100) / 100,
          p_funded_by_trade_id: plan.fundedByTradeId,
          p_seen_trade_ids: expect.seenTradeIds,
          p_seen_draft_ids: expect.seenDraftIds,
          p_rules: expect.rules,
          p_slots: expect.slots,
          p_slot_id: plan.slotId, // slotted-league buy: the slot it takes (null otherwise)
        }),
      log: (msg, detail) => console.warn('record-trade:', msg, detail === undefined ? '' : JSON.stringify(detail)),
    }, { firstState: first.value });

    if (reply.body.ok === true) {
      return json({ ...reply.body, price_source: fill.source }, reply.status);
    }
    return json(reply.body, reply.status);
  } catch (_e) {
    return json({ ok: false, reason: 'unhandled' }, 500);
  }
});
