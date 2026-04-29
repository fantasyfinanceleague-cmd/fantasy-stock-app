# RESOLVED — Applied March 2026, committed 30e73c7

# Fix: Season Phase Transitions (Regular Season → Playoffs → Complete)

## Problem Summary

The app has a broken week-advancement pipeline. When the last regular-season week (e.g., Week 8 of 8) completes, the edge function unconditionally bumps `current_week` to 9 **before** checking if the season should transition to playoffs. The UI then displays "Week 9 of 8" with no awareness of playoff state. Existing playoff infrastructure (bracket generation, winner advancement, season completion) is present but never properly triggered or surfaced.

---

## Root Cause (Edge Function)

**File:** `supabase/functions/process-week-results/index.ts`, lines ~1206-1228

```ts
// BUG: Advances week UNCONDITIONALLY before checking season phase
const { error: advanceErr } = await supabase
  .from('leagues')
  .update({ current_week: currentWeek + 1 })
  .eq('id', leagueId);

// This check evaluates (currentWeek + 1) === numWeeks → false
// because currentWeek was already incremented above
if (currentWeek === numWeeks && playoffTeams > 0) {
  await generatePlayoffs(supabase, leagueId, numWeeks + 1, playoffTeams);
}
```

The fix: **check the season phase BEFORE advancing**, and only advance `current_week` if there are more regular-season weeks to play. For playoff weeks, the `current_week` should still increment (playoff matchups use `week_number > numWeeks`), but the league needs a `season_status` transition so the UI knows we're in playoffs.

---

## What to Fix (4 files)

### 1. Edge Function: `supabase/functions/process-week-results/index.ts`

**Replace the week-advancement block (lines ~1192-1229) with this logic:**

```
When all matchups for `currentWeek` are complete:

IF the matchups just processed are playoff matchups (is_playoff === true):
  → Advance current_week (playoff rounds still need week tracking)
  → The existing finals-completion check (lines ~1232-1242) handles season completion — leave it
  
ELSE (regular season matchups):
  IF currentWeek === numWeeks (last regular-season week just finished):
    IF playoffTeams > 0:
      → Set league.season_status = 'playoffs'
      → Advance current_week to numWeeks + 1
      → Call generatePlayoffs() (already exists, line ~1221)
    ELSE (no playoffs):
      → Do NOT advance current_week past numWeeks
      → Call completeSeasonFromStandings() (already exists, line ~1226)
  ELSE (mid-season, more regular weeks to go):
    → Advance current_week by 1 (existing behavior is correct here)
```

Concretely, replace the block from `if (!remainingMatchups || remainingMatchups.length === 0)` through the closing brace (lines ~1206-1229) with:

```ts
if (!remainingMatchups || remainingMatchups.length === 0) {
  // All matchups for this week are done
  const isPlayoffWeek = leagueMatchups.some(m => m.is_playoff);

  if (isPlayoffWeek) {
    // Playoff week completed — advance week for next playoff round
    await supabase
      .from('leagues')
      .update({ current_week: currentWeek + 1 })
      .eq('id', leagueId);
    console.log(`Advanced playoff week for league ${leagueId} to ${currentWeek + 1}`);

  } else if (currentWeek >= numWeeks) {
    // Last regular-season week just completed
    if (playoffTeams > 0) {
      // Transition to playoffs
      await supabase
        .from('leagues')
        .update({
          current_week: numWeeks + 1,
          season_status: 'playoffs',
        })
        .eq('id', leagueId);
      console.log(`League ${leagueId} transitioning to playoffs`);
      await generatePlayoffs(supabase, leagueId, numWeeks + 1, playoffTeams);
    } else {
      // No playoffs — complete the season, do NOT advance past numWeeks
      console.log(`League ${leagueId} regular season complete (no playoffs)`);
      await completeSeasonFromStandings(supabase, leagueId);
    }

  } else {
    // Regular season, more weeks to go
    await supabase
      .from('leagues')
      .update({ current_week: currentWeek + 1 })
      .eq('id', leagueId);
    console.log(`Advanced league ${leagueId} to week ${currentWeek + 1}`);
  }
}
```

