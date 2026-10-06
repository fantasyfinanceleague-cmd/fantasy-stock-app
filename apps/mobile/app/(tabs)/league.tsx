/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { space } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Text } from '@/components/sp/Text';
import { PhasePlaceholder } from '@/components/shell/PhasePlaceholder';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { BarsRefresh } from '@/components/shell/BarsRefresh';
import { StandingsTable } from '@/components/game/StandingsTable';
import { useLeagueContext } from '@/lib/LeagueContext';
import { playoffLine } from '@/lib/playoffs';
import { buildSchedule } from '@/lib/game/schedule';
import { ScheduleList } from '@/components/game/ScheduleList';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { useState } from 'react';
import { useLeagueStandings } from '@/lib/game/useLeagueStandings';
import { useAuth } from '@/lib/useAuth';
import { buildStandingsRows } from '@/lib/game/standings';

// League (3c). The standings for a season in progress, the season over and
// the playoffs. Standings order is the server's (league_standings_ranked,
// read through get_home_league); the ▲/▼ move needs the through-week
// ranking, so it stays hidden until that is deployed. Drafting keeps the
// draft-room entry (§3 IA). Other phases keep their placeholder until they
// are built (the pre-draft lobby, the Season 2 review, History).
const STANDINGS_CAPTION = 'Ranked by win percentage, then head-to-head, then season gain. This is also the playoff seeding.';

export default function LeagueScreen() {
  const { sheetLeagues, activeLeagueId, activeLeague, refresh } = useLeagueContext();
  // League's segments: Standings | Schedule (the board, D4 = keep). History is not built yet.
  const [segment, setSegment] = useState<'standings' | 'schedule'>('standings');
  const phase = sheetLeagues.find((l) => l.id === activeLeagueId)?.seasonPhase;
  const drafting = phase === 'drafting';
  const inSeason = phase === 'regular' || phase === 'playoffs' || phase === 'completed';
  const { colors } = useTheme();
  const st = useLeagueStandings(inSeason ? activeLeagueId : null);
  const { user } = useAuth();

  if (inSeason) {
    if (st.status === 'error') {
      return <PhasePlaceholder title="League" icon={(p) => <Ionicons name="alert-circle-outline" {...p} />} heading="Couldn't load the standings" message="Pull down to try again." onRefresh={refresh} />;
    }
    const rows = buildStandingsRows(st.standings, user?.id ?? '', st.previousRanks);
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ShellHeader title="League" showAvatar />
        <BarsRefresh onRefresh={refresh} contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[6] }}>
          {st.status === 'ready' ? (
            <View style={styles.stack}>
              <SegmentedControl
                options={[{ label: 'Standings', value: 'standings' }, { label: 'Schedule', value: 'schedule' }]}
                value={segment}
                onChange={(v) => setSegment(v === 'schedule' ? 'schedule' : 'standings')}
              />
              {segment === 'standings' ? (
                <StandingsTable rows={rows} caption={STANDINGS_CAPTION} seasonComplete={phase === 'completed'} />
              ) : (
                <ScheduleList
                  rows={buildSchedule({ myUserId: user?.id ?? '', currentWeek: st.week ?? 1, numWeeks: activeLeague?.num_weeks ?? 0, names: st.standings.map((x) => ({ user_id: x.user_id, display_name: x.display_name })), matchups: st.data?.matchups ?? [] })}
                  playoffLine={playoffLine(activeLeague?.playoff_teams)}
                />
              )}
            </View>
          ) : null}
        </BarsRefresh>
      </View>
    );
  }

  return (
    <PhasePlaceholder
      title="League"
      icon={(p) => <Ionicons name="trophy-outline" {...p} />}
      heading="Standings are on the way"
      message="Standings, the schedule and the draft room will live here in the next update."
      actionLabel={drafting ? 'Go to the draft room' : undefined}
      onAction={drafting ? () => router.push('/(tabs)/draft') : undefined}
    />
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
});
