/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet, Alert } from 'react-native';
import { Icon } from '@/components/sp/Icon';
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
import { BracketView } from '@/components/game/BracketView';
import { DraftLobby } from '@/components/game/DraftLobby';
import { DraftRoom } from '@/components/game/DraftRoom';
import { LeagueRenewal } from '@/components/game/LeagueRenewal';
import { HistoryList } from '@/components/game/HistoryList';
import { ChampBanner } from '@/components/game/ChampBanner';
import { championBanner } from '@/lib/game/history';
import { leagueScreenFor, showRunItBackStrip, seasonSegments } from '@/lib/game/leaguePhase';
import { useLeagueHistory } from '@/lib/game/useLeagueHistory';
import { usePreDraftData } from '@/lib/home/usePreDraftData';
import { AutoStartBlockers } from '@/components/game/AutoStartBlockers';
import { DraftCountdownCard } from '@/components/game/DraftCountdownCard';
import {
  COMMISSIONER_FALLBACK,
  DRAFT_STATUS_LOAD_FAILED,
  NO_DATE_TITLE,
  START_RETRYING,
  countdownCopy,
  deadlineCopy,
  memberPostponedCopy,
  noDateCopy,
} from '@/lib/game/autoStart';
import { useDraftAutoStart } from '@/lib/game/useDraftAutoStart';
import { Button } from '@/components/sp/Button';
import { Card } from '@/components/sp/Card';
import { supabase } from '@/lib/supabase';
import { seamRpc } from '@/lib/game/seamCalls';
import { useBracket } from '@/lib/game/useBracket';
import { SegmentedControl } from '@/components/sp/SegmentedControl';
import { useState } from 'react';
import { useLeagueStandings } from '@/lib/game/useLeagueStandings';
import { useAuth } from '@/lib/useAuth';
import { buildStandingsRows } from '@/lib/game/standings';
import { SettingRow, SetupCard } from '@/components/game/SetupRows';
import { showsLeagueSettingsRow } from '@/lib/game/leagueSettingsEntry';
import { QueueEditor } from '@/components/game/QueueEditor';
import { useDraftQueue } from '@/lib/game/useDraftQueue';
import { useRenewalRoster } from '@/lib/game/useRenewalRoster';
import { renewalReadyForLobby } from '@/lib/game/renewalLobby';
import { QUEUE_LOAD_FAILED } from '@/lib/game/draftQueueRead';

// League (3c). The standings for a season in progress, the season over and
// the playoffs. Standings order is the server's (league_standings_ranked,
// read through get_home_league); the ▲/▼ move needs the through-week
// ranking, so it stays hidden until that is deployed. Drafting keeps the
// draft-room entry (§3 IA). Other phases keep their placeholder until they
// are built (the pre-draft lobby, the Season 2 review, History).
const SEGMENT_LABEL: Record<'standings' | 'schedule' | 'playoffs' | 'history', string> = {
  standings: 'Standings',
  schedule: 'Schedule',
  playoffs: 'Playoffs',
  history: 'History',
};

const STANDINGS_CAPTION = 'Ranked by win percentage, then head-to-head, then season gain. This is also the playoff seeding.';