**Important:** This requires that the `leagues` table has a `season_status` column. Check if it exists — the codebase references `activeLeague?.season_status === 'completed'` in `league.tsx` (line 322), so it likely does. Valid values should be: `'active'`, `'playoffs'`, `'completed'`. If the column doesn't exist, add a migration:

```sql
ALTER TABLE leagues 
  ADD COLUMN IF NOT EXISTS season_status text DEFAULT 'active' 
  CHECK (season_status IN ('active', 'playoffs', 'completed'));
```

Also ensure `completeSeasonFromPlayoffs()` (line ~707) and `completeSeasonFromStandings()` (line ~736) both set `season_status = 'completed'` on the league. Check if the `complete_league_season` RPC function handles this — if not, add it to both functions:

```ts
// Add after the rpc call in both completeSeasonFromPlayoffs and completeSeasonFromStandings:
await supabase
  .from('leagues')
  .update({ season_status: 'completed' })
  .eq('id', leagueId);
```

---

### 2. Week Status Utility: `lib/weekStatus.ts`

**Add playoff awareness to `getWeekStatus()`.**

The `WeekStatus` interface and `getWeekStatus()` function need to know about playoffs.

**Update the `WeekStatus` interface** (add new fields):

```ts
interface WeekStatus {
  // ... existing fields ...
  phase: 'regular' | 'playoffs' | 'completed';
  playoffRound: string | null; // 'quarter', 'semi', 'finals', or null
  playoffRoundLabel: string | null; // 'Quarterfinals', 'Semifinals', 'Finals', or null
}
```

**Update the `League` interface** used by `getWeekStatus`:

```ts
interface League {
  current_week?: number;
  num_weeks?: number;
  league_type?: string;
  season_status?: string;  // ADD THIS
  playoff_teams?: number;  // ADD THIS
}
```

**Add a helper function** for playoff round display names:

```ts
export function getPlayoffRoundLabel(round: string | null | undefined): string | null {
  if (!round) return null;
  const labels: Record<string, string> = {
    'quarter': 'Quarterfinals',
    'semi': 'Semifinals',
    'finals': 'Finals',
  };
  return labels[round] || round;
}

export function getPlayoffRoundsForTeamCount(teamCount: number): string[] {
  if (teamCount >= 8) return ['Quarterfinals', 'Semifinals', 'Finals'];
  if (teamCount >= 4) return ['Semifinals', 'Finals'];
  if (teamCount >= 2) return ['Finals'];
  return [];
}
```

**Update `getWeekStatus()`** to derive the `phase` field:

```ts
export function getWeekStatus(league: League | null, matchup: Matchup | null): WeekStatus {
  const currentWeek = league?.current_week || 1;
  const numWeeks = league?.num_weeks || 0;
  const seasonStatus = league?.season_status || 'active';

  // Derive phase from season_status (source of truth from DB)
  let phase: 'regular' | 'playoffs' | 'completed' = 'regular';
  if (seasonStatus === 'completed') {
    phase = 'completed';
  } else if (seasonStatus === 'playoffs') {
    phase = 'playoffs';
  } else if (currentWeek > numWeeks && numWeeks > 0) {
    // Fallback: if season_status wasn't set but we're past regular season
    phase = 'completed';
  }

  const isSeasonComplete = phase === 'completed';

  // ... rest of existing logic stays the same ...

  // At the end, add the new fields to the return:
  return {
    // ... existing fields ...
    phase,
    playoffRound: null,       // Will be populated by the caller from matchup data
    playoffRoundLabel: null,   // Will be populated by the caller from matchup data
  };
}
```

**Update `getRelativeCountdown()`** to handle playoff weeks:

