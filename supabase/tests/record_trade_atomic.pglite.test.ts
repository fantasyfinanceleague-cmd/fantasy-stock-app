/**
 * record_trade_atomic against REAL Postgres (PGlite), driven by record-trade's
 * REAL write path: commit.ts's commitWithRetry + decideTrade, over the real
 * validator in _shared/draft-validation.ts. Only the reads differ from prod
 * (SQL here, paginated PostgREST there — pagination is covered hermetically
 * in supabase/functions/record-trade/commit.test.ts).
 * NOT hermetic: the first run fetches npm:@electric-sql/pglite.
 * Run instructions: supabase/tests/README.md.
 *
 * Loads VERBATIM: 20250118000000_create_trades (table + RLS), the
 * 20260810000000 quantity widening, 20261006000000 funded_by_trade_id (+ its
 * unique index), 20260811000002 (drops the client INSERT policy), and the
 * migrations under test, 20261102000000_record_trade_atomic and 20261103000000_trades_slot_id
 * (adds trades.slot_id, drops the 12-arg overload, adds p_slot_id). leagues /
 * league_members / drafts / league_draft_slots are replicas of the columns
 * the function reads. Supabase's default anon/authenticated EXECUTE grants
 * are simulated, so the proacl assertion proves the explicit REVOKEs work.
 *
 * THE RACES. Each scenario forces the losing interleaving deterministically:
 * request A and request B both read the ledger, A commits, then B submits
 * with its now-stale view. That is exactly the window the old code lost; the
 * test proves B's stale write never lands and B gets the right refusal.
 *
 * What this cannot show: two truly concurrent transactions blocking on the
 * advisory lock (PGlite has one connection). That guarantee rests on the
 * lock being taken BEFORE the CAS reads in a VOLATILE function under READ
 * COMMITTED (see the migration header); the 'structure' step pins both.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import {
  commitWithRetry,
  decideTrade,
  type DraftRow,
  type Expectation,
  type LeagueRow,
  type LedgerState,
  type SlotRow,
  type TradePlan,
  type TradeRequest,
} from '../functions/record-trade/commit.ts';
import type { TradeRow } from '../functions/_shared/draft-validation.ts';

const ROOT = new URL('../../', import.meta.url);
const BASE_MIGRATION = '20261102000000_record_trade_atomic.sql';
const MIGRATION_UNDER_TEST = '20261103000000_trades_slot_id.sql';
const MIGRATIONS = [
  '20250118000000_create_trades.sql',
  '20260810000000_widen_draft_trade_quantity_numeric.sql',
  '20261006000000_trades_funded_by_trade_id.sql',
  '20260811000002_trades_drop_direct_client_insert.sql',
  BASE_MIGRATION,
  MIGRATION_UNDER_TEST,
].map((f) => new URL(`supabase/migrations/${f}`, ROOT));
const SIG13 = 'uuid,uuid,text,text,numeric,numeric,numeric,uuid,uuid[],text[],jsonb,jsonb,uuid';
const SIG12 = 'uuid,uuid,text,text,numeric,numeric,numeric,uuid,uuid[],text[],jsonb,jsonb';

const SCHEMA = `
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
create table leagues (
  id uuid primary key default gen_random_uuid(), draft_status text default 'completed',
  stake_mode text, budget_amount numeric(12,2) not null default 100, notional_per_slot numeric not null default 1000,
  num_rounds int not null default 6, allow_undraftable boolean not null default false);
create table league_members (league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null, primary key (league_id, user_id));
create table drafts (id uuid primary key default gen_random_uuid(), league_id uuid not null references leagues(id),
  user_id text not null, symbol text not null, entry_price numeric not null, quantity integer not null,
  pick_number int, slot_id uuid, created_at timestamptz default now());
create table league_draft_slots (id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade, slot_index integer not null,
  slot_count integer not null default 1, price_min numeric, price_max numeric, category_id uuid,
  unique (league_id, slot_index));
`;

// deno-lint-ignore no-explicit-any
type Row = any;

Deno.test({
  name: 'record_trade_atomic on real Postgres (PGlite)',
  sanitizeResources: false,
  sanitizeOps: false,
  async fn(t) {
    const db = new PGlite();
    const q = async (s: string, p: unknown[] = []) => (await db.query(s, p)).rows as Row[];
    await db.exec(SCHEMA);
    for (const m of MIGRATIONS) await db.exec(await Deno.readTextFile(m));
    await db.exec(`grant all on all tables in schema public to service_role;`);

    // ---- fixtures ---------------------------------------------------------
    let userSeq = 0;
    async function user(): Promise<string> {
      const id = `00000000-0000-4000-8000-${String(++userSeq).padStart(12, '0')}`;
      await q(`insert into auth.users values ($1)`, [id]);
      return id;
    }
    async function league(cols: Record<string, unknown>, members: string[]): Promise<string> {
      const keys = Object.keys(cols);
      const [l] = await q(
        keys.length
          ? `insert into leagues (${keys.join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning id`
          : `insert into leagues default values returning id`,
        Object.values(cols),
      );
      for (const m of members) await q(`insert into league_members values ($1,$2)`, [l.id, m]);
      return l.id;
    }
    let pickSeq = 0;
    async function pick(L: string, u: string, symbol: string, price: number, qty = 1, slotId: string | null = null) {
      await q(`insert into drafts (league_id, user_id, symbol, entry_price, quantity, pick_number, slot_id)
        values ($1,$2,$3,$4,$5,$6,$7)`, [L, u, symbol, price, qty, ++pickSeq, slotId]);
    }
    async function slot(L: string, idx: number, min: number | null, max: number | null, count = 1): Promise<string> {
      const [s] = await q(`insert into league_draft_slots (league_id, slot_index, slot_count, price_min, price_max)
        values ($1,$2,$3,$4,$5) returning id`, [L, idx, count, min, max]);
      return s.id;
    }

    // ---- the prod write path, with SQL reads ------------------------------
    async function readState(L: string, withSlots: boolean): Promise<LedgerState> {
      const [league] = await q(`select draft_status, stake_mode, budget_amount, notional_per_slot, num_rounds,
        allow_undraftable from leagues where id=$1`, [L]);
      const picks = await q(`select id::text id, user_id, symbol, entry_price, quantity, pick_number, slot_id::text slot_id
        from drafts where league_id=$1 order by created_at, id`, [L]) as DraftRow[];
      const trades = (await q(`select id::text id, user_id::text user_id, symbol, action, quantity, price, total_value,
        created_at, funded_by_trade_id::text funded_by_trade_id, slot_id::text slot_id
        from trades where league_id=$1 order by created_at, id`, [L]))
        .map((r: Row) => ({ ...r, created_at: new Date(r.created_at).toISOString() })) as TradeRow[];
      const slots = withSlots
        ? await q(`select id::text id, slot_index, slot_count, price_min, price_max, category_id::text category_id
            from league_draft_slots where league_id=$1 order by slot_index`, [L]) as SlotRow[]
        : null;
      return { league: league as LeagueRow, picks, trades, slots, eligibleCategories: new Set() };
    }
    async function rpc(L: string, req: TradeRequest, plan: TradePlan, e: Expectation): Promise<Row> {
      const [r] = await q(
        `select record_trade_atomic($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],$10::text[],$11::jsonb,$12::jsonb,$13::uuid) r`,
        [L, req.userId, req.symbol, req.action, plan.quantity, req.price,
          Math.round(req.price * plan.quantity * 100) / 100, plan.fundedByTradeId,
          e.seenTradeIds, e.seenDraftIds,
          e.rules == null ? null : JSON.stringify(e.rules), e.slots == null ? null : JSON.stringify(e.slots),
          plan.slotId ?? null],
      );
      return r.r;
    }
    function trade(L: string, req: TradeRequest, firstState?: LedgerState) {
      return commitWithRetry({
        readState: async () => ({ ok: true, value: await readState(L, req.action === 'buy') }),
        decide: (s) => decideTrade(req, s),
        marketRecheck: () => null,
        commit: async (plan, e) => {
          try {
            return { data: await rpc(L, req, plan, e), error: null };
          } catch (err) {
            return { data: null, error: { code: (err as Row).code, message: String((err as Row).message) } };
          }
        },
      }, { firstState });
    }
    /** A and B both read, A commits, B submits its stale view. */
    async function race(L: string, a: TradeRequest, b: TradeRequest) {
      const sA = await readState(L, a.action === 'buy');
      const sB = await readState(L, b.action === 'buy');
      const ra = await trade(L, a, sA);
      const rb = await trade(L, b, sB);
      return { ra, rb };
    }
    const tradeCount = async (L: string) => (await q(`select count(*)::int n from trades where league_id=$1`, [L]))[0].n;
    const netQty = async (L: string, u: string, sym: string) =>
      Number((await q(`select coalesce((select sum(quantity) from drafts where league_id=$1 and user_id=$2 and symbol=$3),0)
        + coalesce((select sum(case when action='buy' then quantity else -quantity end) from trades
                    where league_id=$1 and user_id=$2::uuid and symbol=$3),0) n`, [L, u, sym]))[0].n);
    const sell = (userId: string, symbol: string, price = 100): TradeRequest =>
      ({ action: 'sell', userId, symbol, price, isDraftable: true });
    const buy = (userId: string, symbol: string, price = 100, soldTradeId?: string): TradeRequest =>
      ({ action: 'buy', userId, symbol, price, isDraftable: true, soldTradeId });
    const refused = (reason: string) => ({ status: 200, body: { ok: false, reason } });

    // ---- grants / structure ------------------------------------------------
    await t.step('signature: exactly ONE record_trade_atomic (13 args); the 12-arg overload is DROPPED', async () => {
      const rows = await q(`select pronargs from pg_proc where proname='record_trade_atomic'`);
      assertEquals(rows.map((r: Row) => r.pronargs), [13]);
      const [{ old }] = await q(`select to_regprocedure('record_trade_atomic(${SIG12})') is not null old`);
      assertEquals(old, false);
    });

    await t.step('grants: INVOKER, VOLATILE, service_role only, search_path pinned', async () => {
      const [r] = await q(`select proacl::text a, prosecdef d, provolatile v, proconfig::text c
        from pg_proc where proname='record_trade_atomic'`);
      assertEquals(r.d, false);
      assertEquals(r.v, 'v');
      assert(!/anon=|authenticated=/.test(r.a), r.a);
      assert(!/(^|[{,])=X/.test(r.a), `PUBLIC still has EXECUTE: ${r.a}`);
      assert(/service_role=X/.test(r.a), r.a);
      assert(r.c.includes('search_path=public, pg_temp'), r.c);
      assert(r.c.includes('lock_timeout=5s'), r.c);
    });

    await t.step('structure: the advisory lock is taken BEFORE the first table read', async () => {
      const [{ src }] = await q(`select prosrc src from pg_proc where proname='record_trade_atomic'`);
      const body = (src as string).toLowerCase().replace(/--[^\n]*/g, '');
      const lock = body.indexOf('pg_advisory_xact_lock(');
      assert(lock > 0, 'no pg_advisory_xact_lock in the function body');
      for (const read of ['from leagues', 'from league_members', 'from trades', 'from drafts', 'from league_draft_slots']) {
        const at = body.indexOf(read);
        assert(at > lock, `${read} at ${at} is not after the lock at ${lock}`);
      }
      assert(body.includes(`hashtextextended('record-trade:' || p_league_id::text, 0)`), 'lock key changed');
    });

    await t.step('anon cannot execute; a LEAKED authenticated grant still cannot insert (INVOKER + trades RLS)', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'budget_cap', budget_amount: 1000, num_rounds: 3 }, [A]);
      const s = await readState(L, true);
      await db.exec(`set role anon`);
      await assertRejects(() => rpc(L, buy(A, 'MSFT'), { quantity: 1, fundedByTradeId: null, slotId: null }, expect(s)), Error, 'permission denied');
      await db.exec(`reset role`);
      await db.exec(`grant execute on function record_trade_atomic(${SIG13}) to authenticated`);
      await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${A}', false);`);
      await assertRejects(() => rpc(L, buy(A, 'MSFT'), { quantity: 1, fundedByTradeId: null, slotId: null }, expect(s)), Error, 'row-level security');
      await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`);
      await db.exec(`revoke execute on function record_trade_atomic(${SIG13}) from authenticated`);
      assertEquals(await tradeCount(L), 0);
    });

    // ---- the five races ------------------------------------------------------
    await t.step('race 1: double SELL -> one sell commits, the loser gets not_owned, net position 0 (not -1)', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'budget_cap', budget_amount: 1000, num_rounds: 3 }, [A]);
      await pick(L, A, 'AAPL', 100);
      const { ra, rb } = await race(L, sell(A, 'AAPL'), sell(A, 'AAPL'));
      assertEquals(ra.body.ok, true);
      assertEquals(rb, refused('not_owned'));
      assertEquals(await tradeCount(L), 1);
      assertEquals(await netQty(L, A, 'AAPL'), 0);
    });

    await t.step('race 2a: double budget_cap BUY of one symbol -> one share, the loser gets symbol_owned', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'budget_cap', budget_amount: 1000, num_rounds: 3 }, [A]);
      await pick(L, A, 'AAPL', 100);
      const { ra, rb } = await race(L, buy(A, 'MSFT'), buy(A, 'MSFT'));
      assertEquals(ra.body.ok, true);
      assertEquals(rb, refused('symbol_owned'));
      assertEquals(await netQty(L, A, 'MSFT'), 1);
    });

    await t.step('race 2b: two budget_cap BUYs that each fit alone -> no overspend, the loser gets over_budget', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'budget_cap', budget_amount: 250, num_rounds: 4 }, [A]);
      await pick(L, A, 'AAPL', 100); // 150 left: room for one $100 buy, not two
      const { ra, rb } = await race(L, buy(A, 'MSFT'), buy(A, 'GOOG'));
      assertEquals(ra.body.ok, true);
      assertEquals(rb, refused('over_budget'));
      assertEquals(await tradeCount(L), 1);
    });

    // race 3 is about the tier MODE's one-share fills and roster cap. (Two
    // different symbols racing into one free tier SLOT is race 3c below:
    // before 20261103000000 the validator counted slot occupancy from drafts
    // only, so a second buy into a filled tier was legal even SEQUENTIALLY —
    // that gap is closed, see the 'tier slots' steps.)
    await t.step('race 3a: double price_tiers BUY of one symbol -> one share, the loser gets symbol_owned', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'price_tiers', num_rounds: 3 }, [A]);
      await slot(L, 0, 0, 200, 2);
      const { ra, rb } = await race(L, buy(A, 'MSFT', 100), buy(A, 'MSFT', 100));
      assertEquals(ra.body.ok, true);
      assertEquals(rb, refused('symbol_owned'));
      assertEquals(await netQty(L, A, 'MSFT'), 1);
    });

    await t.step('race 3b: two price_tiers BUYs for the LAST roster spot -> the loser gets roster_full', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'price_tiers', num_rounds: 2 }, [A]);
      const lo = await slot(L, 0, 0, 200, 2);
      await pick(L, A, 'NVDA', 150, 1, lo); // 1 of 2 roster spots used
      const { ra, rb } = await race(L, buy(A, 'MSFT', 100), buy(A, 'GOOG', 150));
      assertEquals(ra.body.ok, true);
      assertEquals(rb, refused('roster_full'));
      assertEquals(await tradeCount(L), 1);
    });

    await t.step('race 4: two USERS buy the same symbol -> one owner; the other gets symbol_owned', async () => {
      const A = await user();
      const B = await user();
      const L = await league({ stake_mode: 'budget_cap', budget_amount: 1000, num_rounds: 3 }, [A, B]);
      const { ra, rb } = await race(L, buy(A, 'TSLA'), buy(B, 'TSLA'));
      assertEquals(ra.body.ok, true);
      assertEquals(rb, refused('symbol_owned'));
      const [{ n }] = await q(`select count(distinct user_id)::int n from trades where league_id=$1 and symbol='TSLA'`, [L]);
      assertEquals(n, 1);
    });

    await t.step('race 5: two fixed_notional BUYs into ONE skipped slot (no funded_by id) -> the loser gets no_proceeds', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'fixed_notional', notional_per_slot: 1000, num_rounds: 3 }, [A]);
      await pick(L, A, 'AAPL', 100, 10);
      await pick(L, A, 'SKIP', 0, 0);
      const { ra, rb } = await race(L, buy(A, 'MSFT', 100), buy(A, 'GOOG', 50));
      assertEquals(ra.body.ok, true);
      assertEquals((ra.body.trade as Row).funded_by_trade_id, null); // the skipped slot, not proceeds
      assertEquals(rb, refused('no_proceeds'));
      assertEquals(await tradeCount(L), 1);
    });

    await t.step('race 5b: two buys reinvesting the SAME named sale -> the loser gets proceeds_unavailable', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'fixed_notional', notional_per_slot: 1000, num_rounds: 3 }, [A]);
      await pick(L, A, 'AAPL', 100, 10);
      const sold = await trade(L, sell(A, 'AAPL', 90));
      const saleId = (sold.body.trade as Row).id as string;
      const { ra, rb } = await race(L, buy(A, 'MSFT', 100, saleId), buy(A, 'GOOG', 50, saleId));
      assertEquals(ra.body.ok, true);
      assertEquals(rb, refused('proceeds_unavailable'));
      assertEquals(await tradeCount(L), 2);
    });

    await t.step('trade_conflict means NOTHING WAS TRADED: 3 consecutive ledger_changed write no trade and no funded_by row', async () => {
      // A funded fixed_notional buy whose league keeps moving: a neighbour
      // commits a trade between EVERY read and its RPC, so all MAX_ATTEMPTS
      // attempts see ledger_changed. The client copy for trade_conflict
      // (owned by the 3e worker) will say "Nothing was traded" — this pins
      // that the server claim behind it is true.
      const A = await user();
      const B = await user();
      const L = await league({ stake_mode: 'fixed_notional', notional_per_slot: 1000, num_rounds: 3 }, [A, B]);
      await pick(L, A, 'AAPL', 100, 10);
      const sold = await trade(L, sell(A, 'AAPL', 90));
      const saleId = (sold.body.trade as Row).id as string;
      const rowsBefore = await q(`select id::text id from trades where league_id=$1 order by id`, [L]);

      const req = buy(A, 'MSFT', 100, saleId);
      const plans: TradePlan[] = [];
      const results: Row[] = [];
      let neighbour = 0;
      const r = await commitWithRetry({
        readState: async () => ({ ok: true, value: await readState(L, true) }),
        decide: (st) => decideTrade(req, st),
        marketRecheck: () => null,
        commit: async (plan, e) => {
          plans.push(plan);
          await q(`insert into trades (league_id,user_id,symbol,action,quantity,price,total_value)
            values ($1,$2,$3,'buy',1,1,1)`, [L, B, `N${++neighbour}`]);
          const res = await rpc(L, req, plan, e);
          results.push(res);
          return { data: res, error: null };
        },
      }, { firstState: await readState(L, true) });

      assertEquals(r, refused('trade_conflict'));
      assertEquals(results, Array(3).fill({ ok: false, reason: 'ledger_changed', changed: 'trades' }));
      // every attempt really was a FUNDED buy of this sale ...
      assertEquals(plans.map((p) => p.fundedByTradeId), [saleId, saleId, saleId]);
      // ... and none of them wrote anything: the only new rows are the neighbour's
      const after = await q(`select id::text id, user_id::text u, symbol from trades where league_id=$1`, [L]);
      assertEquals(after.length, rowsBefore.length + 3);
      assertEquals(after.filter((x: Row) => x.u === A).length, 1); // just the original sell
      assertEquals(after.filter((x: Row) => x.symbol === 'MSFT').length, 0);
      const [{ n, m }] = await q(`select
          (select count(*)::int from trades where league_id=$1 and funded_by_trade_id is not null) n,
          (select count(*)::int from trades where funded_by_trade_id = $2::uuid) m`, [L, saleId]);
      assertEquals([n, m], [0, 0]); // no funded row in this league, and the sale is claimed nowhere
    });


    // ---- tier slots (20261103000000 + the validator's per-position occupancy) -
    const TIER = async (extra: Record<string, unknown> = {}) => {
      const A = await user();
      const L = await league({ stake_mode: 'price_tiers', num_rounds: 4, ...extra }, [A]);
      const lo = await slot(L, 0, 0, 200);
      const hi = await slot(L, 1, 200, null);
      return { A, L, lo, hi };
    };
    const slotOf = async (id: string) => (await q(`select slot_id::text s from trades where id=$1`, [id]))[0].s;

    await t.step('tier slots: THE REPRO end to end — NVDA in hi, MSFT $100 fills lo, GOOG $150 is REFUSED (no_eligible_slot, open_slots [])', async () => {
      const { A, L, lo, hi } = await TIER();
      await pick(L, A, 'NVDA', 900, 1, hi);
      const m = await trade(L, buy(A, 'MSFT', 100));
      assertEquals(m.body.ok, true);
      assertEquals(await slotOf((m.body.trade as Row).id), lo, 'the buy recorded the slot it filled');
      assertEquals((m.body.slot as Row).slot_id, lo);
      const g = await trade(L, buy(A, 'GOOG', 150));
      assertEquals(g, { status: 200, body: { ok: false, reason: 'no_eligible_slot', price: 150, open_slots: [] } });
      assertEquals(await tradeCount(L), 1);
    });

    await t.step('tier slots: sell then a buy that fits the freed tier → legal, takes that slot; open_slots names what is open', async () => {
      const { A, L, lo, hi } = await TIER();
      await pick(L, A, 'NVDA', 900, 1, hi);
      await pick(L, A, 'CHEAP', 20, 1, lo);
      // lo and hi both held: a buy is refused with an EMPTY open list
      assertEquals(((await trade(L, buy(A, 'GOOG', 150))).body as Row).open_slots, []);
      assertEquals((await trade(L, sell(A, 'CHEAP', 25))).body.ok, true);
      // now ONLY lo is open: a hi-priced buy is refused and the refusal names lo's range
      const refusal = (await trade(L, buy(A, 'BRK', 450))).body as Row;
      assertEquals(refusal.reason, 'no_eligible_slot');
      assertEquals(refusal.open_slots.map((o: Row) => [o.slot_id, Number(o.price_min), o.price_max]), [[lo, 0, 200]]);
      const ok = await trade(L, buy(A, 'GOOG', 150));
      assertEquals(ok.body.ok, true);
      assertEquals(await slotOf((ok.body.trade as Row).id), lo);
    });

    await t.step('tier slots: draft NVDA, sell, buy NVDA back at a lo price → counts lo once; hi is free again', async () => {
      const { A, L, lo, hi } = await TIER();
      await pick(L, A, 'NVDA', 900, 1, hi);
      assertEquals((await trade(L, sell(A, 'NVDA', 880))).body.ok, true);
      const back = await trade(L, buy(A, 'NVDA', 150));
      assertEquals(await slotOf((back.body.trade as Row).id), lo);
      const brk = await trade(L, buy(A, 'BRK', 450));
      assertEquals(brk.body.ok, true, JSON.stringify(brk.body));
      assertEquals(await slotOf((brk.body.trade as Row).id), hi);
    });

    await t.step('race 3c: two DIFFERENT symbols into ONE free tier slot → the loser re-validates and gets no_eligible_slot', async () => {
      const { A, L } = await TIER();
      const { ra, rb } = await race(L, buy(A, 'MSFT', 100), buy(A, 'GOOG', 150));
      assertEquals(ra.body.ok, true);
      assertEquals((rb.body as Row).reason, 'no_eligible_slot');
      assertEquals(await tradeCount(L), 1);
    });

    await t.step('tier slots: a LEGACY (slot_id NULL, pre-fix) trade buy occupies its derived tier; selling it reopens', async () => {
      const { A, L } = await TIER();
      await q(`insert into trades (league_id,user_id,symbol,action,quantity,price,total_value) values ($1,$2,'OLD','buy',1,100,100)`, [L, A]);
      assertEquals(((await trade(L, buy(A, 'GOOG', 150))).body as Row).reason, 'no_eligible_slot');
      assertEquals((await trade(L, sell(A, 'OLD', 105))).body.ok, true);
      assertEquals((await trade(L, buy(A, 'GOOG', 150))).body.ok, true);
    });

    await t.step('tier slots: a manager already holding TWO stocks in one tier (the bug\'s legacy) is never stranded', async () => {
      const { A, L } = await TIER();
      for (const [sym, px] of [['MSFT', 100], ['GOOG', 150]] as const) {
        await q(`insert into trades (league_id,user_id,symbol,action,quantity,price,total_value) values ($1,$2,$3,'buy',1,$4,$4)`, [L, A, sym, px]);
      }
      assertEquals(((await trade(L, buy(A, 'IBM', 120))).body as Row).reason, 'no_eligible_slot');
      assertEquals((await trade(L, sell(A, 'MSFT', 110))).body.ok, true);          // sells always work
      assertEquals(((await trade(L, buy(A, 'IBM', 120))).body as Row).reason, 'no_eligible_slot'); // GOOG still holds lo
      assertEquals((await trade(L, sell(A, 'GOOG', 160))).body.ok, true);
      assertEquals((await trade(L, buy(A, 'IBM', 120))).body.ok, true);              // back to one: reopened
    });

    await t.step('slot guards: a slot on a SELL, a foreign slot, and a slot-less BUY in a slotted league are all bad_request (and write nothing)', async () => {
      const { A, L, lo } = await TIER();
      const other = await league({ stake_mode: 'price_tiers', num_rounds: 4 }, [A]);
      const foreign = await slot(other, 0, 0, null);
      await pick(L, A, 'AAPL', 100, 1, lo);
      const sellState = expect(await readState(L, false));
      const buyState = expect(await readState(L, true));
      const sellPlan = { quantity: 1, fundedByTradeId: null };
      assertEquals(await rpc(L, sell(A, 'AAPL'), { ...sellPlan, slotId: lo }, sellState), { ok: false, reason: 'bad_request' });
      assertEquals(await rpc(L, buy(A, 'MSFT'), { ...sellPlan, slotId: foreign }, buyState), { ok: false, reason: 'bad_request' });
      assertEquals(await rpc(L, buy(A, 'MSFT'), { ...sellPlan, slotId: crypto.randomUUID() }, buyState), { ok: false, reason: 'bad_request' });
      assertEquals(await rpc(L, buy(A, 'MSFT'), { ...sellPlan, slotId: null }, buyState), { ok: false, reason: 'bad_request' });
      assertEquals(await tradeCount(L), 0);
      // a slot-less league needs none, and refuses one
      const plain = await league({ stake_mode: 'budget_cap', budget_amount: 1000, num_rounds: 3 }, [A]);
      const ps = expect(await readState(plain, true));
      assertEquals(await rpc(plain, buy(A, 'MSFT'), { ...sellPlan, slotId: foreign }, ps), { ok: false, reason: 'bad_request' });
      assertEquals((await rpc(plain, buy(A, 'MSFT'), { ...sellPlan, slotId: null }, ps)).ok, true);
    });

    await t.step('slot guards run AFTER the CAS: a slot edited since the read is ledger_changed (retry), not bad_request', async () => {
      const { A, L, lo } = await TIER();
      const stale = expect(await readState(L, true));
      await q(`delete from league_draft_slots where id=$1`, [lo]); // commissioner edit mid-flight
      assertEquals(await rpc(L, buy(A, 'MSFT'), { quantity: 1, fundedByTradeId: null, slotId: lo }, stale),
        { ok: false, reason: 'ledger_changed', changed: 'slots' });
    });

    await t.step('a slot deleted BETWEEN the guard reads and the INSERT -> FK 23503 is mapped to ledger_changed (not a 500); nothing written', async () => {
      const { A, L, lo } = await TIER();
      const s = expect(await readState(L, true));
      // Simulates the commissioner's lock-free DELETE landing in the window: a
      // test-only trigger removes the slot after the guards pass and before the
      // FK is checked (FKs are checked at end of statement).
      await db.exec(`
        create function pg_temp.kill_slot() returns trigger language plpgsql as
          $f$ begin delete from league_draft_slots where id = new.slot_id; return new; end $f$;
        create trigger kill_slot before insert on trades for each row execute function pg_temp.kill_slot();`);
      try {
        assertEquals(await rpc(L, buy(A, 'MSFT'), { quantity: 1, fundedByTradeId: null, slotId: lo }, s),
          { ok: false, reason: 'ledger_changed', changed: 'slots' });
      } finally {
        await db.exec(`drop trigger kill_slot on trades; drop function pg_temp.kill_slot();`);
      }
      assertEquals(await tradeCount(L), 0);
    });

    await t.step('table: slot_id is buy-only (CHECK) and a deleted slot is SET NULL, not a cascade', async () => {
      const { A, L, lo } = await TIER();
      await assertRejects(
        () => q(`insert into trades (league_id,user_id,symbol,action,quantity,price,total_value,slot_id)
                 values ($1,$2,'X','sell',1,1,1,$3)`, [L, A, lo]),
        Error, 'trades_slot_id_buy_only');
      const r = await trade(L, buy(A, 'MSFT', 100));
      const id = (r.body.trade as Row).id as string;
      assertEquals(await slotOf(id), lo);
      await q(`delete from league_draft_slots where id=$1`, [lo]);
      assertEquals(await slotOf(id), null);
      assertEquals(await tradeCount(L), 1, 'the trade survives its slot');
    });

    // ---- what the CAS compares ---------------------------------------------
    function expect(s: LedgerState): Expectation {
      return {
        seenTradeIds: s.trades.map((x) => String(x.id)),
        seenDraftIds: s.picks.map((x) => x.id),
        rules: s.slots == null ? null : {
          stake_mode: s.league.stake_mode, budget_amount: s.league.budget_amount,
          notional_per_slot: s.league.notional_per_slot, num_rounds: s.league.num_rounds,
          allow_undraftable: s.league.allow_undraftable,
        },
        slots: s.slots,
      };
    }
    const plan1: TradePlan = { quantity: 1, fundedByTradeId: null, slotId: null };

    await t.step('CAS: each league-scoped input that moves is ledger_changed, names what moved, writes nothing', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'price_tiers', budget_amount: 1000, num_rounds: 4 }, [A]);
      await slot(L, 0, 0, null, 3);
      await pick(L, A, 'AAPL', 100);
      await pick(L, A, 'IBM', 100);
      const fresh = async () => expect(await readState(L, true));

      let e = await fresh();
      await q(`insert into trades (league_id,user_id,symbol,action,quantity,price,total_value) values ($1,$2,'X','buy',1,1,1)`, [L, A]);
      assertEquals(await rpc(L, buy(A, 'MSFT'), plan1, e), { ok: false, reason: 'ledger_changed', changed: 'trades' });

      e = await fresh();
      await q(`delete from drafts where league_id=$1 and symbol='IBM'`, [L]); // the commissioner's post-draft DELETE
      assertEquals(await rpc(L, buy(A, 'MSFT'), plan1, e), { ok: false, reason: 'ledger_changed', changed: 'drafts' });

      for (const edit of [`budget_amount = 999`, `num_rounds = 9`, `stake_mode = 'budget_cap'`, `allow_undraftable = true`, `notional_per_slot = 5`]) {
        e = await fresh();
        await q(`update leagues set ${edit} where id=$1`, [L]);
        assertEquals(await rpc(L, buy(A, 'MSFT'), plan1, e), { ok: false, reason: 'ledger_changed', changed: 'rules' }, edit);
      }

      e = await fresh();
      await q(`update league_draft_slots set price_max = 50 where league_id=$1`, [L]);
      assertEquals(await rpc(L, buy(A, 'MSFT'), plan1, e), { ok: false, reason: 'ledger_changed', changed: 'slots' });
      e = await fresh();
      await slot(L, 1, 0, null);
      assertEquals(await rpc(L, buy(A, 'MSFT'), plan1, e), { ok: false, reason: 'ledger_changed', changed: 'slots' });

      assertEquals(await tradeCount(L), 1); // only the direct insert above
    });

    await t.step('CAS: exact set — a missing, an extra, or a duplicated seen id is ledger_changed', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'budget_cap', budget_amount: 1000, num_rounds: 4 }, [A]);
      await pick(L, A, 'AAPL', 100);
      await trade(L, buy(A, 'MSFT'));
      await trade(L, buy(A, 'GOOG'));
      const e = expect(await readState(L, true));
      const [t1, t2] = e.seenTradeIds;
      for (const ids of [[t1], [t1, t2, crypto.randomUUID()], [t1, t1], [t1, t1, t2], [t2, crypto.randomUUID()]]) {
        assertEquals(await rpc(L, buy(A, 'TSLA'), plan1, { ...e, seenTradeIds: ids }),
          { ok: false, reason: 'ledger_changed', changed: 'trades' }, JSON.stringify(ids));
      }
      // a NULL element is refused outright (it would make membership tests NULL -> fail-open)
      assertEquals(await rpc(L, buy(A, 'TSLA'), plan1, { ...e, seenTradeIds: [t1, t2, null as unknown as string] }),
        { ok: false, reason: 'bad_request' });
      assertEquals(await rpc(L, buy(A, 'TSLA'), plan1, { ...e, seenDraftIds: [...e.seenDraftIds, null as unknown as string] }),
        { ok: false, reason: 'bad_request' });
      // order is irrelevant
      assertEquals((await rpc(L, buy(A, 'TSLA'), plan1, { ...e, seenTradeIds: [t2, t1] })).ok, true);
    });

    await t.step('CAS: numerics compare by VALUE (10.5 vs "10.50", 1000 vs "1000.00") — no spurious conflict', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'price_tiers', budget_amount: 1000, num_rounds: 4 }, [A]);
      await q(`insert into league_draft_slots (league_id, slot_index, price_min, price_max) values ($1, 0, 10.50, 2000.00)`, [L]);
      const e = expect(await readState(L, true));
      const reformatted: Expectation = {
        ...e,
        rules: { ...e.rules!, budget_amount: 1000, notional_per_slot: 1000.0 },
        slots: e.slots!.map((s) => ({ ...s, price_min: 10.5, price_max: '2000' })),
      };
      assertEquals((await rpc(L, buy(A, 'MSFT'), { ...plan1, slotId: e.slots![0].id }, reformatted)).ok, true);
    });

    await t.step('scope: a SELL is not refused by a rules/slots edit it never read', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'price_tiers', budget_amount: 1000, num_rounds: 4 }, [A]);
      await slot(L, 0, 0, null, 3);
      await pick(L, A, 'AAPL', 100);
      const s = await readState(L, false);
      await q(`update leagues set budget_amount = 1 where id=$1`, [L]);
      await q(`update league_draft_slots set price_max = 1 where league_id=$1`, [L]);
      const r = await trade(L, sell(A, 'AAPL'), s);
      assertEquals(r.body.ok, true);
    });

    await t.step('a rules edit mid-flight: the buy re-validates under the NEW rules (over_budget), not the old', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'budget_cap', budget_amount: 1000, num_rounds: 4 }, [A]);
      await pick(L, A, 'AAPL', 100);
      const s = await readState(L, true);
      await q(`update leagues set budget_amount = 150 where id=$1`, [L]);
      assertEquals(await trade(L, buy(A, 'MSFT'), s), refused('over_budget'));
      assertEquals(await tradeCount(L), 0);
    });

    await t.step("transport shapes: jsonb 'null' for rules/slots means NOT GIVEN (a sell still commits)", async () => {
      const A = await user();
      const L = await league({ stake_mode: 'budget_cap', budget_amount: 1000, num_rounds: 4 }, [A]);
      await pick(L, A, 'AAPL', 100);
      const e = expect(await readState(L, false));
      const [{ r }] = await q(
        `select record_trade_atomic($1,$2,'AAPL','sell',1,100,100,null,$3::uuid[],$4::text[],'null'::jsonb,'null'::jsonb) r`,
        [L, A, e.seenTradeIds, e.seenDraftIds],
      );
      assertEquals(r.ok, true, JSON.stringify(r));
    });

    await t.step('isolation: refuses to run under REPEATABLE READ (the CAS would read a pre-lock snapshot)', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'budget_cap', budget_amount: 1000, num_rounds: 4 }, [A]);
      const e = expect(await readState(L, true));
      await db.exec('begin isolation level repeatable read');
      await assertRejects(() => rpc(L, buy(A, 'MSFT'), plan1, e), Error, 'requires READ COMMITTED');
      await db.exec('rollback');
      assertEquals(await tradeCount(L), 0);
      assertEquals((await rpc(L, buy(A, 'MSFT'), plan1, e)).ok, true); // READ COMMITTED (default) works
    });

    // ---- refusals ------------------------------------------------------------
    await t.step('refusals write nothing: draft_not_completed, not_a_member, league_not_found, bad_request', async () => {
      const A = await user();
      const B = await user();
      const L = await league({ stake_mode: 'budget_cap', budget_amount: 1000, num_rounds: 4 }, [A]);
      const e = expect(await readState(L, true));
      assertEquals(await rpc(L, buy(B, 'MSFT'), plan1, e), { ok: false, reason: 'not_a_member' });
      assertEquals(await rpc(crypto.randomUUID(), buy(A, 'MSFT'), plan1, e), { ok: false, reason: 'league_not_found' });
      assertEquals(await rpc(L, buy(A, 'MSFT'), plan1, { ...e, rules: { stake_mode: 'budget_cap' } }), { ok: false, reason: 'bad_request' });
      assertEquals(await rpc(L, buy(A, 'MSFT'), plan1, { ...e, slots: [{ id: 'x' } as SlotRow] }), { ok: false, reason: 'bad_request' });
      const [{ r }] = await q(`select record_trade_atomic($1,$2,'MSFT','buy',1,1,1,null,null,'{}',null,null) r`, [L, A]);
      assertEquals(r, { ok: false, reason: 'bad_request' });
      await q(`update leagues set draft_status = 'in_progress' where id=$1`, [L]);
      assertEquals(await rpc(L, buy(A, 'MSFT'), plan1, e), { ok: false, reason: 'draft_not_completed' });
      assertEquals(await tradeCount(L), 0);
    });

    await t.step('the funded unique index is mapped INSIDE the RPC (by name) to proceeds_unavailable', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'fixed_notional', notional_per_slot: 1000, num_rounds: 3 }, [A]);
      await pick(L, A, 'AAPL', 100, 10);
      const sold = await trade(L, sell(A, 'AAPL', 90));
      const saleId = (sold.body.trade as Row).id as string;
      // A row in ANOTHER league claiming the same sale (only reachable by a
      // bypass of the TS walk): the CAS on L passes, the index fires.
      const L2 = await league({}, [A]);
      await q(`insert into trades (league_id,user_id,symbol,action,quantity,price,total_value,funded_by_trade_id)
        values ($1,$2,'ZZ','buy',1,1,1,$3)`, [L2, A, saleId]);
      const e = expect(await readState(L, true));
      assertEquals(await rpc(L, buy(A, 'MSFT'), { quantity: 9, fundedByTradeId: saleId, slotId: null }, e),
        { ok: false, reason: 'proceeds_unavailable' });
      // any OTHER constraint still raises (-> rpc { error } -> 500 in record-trade)
      await assertRejects(() => rpc(L, buy(A, 'MSFT'), { quantity: -1, fundedByTradeId: null, slotId: null }, e), Error, 'check constraint');
    });

    // ---- the HUMAN ACTION effect checks, run verbatim ------------------------
    const extractDo = (src: string, label: string) => {
      const from = src.indexOf('--   DO $$');
      const to = src.indexOf('--   END $$;') + '--   END $$;'.length;
      assert(from > 0 && to > from, `effect-check DO block not found in ${label}`);
      return src.slice(from, to).split('\n').map((l) => l.replace(/^--   ?/, '')).join('\n');
    };
    const baseSrc = await Deno.readTextFile(MIGRATIONS[MIGRATIONS.length - 2]);
    const migSrc = await Deno.readTextFile(MIGRATIONS[MIGRATIONS.length - 1]);
    const baseBlock = extractDo(baseSrc, BASE_MIGRATION);
    const slotBlock = extractDo(migSrc, MIGRATION_UNDER_TEST);
    const verdictOf = async (block: string) => {
      try {
        await db.exec(block);
        return 'NO RAISE';
      } catch (e) {
        return String((e as Error).message);
      }
    };
    const allTrades = async () => (await q(`select count(*)::int n from trades`))[0].n;

    await t.step('effect check #113 (HUMAN ACTION DO block, still valid against the 13-arg function): PASS, FAIL on a neutered CAS, rolls back', async () => {
      // Fixture: a 'bot-*' member sorts first and must be skipped.
      const A = await user();
      const L = await league({ stake_mode: 'budget_cap', budget_amount: 1000, num_rounds: 4 }, ['bot-1', A]);
      await trade(L, buy(A, 'MSFT'));
      const before = await allTrades();

      const pass = await verdictOf(baseBlock);
      assert(pass.startsWith('RECORD_TRADE_ATOMIC EFFECT TEST: PASS'), pass);
      assertEquals(await allTrades(), before);

      const neutered = migSrc.replace(
        /  if v_n <> cardinality\(p_seen_trade_ids\) or v_seen <> v_n then/,
        '  if false then',
      );
      assert(neutered !== migSrc, 'mutation did not apply');
      await db.exec(neutered);
      const fail = await verdictOf(baseBlock);
      assert(fail.startsWith('RECORD_TRADE_ATOMIC EFFECT TEST: FAIL'), fail);
      assertEquals(await allTrades(), before); // the RAISE rolled the stray insert back

      await db.exec(migSrc); // restore the real function
      assert((await verdictOf(baseBlock)).includes(': PASS'));
    });

    await t.step('effect check #slots (HUMAN ACTION DO block): PASS, PARTIAL (never PASS) when no slotted league, FAIL on each break, always rolls back', async () => {
      const before = await allTrades();
      const pass = await verdictOf(slotBlock);
      assert(pass.startsWith('TIER_TRADE_SLOTS EFFECT TEST: PASS'), pass);
      assert(!pass.includes('NOT exercised'), `a completed slotted league exists, the league guards must run: ${pass}`);
      assertEquals(await allTrades(), before);

      // no completed slotted league -> PASS but SAYS the league guards were not exercised
      await db.exec(`begin; update leagues set draft_status = 'in_progress';`);
      const note = await verdictOf(slotBlock);
      await db.exec('rollback');
      assert(note.startsWith('TIER_TRADE_SLOTS EFFECT TEST: PARTIAL') && note.includes('NOT exercised'), note);
      assert(!note.includes(': PASS'), `a partial run must never read as PASS: ${note}`);

      // each break must turn the verdict to FAIL
      const breaks: Array<[string, () => Promise<void>, () => Promise<void>]> = [
        ['the slot-less-buy guard removed',
          async () => {
            const m = migSrc.replace(/  if p_action = 'buy' and p_slot_id is null and exists \(/, "  if false and exists (");
            assert(m !== migSrc, 'mutation did not apply'); await db.exec(m);
          }, async () => { await db.exec(migSrc); }],
        ['the foreign-slot guard removed',
          async () => {
            const m = migSrc.replace(/  if p_slot_id is not null and not exists \(/, '  if false and not exists (');
            assert(m !== migSrc, 'mutation did not apply'); await db.exec(m);
          }, async () => { await db.exec(migSrc); }],
        ['the slot-on-sell guard removed',
          async () => {
            const m = migSrc.replace(/  if p_slot_id is not null and p_action <> 'buy' then/, "  if false then");
            assert(m !== migSrc, 'mutation did not apply'); await db.exec(m);
          }, async () => { await db.exec(migSrc); }],
        ['EXECUTE leaked to authenticated',
          async () => { await db.exec(`grant execute on function record_trade_atomic(${SIG13}) to authenticated`); },
          async () => { await db.exec(`revoke execute on function record_trade_atomic(${SIG13}) from authenticated`); }],
        ['the 12-arg overload left callable',
          async () => {
            await db.exec(`create function record_trade_atomic(${SIG12.replaceAll(',', ', ')}) returns jsonb language sql as $$ select null::jsonb $$`);
          },
          async () => { await db.exec(`drop function record_trade_atomic(${SIG12})`); }],
      ];
      for (const [name, breakIt, restore] of breaks) {
        await breakIt();
        const v = await verdictOf(slotBlock);
        assert(v.startsWith('TIER_TRADE_SLOTS EFFECT TEST: FAIL'), `${name}: ${v}`);
        assertEquals(await allTrades(), before, `${name}: must write nothing`);
        await restore();
        assert((await verdictOf(slotBlock)).includes(': PASS'), `restored after: ${name}`);
      }
    });

    await t.step('success returns the committed row, as record-trade returns it to the client', async () => {
      const A = await user();
      const L = await league({ stake_mode: 'budget_cap', budget_amount: 1000, num_rounds: 4 }, [A]);
      const r = await trade(L, buy(A, 'MSFT', 123.45));
      assertEquals(r.status, 200);
      const row = r.body.trade as Row;
      assertEquals([row.symbol, row.action, Number(row.quantity), Number(row.price), Number(row.total_value), row.user_id],
        ['MSFT', 'buy', 1, 123.45, 123.45, A]);
    });
  },
});