export default function LeagueScreen() {
  const { sheetLeagues, activeLeagueId, activeLeague, refresh, setActiveLeagueId } = useLeagueContext();
  // League's segments: Standings | Schedule (the board, D4 = keep). History is not built yet.
  const [segment, setSegment] = useState<'standings' | 'schedule' | 'playoffs' | 'history'>('standings');
  const phase = sheetLeagues.find((l) => l.id === activeLeagueId)?.seasonPhase;
  // The screen is the rules' choice for the phase (lib/game/leaguePhase.ts).
  const screen = activeLeague && phase ? leagueScreenFor({ phase, isRenewal: !!activeLeague.previous_league_id }) : 'placeholder';
  const drafting = screen === 'draft_room';
  const preDraft = (screen === 'lobby' || screen === 'renewal') && activeLeagueId !== null;
  const inSeason = screen === 'season';
  const history = useLeagueHistory(inSeason ? activeLeagueId : null, segment === 'history' && inSeason);
  const { colors } = useTheme();
  const st = useLeagueStandings(inSeason ? activeLeagueId : null);
  const { user } = useAuth();
  const bracket = useBracket(
    inSeason ? activeLeagueId : null,
    activeLeague?.playoff_teams ?? null,
    st.standings.map((x) => ({ user_id: x.user_id, rank: x.rank, display_name: x.display_name })),
    segment === 'playoffs',
  );

  // R2: a finished season's commissioner starts the renewal. The server returns the
  // new league (or the one already made); the commissioner lands on its roster (R5).
  const runItBack = async () => {
    if (!activeLeagueId) return;
    const { data, error } = await seamRpc('renew_league', { p_league_id: activeLeagueId });
    const res = data as { status?: string; league_id?: string } | null;
    if (error || !res || (res.status !== 'renewed' && res.status !== 'already_renewed') || !res.league_id) {
      Alert.alert('Not started', 'The renewal did not start. Try again.');
      return;
    }
    setActiveLeagueId(res.league_id);
    await refresh();
  };
  const isCommissioner = !!user?.id && activeLeague?.commissioner_id === user.id;

  if (inSeason) {
    if (st.status === 'error') {
      return <PhasePlaceholder title="League" icon={() => <Icon name="alert" size="title" tone="text2" />} heading="Couldn't load the standings" message="Pull down to try again." onRefresh={refresh} />;
    }
    const rows = buildStandingsRows(st.standings, user?.id ?? '', st.previousRanks);
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ShellHeader title="League" showAvatar />
        <BarsRefresh onRefresh={refresh} contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[6] }}>
          {st.status === 'ready' ? (
            <View style={styles.stack}>
              {phase && showRunItBackStrip({ phase, isCommissioner, hasSuccessor: !!activeLeague?.successor_league_id }) ? (
                <Card>
                  <Text variant="headline">You're the commissioner</Text>
                  <Text variant="callout" tone="secondary">Start Season 2 with the same group. Season 1 stays in History.</Text>
                  <Button label="Run it back" onPress={() => void runItBack()} />
                </Card>
              ) : null}
              <SegmentedControl
                options={seasonSegments({ phase: phase ?? 'regular', playoffTeams: activeLeague?.playoff_teams ?? null }).map((v) => ({
                  label: SEGMENT_LABEL[v],
                  value: v,
                }))}
                value={segment}
                onChange={(v) => setSegment(v === 'schedule' ? 'schedule' : v === 'playoffs' ? 'playoffs' : v === 'history' ? 'history' : 'standings')}
              />
              {segment === 'history' ? (
                history.status === 'ready' ? <HistoryList rows={history.rows} /> : null
              ) : segment === 'playoffs' ? (
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

  if (preDraft && activeLeagueId && activeLeague?.previous_league_id) {
    return <RenewedPreDraft leagueId={activeLeagueId} createdAt={activeLeague.created_at ?? new Date().toISOString()} />;
  }
  if (preDraft && activeLeagueId) {
    return <LeagueLobby leagueId={activeLeagueId} />;
  }
  if (drafting && activeLeagueId && activeLeague) {
    return <LeagueDraftRoom leagueId={activeLeagueId} rounds={activeLeague.num_rounds ?? 6} />;
  }

  return (
    <PhasePlaceholder
      title="League"
      icon={() => <Icon name="trophy" size="title" tone="text2" />}
      heading="Standings are on the way"
      message="Standings, the schedule and the draft room will live here in the next update."
    />
  );
}

/** A renewed league before its draft (3c-2): the Run it back flow until the
 * renewal is reconciled and the season is set, then the normal pre-draft lobby
 * (the countdown, the queue, League settings), per the board's Season 2
 * League tab → "Go to the draft lobby". See renewalReadyForLobby. */
function RenewedPreDraft({ leagueId, createdAt }: { leagueId: string; createdAt: string }) {
  const { activeLeague, refresh } = useLeagueContext();
  const [rosterKey, setRosterKey] = useState(0);
  const roster = useRenewalRoster(leagueId, null, rosterKey);
  const ready = roster.status === 'ready' && renewalReadyForLobby({ roster: roster.roster, draftDate: activeLeague?.draft_date });
  if (ready) return <LeagueLobby leagueId={leagueId} />;
  return (
    <LeagueRenewalScreen
      leagueId={leagueId}
      createdAt={createdAt}
      onScheduled={async () => {
        // Re-read the league (its new draft_date) and the roster, so a scheduled
        // season moves straight to the lobby.
        await refresh();
        setRosterKey((k) => k + 1);
      }}
    />
  );
}

/** A renewed league before its draft (3c, Run it back): the roster or the ask. No
 * League settings row here: the review is the only way to set Season 2's date
 * (renewalReadyForLobby relies on it); the row is in the lobby after scheduling. */
function LeagueRenewalScreen({ leagueId, createdAt, onScheduled }: { leagueId: string; createdAt: string; onScheduled: () => void }) {
  const { refresh, activeLeague } = useLeagueContext();
  const { colors } = useTheme();
  const [key, setKey] = useState(0);
  const hist = useLeagueHistory(leagueId, true);
  const banner = championBanner(hist.rows);
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ShellHeader title="League" showAvatar />
      <BarsRefresh onRefresh={refresh} contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[6] }}>
        {banner ? <ChampBanner tag={banner.tag} line={banner.line} /> : null}
        <LeagueRenewal
          key={key}
          successorId={leagueId}
          leagueId={leagueId}
          createdAt={createdAt}
          now={new Date()}
          onChanged={() => setKey((k) => k + 1)}
          settings={{
            name: activeLeague?.name ?? '',
            num_weeks: activeLeague?.num_weeks ?? 0,
            pick_seconds: activeLeague?.pick_seconds ?? 60,
            draft_date: activeLeague?.draft_date ?? null,
            draft_order_mode: activeLeague?.draft_order_mode ?? 'random',
            playoff_teams: activeLeague?.playoff_teams ?? null,
            notional_per_slot: activeLeague?.notional_per_slot ?? null,
            num_rounds: activeLeague?.num_rounds,
          }}
          inviteCode={activeLeague?.invite_code ?? ''}
          onScheduled={() => {
            setKey((k) => k + 1);
            onScheduled();
          }}
        />
      </BarsRefresh>
    </View>
  );
}

