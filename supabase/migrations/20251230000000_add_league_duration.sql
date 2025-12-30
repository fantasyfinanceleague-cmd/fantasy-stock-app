-- ============================================
-- LEAGUE DURATION & MATCHUP SYSTEM
-- ============================================

-- Add league duration columns
alter table public.leagues
  add column if not exists duration_days int not null default 30,
  add column if not exists league_start_date timestamptz null,
  add column if not exists league_end_date timestamptz null;

-- Add constraint to ensure valid duration values
alter table public.leagues
  add constraint leagues_duration_days_check
  check (duration_days in (7, 30, 90, 180, 365));

-- ============================================
-- MATCHUP-BASED LEAGUES (Fantasy Football style)
-- ============================================

-- Add league_type column to distinguish formats
alter table public.leagues
  add column if not exists league_type text not null default 'duration'
  check (league_type in ('duration', 'matchup'));

-- Number of weeks for matchup leagues (null for duration leagues)
alter table public.leagues
  add column if not exists num_weeks int null;

-- Current week tracker for matchup leagues
alter table public.leagues
  add column if not exists current_week int null default 1;

-- Create matchups table for weekly schedule
-- Week runs Tuesday-Friday, Monday is trade day
create table if not exists matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  week_number int not null,
  team1_user_id text not null,
  team2_user_id text not null,

  -- Results (null until week completes)
  team1_gain numeric(12,2) null,
  team2_gain numeric(12,2) null,
  winner_user_id text null,  -- null for tie

  -- Week timing (Tuesday start, Friday end)
  week_start timestamptz null,  -- Tuesday 00:00 UTC
  week_end timestamptz null,    -- Friday 23:59 UTC
  created_at timestamptz not null default now(),

  -- Each user can only have one matchup per week
  unique(league_id, week_number, team1_user_id),
  unique(league_id, week_number, team2_user_id)
);

create index if not exists matchups_league_idx on matchups(league_id);
create index if not exists matchups_week_idx on matchups(league_id, week_number);

-- Create league_standings table for win/loss records
create table if not exists league_standings (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null,
  wins int not null default 0,
  losses int not null default 0,
  ties int not null default 0,
  points_for numeric(12,2) not null default 0,      -- total $ gained
  points_against numeric(12,2) not null default 0,  -- opponents' total $ gained
  updated_at timestamptz not null default now(),

  primary key (league_id, user_id)
);

create index if not exists league_standings_league_idx on league_standings(league_id);

-- Enable RLS on new tables
alter table matchups enable row level security;
create policy "dev_all" on matchups for all using (true) with check (true);

alter table league_standings enable row level security;
create policy "dev_all" on league_standings for all using (true) with check (true);
