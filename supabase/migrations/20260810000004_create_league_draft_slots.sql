-- In-house simulator (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 2)
-- Draft-slot machinery — net-new, per league (no prod equivalent, recon Item 3).
-- A league's draft rules = an ordered list of slots; each slot = a count + an
-- optional price bracket + an optional category filter. Price tiers and sector
-- requirements are both instances of this one mechanism (DR-001). All filters
-- NULL = a flex/misc slot.
--
-- Depends on `categories` (20260810000003) for the category_id FK — hence the
-- later timestamp.
--
-- COLUMN NOTE: the spec sketch names the count column `count`; it is created
-- here as `slot_count` to avoid shadowing the SQL aggregate in bare references.
-- Same semantics; renamed for clarity.
--
-- RLS: per-league table using the existing B1 helpers is_member / is_commissioner
-- (20260712000000). members read; commissioner writes. The commissioner write
-- policies are INTERIM — remove them when a `league-setup` / `update-league`
-- edge function owns slot writes (mirrors the B1 interim-write roadmap, e.g.
-- [I2a] leagues UPDATE commissioner).
--
-- HUMAN ACTION: `supabase db push` is Giorgio's.

create table if not exists league_draft_slots (
  id          uuid primary key default gen_random_uuid(),
  league_id   uuid not null references leagues(id) on delete cascade,
  slot_index  integer not null,
  slot_count  integer not null default 1 check (slot_count > 0),
  price_min   numeric null,   -- tiers: bracket floor    (NULL = no floor)
  price_max   numeric null,   -- tiers: bracket ceiling  (NULL = no ceiling)
  category_id uuid null references categories(id) on delete set null, -- NULL = any category
  created_at  timestamptz not null default now(),
  unique (league_id, slot_index),
  check (price_min is null or price_max is null or price_min <= price_max)
);

create index if not exists league_draft_slots_league_idx
  on league_draft_slots(league_id);

-- The slot-feasibility guard (spec line 58: a slot's filter must match enough
-- draftable symbols for league_size x slot_count) is a league-setup-time WARNING
-- computed by the Phase 4 commissioner UI / Phase 3 validator, NOT a schema
-- constraint — it depends on the live draftable universe. Not enforced here.

alter table league_draft_slots enable row level security;

-- SELECT (permanent): members read their league's slot definitions.
create policy "league_draft_slots_select_members" on league_draft_slots
  for select to authenticated
  using (is_member(league_id));

-- INSERT/UPDATE/DELETE (INTERIM commissioner): remove when a league-setup edge
-- function lands and owns slot writes.
create policy "league_draft_slots_insert_commissioner" on league_draft_slots
  for insert to authenticated
  with check (is_commissioner(league_id));

create policy "league_draft_slots_update_commissioner" on league_draft_slots
  for update to authenticated
  using (is_commissioner(league_id))
  with check (is_commissioner(league_id));

create policy "league_draft_slots_delete_commissioner" on league_draft_slots
  for delete to authenticated
  using (is_commissioner(league_id));
