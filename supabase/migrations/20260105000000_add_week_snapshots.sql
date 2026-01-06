-- ============================================
-- WEEK-START PRICE SNAPSHOTS FOR MATCHUP LEAGUES
-- ============================================
-- Captures portfolio state at Tuesday market open (9:30 AM ET)
-- Used to calculate weekly gains (current price vs week start price)

create table if not exists week_snapshots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null,
  week_number int not null,
  symbol text not null,
  quantity numeric(12,6) not null,
  week_start_price numeric(12,4) not null,  -- Price at Tuesday 9:30 AM ET
  created_at timestamptz not null default now(),

  -- One snapshot per symbol per user per week
  unique(league_id, user_id, week_number, symbol)
);

create index if not exists week_snapshots_league_week_idx
  on week_snapshots(league_id, week_number);

create index if not exists week_snapshots_user_idx
  on week_snapshots(league_id, user_id, week_number);

-- Enable RLS
alter table week_snapshots enable row level security;
create policy "dev_all" on week_snapshots for all using (true) with check (true);

-- Comment explaining the table purpose
comment on table week_snapshots is
  'Stores portfolio snapshots at week start (Tuesday 9:30 AM ET) for matchup gain calculations';
