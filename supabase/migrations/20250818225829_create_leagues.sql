create extension if not exists pgcrypto;

create table if not exists leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  commissioner_id text not null,
  invite_code text unique not null,
  draft_date timestamptz null,
  salary_cap_limit numeric(12,2) null,
  num_participants int not null check (num_participants between 2 and 20),
  num_rounds int not null default 6,
  budget_mode text not null default 'budget' check (budget_mode in ('budget','no-budget')),
  budget_amount numeric(12,2) not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists league_members (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('commissioner','member')),
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table if not exists league_invites (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  inviter_id text not null,
  invited_identifier text not null,
  code text not null unique,
  status text not null default 'pending' check (status in ('pending','accepted','declined','expired')),
  expires_at timestamptz null,
  created_at timestamptz not null default now()
);

alter table if exists draft_settings
  add column if not exists league_id uuid references leagues(id) on delete cascade;

create index if not exists leagues_commissioner_idx on leagues(commissioner_id);
create index if not exists league_members_user_idx on league_members(user_id);
create index if not exists league_invites_league_idx on league_invites(league_id);

-- TEMP dev-only RLS (replace before prod)
alter table leagues enable row level security;
create policy "dev_all" on leagues for all using (true) with check (true);
alter table league_members enable row level security;
create policy "dev_all" on league_members for all using (true) with check (true);
alter table league_invites enable row level security;
create policy "dev_all" on league_invites for all using (true) with check (true);