```ts
export function getRelativeCountdown(
  nextWeek: number,
  numWeeks: number,
  phase: string,
  nextPlayoffRound?: string | null,
  holidayInfo?: HolidayInfo | null
): string {
  const info = holidayInfo || isNextMondayHoliday();
  const day = info.isHoliday ? 'Tuesday' : 'Monday';

  if (phase === 'playoffs' && nextPlayoffRound) {
    const label = getPlayoffRoundLabel(nextPlayoffRound);
    return `${label} starts ${day}`;
  }

  if (phase === 'completed') {
    return 'Season Complete';
  }

  return `Week ${nextWeek} starts ${day}`;
}
```

---

### 3. League Page: `app/(tabs)/league.tsx`

**Three display areas need playoff awareness:**

#### A. Active Season Banner (lines ~403-415)

Replace the naive `Week {currentWeek} of {numWeeks}` badge:

```tsx
{/* Active Season Banner */}
{!isSeasonCompleted && currentSeason && (
  <View style={styles.activeSeasonBanner}>
    <View style={styles.seasonInfoRow}>
      <Text style={styles.seasonLabel}>Season {currentSeason.season_number}</Text>
      {isMatchupLeague && (
        <View style={styles.weekBadge}>
          <Text style={styles.weekBadgeText}>
            {weekStatus.phase === 'playoffs'
              ? `Playoffs${currentPlayoffRoundLabel ? `: ${currentPlayoffRoundLabel}` : ''}`
              : `Week ${currentWeek} of ${numWeeks}`
            }
          </Text>
        </View>
      )}
    </View>
  </View>
)}
```

#### B. KPI Card for "Week" (lines ~446-458)

```tsx
{isMatchupLeague ? (
  weekStatus.phase === 'playoffs' ? (
    <>
      <Text style={styles.kpiValue}>Playoffs</Text>
      {currentPlayoffRoundLabel && (
        <Text style={styles.kpiSub}>{currentPlayoffRoundLabel}</Text>
      )}
    </>
  ) : (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={styles.kpiValueLarge}>{currentWeek}</Text>
        {weekStatus.status === 'final' && <StatusBadge type="final" />}
        {weekStatus.status === 'active' && <StatusBadge type="live" />}
      </View>
      <Text style={styles.kpiSub}>of {numWeeks} weeks</Text>
    </>
  )
) : (
  <Text style={styles.kpiValue}>Duration</Text>
)}
```

#### C. Standings subtitle (line ~480)

```tsx
<Text style={styles.sectionSubtitle}>
  {weekStatus.phase === 'playoffs'
    ? 'Regular Season Final'
    : `Week ${currentWeek} of ${numWeeks}`
  }
</Text>
```

#### D. Add computed values near the top of the component

You'll need to derive the current playoff round from matchup data. Add this near the other `useMemo` hooks (around line ~150):

```tsx
const currentPlayoffRound = useMemo(() => {
  if (weekStatus.phase !== 'playoffs') return null;
  // Find the active (unresolved) playoff matchup for the current week
  const activePlayoffMatchup = matchups.find(
    m => m.is_playoff && m.week_number === currentWeek && m.team1_gain === null
  );
  if (activePlayoffMatchup) return activePlayoffMatchup.playoff_round;
  // If all current week matchups are done, find the next round
  const nextPlayoffMatchup = matchups.find(
    m => m.is_playoff && m.team1_gain === null
  );
  return nextPlayoffMatchup?.playoff_round || null;
}, [matchups, currentWeek, weekStatus.phase]);

const currentPlayoffRoundLabel = useMemo(() => {
  return getPlayoffRoundLabel(currentPlayoffRound);
}, [currentPlayoffRound]);
```

Add the import at the top of the file:
```tsx
import { getWeekStatus, getCountdownMessage, getPlayoffRoundLabel } from '@/lib/weekStatus';
```

---

### 4. WeekNavigator: `components/WeekNavigator.tsx`

**Three changes:**

#### A. Add playoff props

```tsx
interface WeekNavigatorProps {
  currentWeek: number;
  selectedWeek: number;
  totalWeeks?: number;
  onWeekChange: (week: number) => void;
  disabled?: boolean;
  phase?: 'regular' | 'playoffs' | 'completed';            // NEW
  playoffRoundForWeek?: (week: number) => string | null;     // NEW
}
```

