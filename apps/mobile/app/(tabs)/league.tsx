/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Icon } from '@/components/sp/Icon';
import { router } from 'expo-router';
import { Share } from 'react-native';

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
import { BracketView } from '@/components/game/BracketView';
import { DraftLobby } from '@/components/game/DraftLobby';
import { usePreDraftData } from '@/lib/home/usePreDraftData';
import { StartDraftConfirm } from '@/components/game/StartDraftConfirm';
import { useDraftStatus } from '@/lib/game/useDraftStatus';
import { Button } from '@/components/sp/Button';
import { supabase } from '@/lib/supabase';
import { useBracket } from '@/lib/game/useBracket';
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
  const [segment, setSegment] = useState<'standings' | 'schedule' | 'playoffs'>('standings');
  // The Playoffs segment appears once the season is in the playoffs (or over).
  const hasPlayoffs = (activeLeague?.season_status === 'playoffs' || activeLeague?.season_status === 'completed') && (activeLeague?.playoff_teams ?? 0) > 0;
  const phase = sheetLeagues.find((l) => l.id === activeLeagueId)?.seasonPhase;
  const drafting = phase === 'drafting';
  const preDraft = phase === 'pre_draft' && activeLeagueId !== null;
  const inSeason = phase === 'regular' || phase === 'playoffs' || phase === 'completed';
  const { colors } = useTheme();
  const st = useLeagueStandings(inSeason ? activeLeagueId : null);
  const { user } = useAuth();
  const bracket = useBracket(
    inSeason ? activeLeagueId : null,
    activeLeague?.playoff_teams ?? null,
    st.standings.map((x) => ({ user_id: x.user_id, rank: x.rank, display_name: x.display_name })),
    segment === 'playoffs' && hasPlayoffs,
  );

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
                options={[
                  { label: 'Standings', value: 'standings' },
                  { label: 'Schedule', value: 'schedule' },
                  ...(hasPlayoffs ? [{ label: 'Playoffs', value: 'playoffs' }] : []),
                ]}
                value={segment}
                onChange={(v) => setSegment(v === 'schedule' ? 'schedule' : v === 'playoffs' ? 'playoffs' : 'standings')}
              />
              {segment === 'playoffs' ? (
                bracket.bracket ? (
                  <BracketView
                    bracket={bracket.bracket}
                    myUserId={user?.id ?? ''}
                    caption={activeLeague?.playoff_teams ? `The top ${activeLeague.playoff_teams} in the standings make the playoffs. A tied game goes to the higher seed.` : null}
                  />
                ) : null
              ) : segment === 'standings' ? (
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

  if (preDraft && activeLeagueId) {
    return <LeagueLobby leagueId={activeLeagueId} />;
  }

  return (
    <PhasePlaceholder
      title="League"
      icon={() => <Icon name="trophy" size="title" tone="text2" />}
      heading="Standings are on the way"
      message="Standings, the schedule and the draft room will live here in the next update."
      actionLabel={drafting ? 'Go to the draft room' : undefined}
      onAction={drafting ? () => router.push('/(tabs)/draft') : undefined}
    />
  );
}

/** The pre-draft League tab (3c): the draft lobby. Its own component, so the
 * pre-draft hook runs only for a league that is actually pre-draft. */
function LeagueLobby({ leagueId }: { leagueId: string }) {
  const { activeLeague, refresh } = useLeagueContext();
  const { user } = useAuth();
  const { colors } = useTheme();
  const data = usePreDraftData(leagueId);
  const [confirming, setConfirming] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [statusKey, setStatusKey] = useState(0);
  const ds = useDraftStatus(leagueId, true, statusKey);

  // The stepper writes the same leagues update League settings uses, then re-reads the status.
  const setPlayoffTeams = async (teams: number) => {
    const { error } = await supabase.from('leagues').update({ playoff_teams: teams }).eq('id', leagueId);
    if (error) {
      setStartError("The playoff teams didn't change. Try again.");
      return;
    }
    setStartError(null);
    setStatusKey((k) => k + 1);
    await refresh();
  };

  const shareInvite = () => {
    const code = activeLeague?.invite_code;
    if (code) void Share.share({ message: `Join my league with code ${code}` });
  };

  const startDraft = async () => {
    setStartError(null);
    const { data: res, error } = await supabase.functions.invoke('draft-control', { body: { league_id: leagueId, action: 'start' } });
    if (error || !res || res.ok === false) {
      setStartError("The draft didn't start. Check the blockers above, then try again.");
      setStatusKey((k) => k + 1);
      return;
    }
    setConfirming(false);
    await refresh();
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ShellHeader title="League" showAvatar />
      <BarsRefresh onRefresh={refresh} contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[6] }}>
        {data.loading ? null : (
          <DraftLobby
            data={data}
            myUserId={user?.id ?? ''}
            draftDate={activeLeague?.draft_date ?? null}
            pickSeconds={activeLeague?.pick_seconds ?? 60}
            rounds={activeLeague?.num_rounds ?? 6}
            now={new Date()}
          />
        )}
        {ds.isCommissioner ? (
          confirming ? (
            <View style={styles.stack}>
              <StartDraftConfirm
                status={ds}
                playoffTeams={activeLeague?.playoff_teams ?? null}
                numWeeks={activeLeague?.num_weeks ?? 0}
                pickSeconds={activeLeague?.pick_seconds ?? 60}
                onStart={startDraft}
                onNotYet={() => setConfirming(false)}
                onSetPlayoffTeams={setPlayoffTeams}
                inviteCode={activeLeague?.invite_code ?? null}
                onShareInvite={shareInvite}
              />
              {startError ? <Text variant="callout">{startError}</Text> : null}
            </View>
          ) : (
            <Button label="Start the draft" onPress={() => setConfirming(true)} disabled={ds.status !== 'ready'} />
          )
        ) : null}
      </BarsRefresh>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
});