/** The drafting League tab (3c): the draft room. Its own component, so its hooks run only while drafting. */
function LeagueDraftRoom({ leagueId, rounds }: { leagueId: string; rounds: number }) {
  const { refresh } = useLeagueContext();
  const { user } = useAuth();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ShellHeader title="League" showAvatar />
      <BarsRefresh onRefresh={refresh} contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[6] }}>
        <DraftRoom leagueId={leagueId} myUserId={user?.id ?? ''} rounds={rounds} />
      </BarsRefresh>
    </View>
  );
}

/** The pre-draft League tab (3c): the draft lobby. Its own component, so the
 * pre-draft hook runs only for a league that is actually pre-draft. */
function LeagueLobby({ leagueId }: { leagueId: string }) {
  const { activeLeague, refresh } = useLeagueContext();
  const { user } = useAuth();
  const { colors } = useTheme();
  const data = usePreDraftData(leagueId);
  const queue = useDraftQueue(leagueId);
  // Auto-start (3c-2): the shared hook (Home uses it too); only the lobby
  // asks the server to start at 0:00.
  const auto = useDraftAutoStart(leagueId, { kick: true });
  const { ds, view, serverNow } = auto;

  const commissionerName =
    data.members.find((m) => m.userId === activeLeague?.commissioner_id)?.displayName || COMMISSIONER_FALLBACK;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ShellHeader title="League" showAvatar />
      <BarsRefresh
        onRefresh={async () => {
          auto.reread();
          await refresh();
        }}
        contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[6] }}
      >
        {ds.status === 'error' ? (
          <Card style={styles.queueFailed}>
            <Text variant="callout">{DRAFT_STATUS_LOAD_FAILED}</Text>
            <Button label="Try again" variant="secondary" size="sm" onPress={auto.reread} />
          </Card>
        ) : null}

        {view?.blockers ? (
          <AutoStartBlockers
            auto={auto}
            phase={view.blockers}
            playoffTeams={activeLeague?.playoff_teams ?? null}
            inviteCode={activeLeague?.invite_code ?? null}
          />
        ) : null}

        {view?.deadline && ds.startsAt ? (
          (() => {
            const d = deadlineCopy(ds.startsAt, serverNow);
            return <DraftCountdownCard tag={d.tag} clock={d.clock} lines={[]} notes={[d.line]} />;
          })()
        ) : null}

        {view?.countdown && ds.startsAt ? (
          (() => {
            const c = countdownCopy(view.countdown, ds.startsAt, serverNow);
            return (
              <DraftCountdownCard
                tag={c.tag}
                clock={c.clock}
                live={view.countdown !== 'scheduled'}
                starting={c.starting}
                lines={c.lines.slice(0, 1)}
                notes={[...c.lines.slice(1), ...(auto.retrying && c.starting ? [START_RETRYING] : [])]}
              />
            );
          })()
        ) : null}

        {view?.memberPostponed ? (
          (() => {
            const c = memberPostponedCopy(commissionerName);
            return <DraftCountdownCard tag={c.tag} title={c.title} lines={[]} notes={[c.line]} />;
          })()
        ) : null}

        {view?.noDate ? (
          <DraftCountdownCard tag={NO_DATE_TITLE} lines={[]} notes={[noDateCopy(ds.isCommissioner, commissionerName)]} />
        ) : null}

        {!data.loading && (view?.order ?? true) ? (
          <DraftLobby
            data={data}
            myUserId={user?.id ?? ''}
            draftDate={activeLeague?.draft_date ?? null}
            pickSeconds={activeLeague?.pick_seconds ?? 60}
            rounds={activeLeague?.num_rounds ?? 6}
            now={new Date(serverNow)}
            showCountdown={false}
          />
        ) : null}

        {/* Board (Draft lobby · "Your queue"): build the queue before the draft,
            so auto-pick has it from the first pick. Never seeded from a failed
            read (draftQueueRead.ts): the save replaces the whole list. */}
        {queue.status === 'ready' ? (
          <QueueEditor key={queue.version} leagueId={leagueId} initial={queue.queue} onSaved={queue.refresh} />
        ) : queue.status === 'error' ? (
          <Card style={styles.queueFailed}>
            <Text variant="callout">{QUEUE_LOAD_FAILED}</Text>
            <Button label="Try again" variant="secondary" size="sm" onPress={queue.refresh} />
          </Card>
        ) : null}

        {/* Board (RibHistory): League settings is a row on the pre-draft League
            tab. Commissioner only, the same check League settings itself makes. */}
        {showsLeagueSettingsRow(activeLeague?.commissioner_id, user?.id) ? (
          <SetupCard>
            <SettingRow
              label="League settings"
              onPress={() => router.push({ pathname: '/league-settings', params: { leagueId } })}
            />
          </SetupCard>
        ) : null}
      </BarsRefresh>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  queueFailed: { borderRadius: 14, padding: space[5], gap: space[3], alignItems: 'flex-start' },
});
