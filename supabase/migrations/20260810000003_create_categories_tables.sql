-- In-house simulator (DR-001 / SIMULATOR_MIGRATION_SPEC Phase 2)
-- Categories domain — three net-new tables (no prod equivalent, verified in
-- recon Item 3). RLS from day one (B1 model: anon reads NOTHING; authenticated
-- reads reference data; writes are service_role only — these are Stockpile-
-- curated tables seeded/maintained by the Phase 4 job, never client-written).
--
-- Three-layer category assignment (DR-001): category_rules (GICS industry ->
-- category, automatic total coverage) is layer 1; symbol_category_overrides
-- (curated exceptions, capped at 3 per symbol) is layer 2; the Misc fallback
-- (categories.is_misc row) is layer 3.
--
-- SEED DATA IS NOT HERE. Full seed content (~10 categories, ~160 rule rows,
-- ~30-60 overrides) is Phase 4 (spec lines 89-94). This migration is schema
-- only; a seed-file stub lives at supabase/seed/README.md.
--
-- HUMAN ACTION: `supabase db push` is Giorgio's.

-- ---------------------------------------------------------------------------
-- categories: ~10 curated, player-intuitive buckets (seeded in Phase 4).
-- ---------------------------------------------------------------------------
create table if not exists categories (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,          -- stable key for seed files / code
  name          text not null,                 -- display name
  display_order integer not null default 0,
  is_misc       boolean not null default false, -- the layer-3 flex/Misc fallback
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- category_rules: GICS industry -> category, total coverage of the vendor
-- taxonomy. One category per industry (unique gics_industry) — this is the
-- automatic layer, not the exception layer.
-- ---------------------------------------------------------------------------
create table if not exists category_rules (
  id            uuid primary key default gen_random_uuid(),
  gics_industry text not null unique,
  category_id   uuid not null references categories(id) on delete restrict,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- symbol_category_overrides: curated exceptions. Effective eligibility =
-- overrides if present, else the rule-table category. Capped at <= 3 categories
-- per symbol (DR-001 multi-category cap) — enforced by trigger below, NOT by
-- convention (spec line 62). A (symbol, category_id) pair is unique so the same
-- category can't be double-counted toward the cap.
-- ---------------------------------------------------------------------------
create table if not exists symbol_category_overrides (
  id            uuid primary key default gen_random_uuid(),
  symbol        text not null,
  category_id   uuid not null references categories(id) on delete restrict,
  justification text not null,   -- required: the DR-001 written criterion
  created_at    timestamptz not null default now(),
  unique (symbol, category_id)
);

create index if not exists symbol_category_overrides_symbol_idx
  on symbol_category_overrides(symbol);
create index if not exists category_rules_category_idx
  on category_rules(category_id);

-- ---------------------------------------------------------------------------
-- <= 3 categories per symbol, enforced in-schema (constraint/trigger, not
-- convention). A row-counting cap cannot be a CHECK, so it is a BEFORE trigger.
-- Fires on INSERT and on UPDATE that moves a row to a different symbol; an
-- UPDATE that leaves symbol unchanged is a no-op (its own row would otherwise
-- be miscounted). search_path pinned per repo convention for functions.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_symbol_category_cap()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only guard growth of a symbol's override set.
  if tg_op = 'UPDATE' and new.symbol = old.symbol then
    return new;
  end if;

  if (select count(*) from symbol_category_overrides where symbol = new.symbol) >= 3 then
    raise exception
      'symbol % already has 3 category overrides (max 3 per symbol per DR-001)', new.symbol
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists symbol_category_overrides_cap on symbol_category_overrides;
create trigger symbol_category_overrides_cap
  before insert or update of symbol on symbol_category_overrides
  for each row execute function public.enforce_symbol_category_cap();

-- ---------------------------------------------------------------------------
-- RLS: reference data. authenticated reads all; anon reads nothing; no client
-- write policy (service_role bypasses RLS and owns all writes).
-- ---------------------------------------------------------------------------
alter table categories                enable row level security;
alter table category_rules            enable row level security;
alter table symbol_category_overrides enable row level security;

create policy "categories_select_authenticated" on categories
  for select to authenticated using (true);
create policy "category_rules_select_authenticated" on category_rules
  for select to authenticated using (true);
create policy "symbol_category_overrides_select_authenticated" on symbol_category_overrides
  for select to authenticated using (true);
