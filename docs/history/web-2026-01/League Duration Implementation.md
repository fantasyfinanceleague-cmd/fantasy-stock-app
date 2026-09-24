# League Duration & Matchup Implementation

## Issue

The application had no mechanism to determine how long a league competition runs. After the draft completes, there was no defined end date for the league season, meaning:
- No way to determine when a winner should be declared
- No league lifecycle management (start/end dates)
- No duration options for commissioners when creating leagues

## Solution

Implemented **two league formats**:

### 1. Duration-based Leagues
Commissioner selects a duration preset. Winner is whoever has the best portfolio performance at the end.

| Label | Days |
|-------|------|
| 1 Week | 7 |
| 1 Month | 30 |
| 3 Months | 90 |
| 6 Months | 180 |
| 1 Year | 365 |

### 2. Matchup-based Leagues (Fantasy Football style)
- Commissioner sets number of weeks (minimum = participants - 1 for round robin)
- Round-robin schedule generated when draft completes
- Each week, players face an opponent head-to-head
- Winner determined by who gains more $ that week
- Final standings based on win/loss record

**Week Structure:**
- **Monday**: Trade day (adjust lineup, make trades)
- **Tuesday-Friday**: Matchup period (performance counted)

---

## Database Schema

### Migration 1: Duration Columns
**File:** `supabase/migrations/20251230000000_add_league_duration.sql`

```sql
alter table public.leagues
  add column if not exists duration_days int not null default 30,
  add column if not exists league_start_date timestamptz null,
  add column if not exists league_end_date timestamptz null;

alter table public.leagues
  add constraint leagues_duration_days_check
  check (duration_days in (7, 30, 90, 180, 365));
```

### Migration 2: Matchup Leagues
**File:** `supabase/migrations/20251230100000_add_matchup_leagues.sql`

```sql
-- League type selection
alter table public.leagues
  add column if not exists league_type text not null default 'duration'
  check (league_type in ('duration', 'matchup'));

-- Number of weeks for matchup leagues
alter table public.leagues
  add column if not exists num_weeks int null;

-- Current week tracker
alter table public.leagues
  add column if not exists current_week int null default 1;

-- Matchups table (weekly schedule)
create table if not exists matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  week_number int not null,
  team1_user_id text not null,
  team2_user_id text not null,
  team1_gain numeric(12,2) null,  -- Results filled after week ends
  team2_gain numeric(12,2) null,
  winner_user_id text null,
  week_start timestamptz null,    -- Tuesday 00:00 UTC
  week_end timestamptz null,      -- Friday 23:59 UTC
  created_at timestamptz not null default now(),
  unique(league_id, week_number, team1_user_id),
  unique(league_id, week_number, team2_user_id)
);

-- Standings table (win/loss records)
create table if not exists league_standings (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id text not null,
  wins int not null default 0,
  losses int not null default 0,
  ties int not null default 0,
  points_for numeric(12,2) not null default 0,
  points_against numeric(12,2) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
```

---

## Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/20251230000000_add_league_duration.sql` | Duration columns |
| `supabase/migrations/20251230100000_add_matchup_leagues.sql` | Matchup tables |
| `src/pages/Leagues.jsx` | League type dropdown, conditional duration/weeks |
| `src/pages/LeagueSetupWizard.jsx` | 6-step wizard with league type selection |
| `src/hooks/useLeagues.js` | Accept leagueType, durationDays, numWeeks |
| `src/pages/DraftPage.jsx` | Generate schedule + standings on draft complete |
| `src/utils/scheduleGenerator.js` | Round-robin scheduling algorithm |

---

## League Creation UI

### Leagues.jsx Form
```
League Type: [Duration-based ▼] [Matchup-based ▼]

IF Duration-based:
  └── Duration: [1 Month ▼]

IF Matchup-based:
  └── Number of Weeks: [___] (min: participants - 1)
```

### LeagueSetupWizard Steps
1. League Name
2. Number of Teams (4-16)
3. Number of Rounds (stocks per team)
4. League Type (Duration vs Matchup)
5. Duration preset OR Number of weeks
6. Budget mode

---

## Schedule Generation

**File:** `src/utils/scheduleGenerator.js`

Round-robin algorithm:
```javascript
export function generateSchedule(userIds, numWeeks, startDate) {
  // Uses circle method: one team fixed, others rotate
  // If odd teams, adds BYE placeholder
  // Returns: { week, team1, team2, weekStart, weekEnd }
}
```

**Week Timing:**
- Week 1 starts on next Tuesday after draft completes
- Each week: Tuesday 00:00 UTC to Friday 23:59 UTC
- Monday is trade day (between weeks)

---

## Draft Completion Flow

### Duration League
```
Draft completes →
  league_start_date = NOW()
  league_end_date = NOW() + duration_days
  draft_status = 'completed'
```

### Matchup League
```
Draft completes →
  Generate round-robin schedule
  Insert matchups (all weeks)
  Initialize standings (all members)
  league_start_date = NOW()
  league_end_date = NOW() + (num_weeks * 7 days)
  draft_status = 'completed'
```

---

## Future Work

### Phase 3: Display Components (not yet implemented)
- `WeeklyMatchup.jsx` - Show current week's opponent
- `Standings.jsx` - Show win/loss records
- `MatchupPage.jsx` - Full matchup details

### Phase 4: Weekly Results
- Calculate weekly $ gains for each user
- Determine matchup winners
- Update standings
- Could be cron job or edge function

### Other Ideas
- Playoffs (Top 4 after regular season)
- Trading deadline (disable trades in final weeks)
- Waiver wire
