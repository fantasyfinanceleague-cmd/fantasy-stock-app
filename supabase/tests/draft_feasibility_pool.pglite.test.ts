/**
 * 20261101000000_draft_feasibility_pool.sql against REAL Postgres (PGlite).
 * NOT hermetic: fetches npm:@electric-sql/pglite. Kept outside supabase/functions/
 * so `deno test supabase/functions/` stays offline. Run instructions:
 * supabase/tests/README.md.
 *
 * Proves the SQL twin and the TS mirror agree: the same pool, the same
 * signature groups, the same counts and the same cheapest prices (cents, with
 * the half-cent rounding trap included), for the robust-bracket margin and the
 * DR-001 three-layer category rule (override replaces rule). Then proves the
 * grants: service_role may execute, anon and authenticated may not.
 */
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.2';
import { buildPoolGroups, type PoolStock, type PoolGroup } from '../functions/_shared/draft-feasibility.ts';
import type { Slot } from '../functions/_shared/draft-validation.ts';

const ROOT = new URL('../../', import.meta.url);
const MIGRATION = new URL('supabase/migrations/20261101000000_draft_feasibility_pool.sql', ROOT);

const CAT_T = '11111111-1111-4111-8111-111111111111'; // tech (rule: Software)
const CAT_E = '22222222-2222-4222-8222-222222222222'; // energy (override target)

const SCHEMA = `
  create role anon;
  create role authenticated;
  create role service_role;
  create table symbols (
    symbol text primary key,
    active boolean,
    price_unsupported boolean,
    is_draftable boolean,
    last_price numeric,
    gics_industry text
  );
  create table symbol_category_overrides (symbol text not null, category_id uuid not null);
  create table category_rules (gics_industry text not null, category_id uuid not null);
  grant select on symbols, symbol_category_overrides, category_rules to service_role;
  -- Supabase's default privileges: every new public function is born with explicit
  -- anon/authenticated/service_role EXECUTE (CLAUDE.md). Without this, the grant
  -- test below could pass while prod stayed anon-callable.
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
`;

// Deterministic fixture: 3-decimal prices (rounding trap), industries, overrides,
// inactive / non-draftable / unpriced rows that the filters must drop.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const INDUSTRIES = ['Software', 'Oil', 'Retail', 'Retail'];

Deno.test('draft_feasibility_pool: SQL groups == TS buildPoolGroups on one fixture (incl. rounding + categories)', async () => {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(await Deno.readTextFile(MIGRATION));
  await db.exec(`
    insert into category_rules values ('Software', '${CAT_T}'), ('Oil', '${CAT_E}');
  `);
  const r = rng(42);
  const stocks: PoolStock[] = [];
  const overrides = new Map<string, string[]>();
  for (let i = 0; i < 320; i++) {
    const symbol = `T${String(i).padStart(3, '0')}`;
    const ind = INDUSTRIES[Math.floor(r() * INDUSTRIES.length)];
    const price = r() < 0.05 ? null : Math.round(r() * 300000) / 1000; // 3dp: half-cent cases
    const active = r() > 0.03;
    const draftable = r() > 0.1;
    const unsupported = r() < 0.02;
    await db.query('insert into symbols values ($1,$2,$3,$4,$5,$6)', [symbol, active, unsupported, draftable, price, ind]);
    if (price != null && active && !unsupported) {
      const ovr = r() < 0.05 ? [CAT_E] : null;
      if (ovr) {
        overrides.set(symbol, ovr);
        await db.query('insert into symbol_category_overrides values ($1,$2)', [symbol, CAT_E]);
      }
      const rule = ind === 'Software' ? [CAT_T] : ind === 'Oil' ? [CAT_E] : [];
      stocks.push({
        symbol,
        cachedPrice: price,
        eligibility: new Set(ovr ?? rule),
        isDraftable: draftable,
      });
    }
  }
  // The filters that the TS side applies via its inputs.
  const exclude = ['T001', 'T002'];
  const types: Slot[] = [
    { id: 'a', slotIndex: 0, slotCount: 1, priceMin: 50, priceMax: 200, categoryId: null },
    { id: 'b', slotIndex: 1, slotCount: 1, priceMin: null, priceMax: null, categoryId: CAT_T },
    { id: 'c', slotIndex: 2, slotCount: 1, priceMin: 100, priceMax: null, categoryId: CAT_E },
  ];
  const depth = 7;

  // Stocks that the SQL view would drop (inactive/unsupported/unpriced) were never
  // pushed, so the TS input is already the pool; exclusion + draftable are applied here
  // by buildPoolGroups exactly as the RPC applies them.
  const ts: PoolGroup[] = buildPoolGroups(types, stocks, { exclude, draftableOnly: true, depth });

  const res = await db.query<{ ordinals: number[]; n: string | number; prices: Array<string | number> }>(
    'select ordinals, n, prices from draft_feasibility_pool($1::jsonb, true, $2::text[], $3)',
    [
      JSON.stringify(types.map((t, j) => ({ ordinal: j, price_min: t.priceMin, price_max: t.priceMax, category_id: t.categoryId }))),
      exclude,
      depth,
    ],
  );
  const sql: PoolGroup[] = res.rows.map((row) => ({
    ordinals: row.ordinals.map(Number),
    n: Number(row.n),
    prices: row.prices.map(Number),
  }));
  const key = (g: PoolGroup) => g.ordinals.join(',');
  sql.sort((a, b) => key(a).localeCompare(key(b)));
  ts.sort((a, b) => key(a).localeCompare(key(b)));
  assertEquals(sql.length, ts.length, 'same number of signature groups');
  for (let i = 0; i < ts.length; i++) {
    assertEquals(sql[i].ordinals, ts[i].ordinals, `group ${i} signature`);
    assertEquals(sql[i].n, ts[i].n, `group ${i} count`);
    assertEquals(sql[i].prices, ts[i].prices, `group ${i} cheapest prices`);
  }
  assert(sql.length >= 3, 'fixture must exercise several groups');
  await db.close();
});

Deno.test('draft_feasibility_pool: service_role may execute; anon and authenticated may not (grant, not a raise)', async () => {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(await Deno.readTextFile(MIGRATION));
  const args = ['[]', true, [], 1] as const;
  const sig = 'public.draft_feasibility_pool(jsonb,boolean,text[],integer)';
  for (const role of ['anon', 'authenticated']) {
    const { rows } = await db.query<{ ok: boolean }>(
      `select has_function_privilege('${role}', '${sig}', 'EXECUTE') as ok`,
    );
    assertEquals(rows[0].ok, false, `${role} must not hold EXECUTE (explicit revoke, not just PUBLIC)`);
  }
  await db.exec('set role service_role');
  const ok = await db.query('select * from draft_feasibility_pool($1::jsonb, $2, $3::text[], $4)', [...args]);
  assertEquals(ok.rows.length, 0);
  await db.exec('reset role');
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assertRejects(
      () => db.query('select * from draft_feasibility_pool($1::jsonb, $2, $3::text[], $4)', [...args]),
      Error,
      'permission denied',
    );
    await db.exec('reset role');
  }
  await db.close();
});
