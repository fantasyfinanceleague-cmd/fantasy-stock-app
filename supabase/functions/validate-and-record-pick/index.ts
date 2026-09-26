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
// skipping the CURRENT picker's turn when that picker is a bot (action:'skip',
// the stuck-bot escape hatch), OR any league member re-running draft
// finalization (action:'finalize', see below).
//
// action:'bot_pick': mobile's bot auto-picker. Any member's client may fire
// this when it's a bot's turn (mirrors web's client-driven botAutoPick, but
// the SERVER — not the client — chooses the symbol: rankBotCandidates
// (../_shared/bot-pick.ts) coarsely filters the symbols catalog on cached
// last_price, then this function tries up to BOT_PICK_MAX_ATTEMPTS candidates
// through the SAME live-price + validatePick gate a human pick uses, in order,
// until one is legal or the attempts are exhausted (falls back to a SKIP —
// same sentinel and same finalize-on-completion path as a human skip). KNOWN
// LIMIT (launch-acceptable, tracked in docs/STATUS.md): a bot's turn only
// advances while some member's app is open on the draft screen to fire the
// request — there is no server-scheduled trigger.
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
import { buildFinalizeArgs, planSeason, readFinalizeResult } from '../_shared/schedule.ts';
import { BOT_PICK_MAX_ATTEMPTS, type BotSymbolCandidate, rankBotCandidates } from '../_shared/bot-pick.ts';
import {
  computeDraftOrder,
  currentTurn,
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
      : 'pick';
    const symbol = String(body.symbol ?? '').trim().toUpperCase();
    const targetId = String(body.for_user_id ?? user.id).trim();

    if (!leagueId) return json({ ok: false, reason: 'bad_request' }, 400);
    if (action === 'pick' && !symbol) return json({ ok: false, reason: 'bad_request' }, 400);

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
    const { data: league, error: lgErr } = await admin
      .from('leagues')
      .select('id, commissioner_id, num_rounds, draft_status, stake_mode, budget_amount, notional_per_slot, allow_undraftable, league_type, num_weeks, duration_days')
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

    // ---- Every pick made but still in_progress: (re-)finalize -------------
    // Normally unreachable (the final pick finalizes). Reached only when that
    // finalize failed — then any call for the league retries it. Checked before
    // pricing so a retry never spends an Alpaca call on a finished draft.
    if (order.length > 0 && picks.length >= order.length * numRounds) {
      const finalizeError = await finalizeDraft(admin, league, memberIds);
      if (action === 'finalize') {
        return json({ ok: finalizeError === null, draft_complete: true, status_update_error: finalizeError });
      }
      return json({ ok: false, reason: 'draft_complete', status_update_error: finalizeError }); // 200: game-flow refusal
    }
    if (action === 'finalize') return json({ ok: false, reason: 'draft_not_complete' }); // 200: game-flow refusal

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
      // Target already constrained above: self (voluntary forfeit) or a bot.
      const result = await insertSkip(admin, leagueId, targetId, order, picks, numRounds, league, memberIds);
      if (!result.ok) return json({ ok: false, reason: result.reason }); // 200: game-flow refusal (join-league pattern)
      return json({ ok: true, pick: result.pick, draft_complete: result.complete, status_update_error: result.statusError });
    }

    // ---- Bot pick: server chooses the symbol (mobile has no client-side bot
    // stock pool — see the header comment). Tries ranked candidates through
    // the SAME live-price + validatePick gate a human pick uses; falls back
    // to a SKIP if none are legal. --------------------------------------
    if (action === 'bot_pick') {
      // Cheapest check first (same ordering validatePick itself documents):
      // refuse an out-of-turn bot_pick before spending anything on it. Without
      // this, any member could name an existing-but-not-current bot id (every
      // roster is visible to every member) and force up to
      // BOT_PICK_MAX_ATTEMPTS live Alpaca calls per call purely to be told
      // not_your_turn — validatePick would catch it too, but only AFTER the
      // candidate loop below already spent those calls.
      const turn = currentTurn(picks.length, order, numRounds);
      if (!turn) return json({ ok: false, reason: 'draft_complete' }); // unreachable in practice — the every-pick-made branch above returns first
      if (turn.pickerId !== targetId) return json({ ok: false, reason: 'not_your_turn' });

      if (!ALPACA_KEY || !ALPACA_SECRET) return json({ ok: false, reason: 'server_config_error' }, 500);

      const { slots, error: slotsErrored } = await loadSlots(admin, leagueId);
      if (slotsErrored) return json({ ok: false, reason: 'unhandled' }, 500);

      const rules: LeagueRules = {
        stakeMode: (league.stake_mode ?? null) as LeagueRules['stakeMode'],
        budgetAmount: league.budget_amount == null ? null : Number(league.budget_amount),
        notionalPerSlot: league.notional_per_slot == null ? null : Number(league.notional_per_slot),
        numRounds,
        allowUndraftable: league.allow_undraftable === true,
      };

      // Cheap pre-filter pool on the enrichment cron's cached last_price —
      // rankBotCandidates does the real filtering (owned/budget/bracket); this
      // query just bounds how many candidates we consider.
      let symbolQuery = admin
        .from('symbols')
        .select('symbol, last_price, is_draftable, market_cap')
        .not('last_price', 'is', null)
        .order('market_cap', { ascending: false, nullsFirst: false })
        .limit(150);
      if (!rules.allowUndraftable) symbolQuery = symbolQuery.eq('is_draftable', true);
      const { data: symbolRows, error: symErr } = await symbolQuery;
      if (symErr) return json({ ok: false, reason: 'unhandled' }, 500);

      const candidates: BotSymbolCandidate[] = (symbolRows ?? []).map((s) => ({
        symbol: String(s.symbol),
        lastPrice: s.last_price == null ? null : Number(s.last_price),
        isDraftable: s.is_draftable === true,
        marketCap: s.market_cap == null ? null : Number(s.market_cap),
      }));
      const isDraftableBySymbol = new Map(candidates.map((c) => [c.symbol, c.isDraftable]));

      const ranked = rankBotCandidates({ rules, slots, picks, trades, botId: targetId, candidates });

      let insertedPick: Record<string, unknown> | null = null;
      let insertedComplete = false;
      let priceSource: string | null = null;

      for (const candidateSymbol of ranked.slice(0, BOT_PICK_MAX_ATTEMPTS)) {
        const fill = await fetchFillPrice(candidateSymbol, ALPACA_KEY, ALPACA_SECRET);
        if (fill.price == null) continue; // vendor error logged inside fetchFillPrice's caller convention elsewhere; try the next candidate

        const eligibleCategories = slots.some((s) => s.categoryId != null)
          ? await fetchEligibleCategoryIds(admin, candidateSymbol)
          : new Set<string>();

        const decision = validatePick({
          rules,
          slots,
          order,
          picks,
          trades,
          pickerId: targetId,
          symbol: candidateSymbol,
          price: fill.price,
          eligibleCategories,
          isDraftable: isDraftableBySymbol.get(candidateSymbol),
        });
        if (!decision.legal) continue;

        const { data: row, error: insErr } = await admin
          .from('drafts')
          .insert({
            league_id: leagueId,
            user_id: targetId,
            symbol: candidateSymbol,
            entry_price: fill.price,
            quantity: decision.quantity,
            round: decision.round,
            pick_number: decision.pickNumber,
            slot_id: decision.slotId,
          })
          .select('*')
          .single();
        if (insErr) {
          // Race backstop, same as the human pick path below: someone else's
          // write took this pick number first. Stop trying candidates — the
          // caller's next bot_pick call re-derives legality from fresh state.
          if ((insErr as { code?: string }).code === '23505') {
            return json({ ok: false, reason: 'pick_conflict' }); // 200: race lost, client retries
          }
          return json({ ok: false, reason: 'unhandled' }, 500);
        }
        insertedPick = row;
        insertedComplete = decision.pickNumber >= order.length * numRounds;
        priceSource = fill.source;
        break;
      }

      if (!insertedPick) {
        // No candidate was legal (or none had a live price) — forfeit the
        // bot's turn exactly like the human-triggered skip escape hatch, so
        // the draft still advances instead of stalling on this bot forever.
        const result = await insertSkip(admin, leagueId, targetId, order, picks, numRounds, league, memberIds);
        if (!result.ok) return json({ ok: false, reason: result.reason });
        return json({
          ok: true,
          pick: result.pick,
          draft_complete: result.complete,
          status_update_error: result.statusError,
          bot_skipped: true,
        });
      }

      const statusError = insertedComplete ? await finalizeDraft(admin, league, memberIds) : null;
      return json({
        ok: true,
        pick: insertedPick,
        price_source: priceSource,
        draft_complete: insertedComplete,
        status_update_error: statusError,
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
    const { data: symRow } = await admin
      .from('symbols').select('is_draftable').eq('symbol', symbol).maybeSingle();
    const isDraftable = symRow?.is_draftable === true;

    const rules: LeagueRules = {
      stakeMode: (league.stake_mode ?? null) as LeagueRules['stakeMode'],
      budgetAmount: league.budget_amount == null ? null : Number(league.budget_amount),
      notionalPerSlot: league.notional_per_slot == null ? null : Number(league.notional_per_slot),
      numRounds,
      allowUndraftable: league.allow_undraftable === true,
    };

    // Category eligibility is only consulted when this league defines
    // category-filtered slots — skip the three reads otherwise.
    const eligibleCategories = slots.some((s) => s.categoryId != null)
      ? await fetchEligibleCategoryIds(admin, symbol)
      : new Set<string>();

    const decision = validatePick({
      rules,
      slots,
      order,
      picks,
      trades,
      pickerId: targetId,
      symbol,
      price: fill.price,
      eligibleCategories,
      isDraftable,
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
        // draft_date omitted — see the SKIP insert note (DEFAULT now()).
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
    const statusError = complete ? await finalizeDraft(admin, league, memberIds) : null;
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

// Shared slot load + shape, used by both the human 'pick' path and 'bot_pick'
// (previously duplicated between them).
async function loadSlots(
  // deno-lint-ignore no-explicit-any
  admin: any,
  leagueId: string,
): Promise<{ slots: Slot[]; error: boolean }> {
  const { data: slotData, error: sErr } = await admin
    .from('league_draft_slots')
    .select('id, slot_index, slot_count, price_min, price_max, category_id')
    .eq('league_id', leagueId)
    .order('slot_index', { ascending: true });
  if (sErr) return { slots: [], error: true };
  const slots: Slot[] = (slotData ?? []).map((s: Record<string, unknown>) => ({
    id: String(s.id),
    slotIndex: Number(s.slot_index),
    slotCount: Number(s.slot_count),
    priceMin: s.price_min == null ? null : Number(s.price_min),
    priceMax: s.price_max == null ? null : Number(s.price_max),
    categoryId: s.category_id == null ? null : String(s.category_id),
  }));
  return { slots, error: false };
}

type SkipResult =
  // deno-lint-ignore no-explicit-any
  | { ok: true; pick: any; complete: boolean; statusError: string | null }
  | { ok: false; reason: string };

// Shared SKIP-row insert + finalize-on-completion, used by both the
// human-triggered 'skip' action and bot_pick's no-legal-candidate fallback
// (previously only the 'skip' branch had this logic).
async function insertSkip(
  // deno-lint-ignore no-explicit-any
  admin: any,
  leagueId: string,
  targetId: string,
  order: string[],
  picks: PickRow[],
  numRounds: number,
  // deno-lint-ignore no-explicit-any
  league: any,
  memberIds: string[],
): Promise<SkipResult> {
  const decision = validateSkip(targetId, order, picks.length, numRounds);
  if (!decision.legal) return { ok: false, reason: decision.reason };

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
      // draft_date omitted: column is timestamp WITHOUT time zone with
      // DEFAULT now() — an ISO string's Z suffix would be silently stripped,
      // so the server default is the correct writer.
    })
    .select('*')
    .single();
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') {
      return { ok: false, reason: 'pick_conflict' }; // race lost, client refetches + retries
    }
    return { ok: false, reason: 'unhandled' };
  }
  const complete = decision.pickNumber >= order.length * numRounds;
  const statusError = complete ? await finalizeDraft(admin, league, memberIds) : null;
  return { ok: true, pick: inserted, complete, statusError };
}

const FINALIZE_ATTEMPTS = 3;

// Plan the season and write it (plus the draft_status flip) in one RPC
// transaction. Returns an error string (surfaced to the caller as
// status_update_error) or null on success.
//
// Destructure-and-check per CLAUDE.md: .rpc() does NOT throw on a Postgres
// error, and a resolved call can still be a refusal — readFinalizeResult checks
// both. Transport/SQL errors are retried in-request (the RPC is idempotent, so
// a retry after a lost response reads 'already_finalized'); refusals are not,
// since the same inputs would be refused again — they need a human, and the
// stuck-draft detector in docs/STATUS.md §7 surfaces them.
async function finalizeDraft(
  // deno-lint-ignore no-explicit-any
  admin: any,
  // deno-lint-ignore no-explicit-any
  league: any,
  memberIds: string[],
): Promise<string | null> {
  const plan = planSeason({
    leagueType: String(league.league_type ?? 'duration'),
    commissionerId: league.commissioner_id == null ? null : String(league.commissioner_id),
    memberIds,
    numWeeks: league.num_weeks == null ? null : Number(league.num_weeks),
    durationDays: league.duration_days == null ? null : Number(league.duration_days),
    now: new Date(),
  });
  if (!plan.ok) {
    console.error('finalize: plan refused', league.id, plan.reason);
    return `schedule_plan_refused:${plan.reason}`;
  }

  const args = buildFinalizeArgs(String(league.id), plan);
  let lastError = 'finalize_rpc_error';
  for (let attempt = 1; attempt <= FINALIZE_ATTEMPTS; attempt++) {
    const { data, error } = await admin.rpc('finalize_league_draft', args);
    const outcome = readFinalizeResult({ data, error });
    if (outcome.ok) return null;
    // Log the SQL error server-side only; the client gets the stable code.
    console.error('finalize: attempt', attempt, league.id, outcome.error, error ? JSON.stringify(error) : '');
    lastError = outcome.error;
    if (!outcome.retryable) break;
    if (attempt < FINALIZE_ATTEMPTS) await new Promise((r) => setTimeout(r, 250 * attempt));
  }
  return lastError;
}