#### B. Cap navigation at the actual last playable week

```tsx
const canGoNext = (() => {
  if (disabled) return false;
  if (selectedWeek >= currentWeek) return false;
  // During regular season, cap at numWeeks
  if (phase === 'regular' && totalWeeks && selectedWeek >= totalWeeks) return false;
  return true;
})();
```

#### C. Show playoff round labels instead of "Week N" for playoff weeks

```tsx
{/* Week display */}
<View style={styles.weekDisplay}>
  <Text style={styles.weekText}>
    {totalWeeks && selectedWeek > totalWeeks && playoffRoundForWeek
      ? (getPlayoffRoundLabel(playoffRoundForWeek(selectedWeek)) || `Week ${selectedWeek}`)
      : `Week ${selectedWeek}`
    }
  </Text>
  {/* ... existing badges ... */}
</View>
```

Import `getPlayoffRoundLabel` from `@/lib/weekStatus` in this file too.

---

## Matchup Page (Bonus)

If the matchup page currently shows "No Matchup This Week" for weeks past `numWeeks`, add a guard:

```tsx
// When season_status === 'completed' and there's no active matchup:
if (league?.season_status === 'completed') {
  // Show "Season Complete" instead of "No Matchup This Week"
}
```

Find the matchup page component and apply this — it's likely in `app/(tabs)/matchup.tsx` or similar.

---

## Verification Steps

After implementing, verify these scenarios:

1. **Regular season mid-week:** Process Week 4 of 8 → `current_week` advances to 5, `season_status` stays `'active'`, UI shows "Week 5 of 8"
2. **Last regular-season week WITH playoffs:** Process Week 8 of 8 (league has `playoff_teams: 4`) → `current_week` becomes 9, `season_status` changes to `'playoffs'`, playoff matchups are generated, UI shows "Playoffs: Semifinals"
3. **Last regular-season week WITHOUT playoffs:** Process Week 8 of 8 (league has `playoff_teams: 0`) → `current_week` stays at 8, `season_status` changes to `'completed'`, `complete_league_season` RPC is called, UI shows "Season Complete"
4. **Playoff round completion:** Process semifinal matchups → `current_week` advances, winners are seeded into finals, UI shows "Playoffs: Finals"
5. **Finals completion:** Process finals matchup → `season_status` changes to `'completed'`, champion is recorded, UI shows season complete banner
6. **WeekNavigator:** Cannot navigate past `numWeeks` during regular season. During playoffs, shows round labels instead of week numbers. After season complete, cannot navigate forward.
7. **Schedule view:** Playoff matchups in the schedule list show round labels (already partially working at line ~655: `matchup.is_playoff ? matchup.playoff_round : \`Wk ${matchup.week_number}\``) — but update to use `getPlayoffRoundLabel()` for proper display names ("Quarterfinals" instead of "quarter").

---

## Files to Modify

| File | Change Type |
|------|------------|
| `supabase/functions/process-week-results/index.ts` | Replace week-advancement block (~lines 1206-1229) |
| `lib/weekStatus.ts` | Add `phase` field, playoff round helpers, update interfaces |
| `app/(tabs)/league.tsx` | Add playoff-aware display in banner, KPI card, standings subtitle |
| `components/WeekNavigator.tsx` | Add phase prop, cap navigation, show round labels |
| `app/(tabs)/matchup.tsx` (if exists) | Add "Season Complete" guard |
| DB migration (if `season_status` column missing) | Add `season_status` to `leagues` table |

## Do NOT Change

- The existing `generatePlayoffs()`, `generateBracket()`, `advancePlayoffWinner()`, `applyTiebreakers()`, `completeSeasonFromPlayoffs()`, and `completeSeasonFromStandings()` functions — they are correct and already handle bracket generation and winner advancement properly
- The score calculation logic (`calculateUserScore`, `calculateWeeklyGainLegacy`, `calculatePortfolio`)
- The standings update logic
- The holiday/market hours detection in `weekStatus.ts`
