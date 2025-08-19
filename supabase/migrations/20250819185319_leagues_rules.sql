-- Enforce 4..16 participants
alter table public.leagues
  drop constraint if exists leagues_num_participants_check,
  drop constraint if exists leagues_num_participants_range;

alter table public.leagues
  add constraint leagues_num_participants_range
  check (num_participants between 4 and 16);

-- Keep valid budget modes (add "no-budget")
alter table public.leagues
  drop constraint if exists leagues_budget_mode_check;

alter table public.leagues
  add constraint leagues_budget_mode_check
  check (budget_mode in ('budget','no-budget'));

-- Make sure "stocks per team" column exists (safety)
alter table public.leagues
  add column if not exists num_rounds int not null default 6;
