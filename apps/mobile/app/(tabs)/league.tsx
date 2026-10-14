/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet, Alert, useWindowDimensions } from 'react-native';
import { Icon } from '@/components/sp/Icon';
import { router, useLocalSearchParams } from 'expo-router';

import { radius, space } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Text } from '@/components/sp/Text';
import { PhasePlaceholder } from '@/components/shell/PhasePlaceholder';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { BarsRefresh } from '@/components/shell/BarsRefresh';
import { StandingsRowView, StandingsTable, useStandingsLayout } from '@/components/game/StandingsTable';
import { SegmentTabs } from '@/components/sp/gn';
import { LoadFailed, TilesSkeleton } from '@/components/league/LeagueStates';
import { BRACKET_LOAD_FAILED, HISTORY_LOAD_FAILED, LEAGUES_LOAD_FAILED, leagueFallback, leagueThroughWeek, standingsColumnLabel } from '@/lib/game/leagueView';
import { COPY as MONEY_COPY } from '@/lib/money/moneyCopy';
import { useLeagueContext } from '@/lib/LeagueContext';
import { playoffLine } from '@/lib/playoffs';
import { buildSchedule } from '@/lib/game/schedule';
import { ScheduleList } from '@/components/game/ScheduleList';
import { BracketView } from '@/components/game/BracketView';
import { DraftLobby } from '@/components/game/DraftLobby';
import { DraftRoom } from '@/components/game/DraftRoom';
import { LeagueRenewal } from '@/components/game/LeagueRenewal';
import { HomeRenewalAsk } from '@/components/game/HomeRenewalAsk';
import { HistoryList } from '@/components/game/HistoryList';
import { ChampBanner } from '@/components/game/ChampBanner';
import { championBanner } from '@/lib/game/history';
import { leagueScreenFor, showRunItBackStrip, showsLeagueRenewalAsk, seasonSegments } from '@/lib/game/leaguePhase';
import { useLeagueHistory } from '@/lib/game/useLeagueHistory';
import { useSeasonPlayoffs } from '@/lib/game/useSeasonPlayoffs';
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
import { useCallback, useEffect, useState } from 'react';
import { leagueSegmentFromParam } from '@/lib/home/calmHome';
import { useLeagueStandings } from '@/lib/game/useLeagueStandings';
import { useAuth } from '@/lib/useAuth';
import { buildStandingsRows, standingsView, type StandingsRow } from '@/lib/game/standings';
import { COPY as GAME_COPY } from '@/lib/game/gameCopy';
import { SettingRow, SetupCard } from '@/components/game/SetupRows';
import { showsLeagueSettingsRow } from '@/lib/game/leagueSettingsEntry';
import { leaveLeagueEnabled } from '@/lib/game/leaveLeague';
import { runItBackEnabled } from '@/lib/game/renewal';

/** The leave flow's kill switch (item 13): members reach League settings (and Leave league) too. */
const LEAVE_LEAGUE_ON = leaveLeagueEnabled(process.env.EXPO_PUBLIC_LEAVE_LEAGUE);
/** Run it back stays off until its backend (PR #94) is live: see runItBackEnabled. */
const RUN_IT_BACK_ON = runItBackEnabled(process.env.EXPO_PUBLIC_RUN_IT_BACK);
import { QueueEditor } from '@/components/game/QueueEditor';
import { useDraftQueue } from '@/lib/game/useDraftQueue';
import { RENEWAL_FIXTURE_CALLER, useRenewalRoster } from '@/lib/game/useRenewalRoster';
import { renewalReadyForLobby } from '@/lib/game/renewalLobby';
import { QUEUE_LOAD_FAILED } from '@/lib/game/draftQueueRead';

// League (3c; Game Night W4). The standings for a season in progress, the season over and
// the playoffs. Standings order is the server's (league_standings_ranked, read through
// get_home_league); the ▲/▼ move is the through-week ranking, blank where it's unknown.
// Drafting keeps the draft-room entry (§3 IA); before the draft, the lobby or Run it back.
// With no leagues, Home's own empty state.
const SEGMENT_LABEL: Record<'standings' | 'schedule' | 'playoffs' | 'history', string> = {
  standings: 'Standings',
  schedule: 'Schedule',
  playoffs: 'Playoffs',
  history: 'History',
};

/** League's settings row stops at the gains' size (score.sm 15 × 1.3 = 19.5pt = callout 13 × 1.5), so
 * at XL no row on the tab outgrows the figures (the checklist's "The standout stays loudest"). */
const LEAGUE_ROW_MAX_SCALE = 1.5;

const STANDINGS_CAPTION = 'Ranked by win percentage, then head-to-head, then season gain. This is also the playoff seeding.';

export default function LeagueScreen() {
  const { sheetLeagues, activeLeagueId, activeLeague, refresh, setActiveLeagueId, leagues, loading, loadFailed } = useLeagueContext();
  const { width } = useWindowDimensions();
  // League's segments: Standings | Schedule | (Playoffs) | History.
  const [segment, setSegment] = useState<'standings' | 'schedule' | 'playoffs' | 'history'>('standings');
  // Home's Standings card opens League on Standings (?segment=standings), the way Matchup
  // reads 'all'. The tab stays mounted, so the param is applied when it arrives, then
  // cleared: a second tap from Home (League left on Schedule meanwhile) is a new value.
  const { segment: segmentParam } = useLocalSearchParams<{ segment?: string }>();
  useEffect(() => {
    const s = leagueSegmentFromParam(segmentParam);
    if (!s) return;
    setSegment(s);
    router.setParams({ segment: undefined });
  }, [segmentParam]);
  // UX rule 7: your standings row, pinned at the bottom while it's below the fold.
  const [pinnedRow, setPinnedRow] = useState<StandingsRow | null>(null);
  const [endingFor, setEndingFor] = useState<string | null>(null);
  const onEnding = useCallback(() => setEndingFor(activeLeagueId), [activeLeagueId]);
  // W4: every read on this tab re-reads on a pull or a Try again (it read once, on mount, so
  // "Pull down to try again" re-read nothing).
  const [reload, setReload] = useState(0);
  const phase = sheetLeagues.find((l) => l.id === activeLeagueId)?.seasonPhase;
  // The screen is the rules' choice for the phase (lib/game/leaguePhase.ts).
  const screen = activeLeague && phase ? leagueScreenFor({ phase, isRenewal: RUN_IT_BACK_ON && !!activeLeague.previous_league_id }) : 'placeholder';
  const drafting = screen === 'draft_room';
  const preDraft = (screen === 'lobby' || screen === 'renewal') && activeLeagueId !== null;
  const inSeason = screen === 'season';
  const history = useLeagueHistory(inSeason ? activeLeagueId : null, segment === 'history' && inSeason, reload);
  // GS-8: each finished season in History is ordered by its playoff result, as Standings is.
  const seasonPlayoffs = useSeasonPlayoffs(inSeason ? activeLeagueId : null, segment === 'history' && inSeason, reload);
  const { colors } = useTheme();
  const st = useLeagueStandings(inSeason ? activeLeagueId : null, reload);
  const { user } = useAuth();
  const completed = phase === 'completed';
  const bracket = useBracket(
    inSeason ? activeLeagueId : null,
    activeLeague?.playoff_teams ?? null,
    st.standings.map((x) => ({ user_id: x.user_id, rank: x.rank, display_name: x.display_name })),
    // GS-4: a finished season's Standings follow the playoff result, so they read the bracket too.
    segment === 'playoffs' || (completed && segment === 'standings'),
    reload,
  );
  const onPull = useCallback(async () => {
    setReload((k) => k + 1);
    await refresh();
  }, [refresh]);
  const retry = useCallback(() => setReload((k) => k + 1), []);

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
    // Read the list FIRST, then switch: switching first left the tab with an id that wasn't in
    // the list yet, so it fell through to "No leagues yet" for a moment (W4 DL gate, P1).
    await refresh();
    setActiveLeagueId(res.league_id);
  };
  const isCommissioner = !!user?.id && activeLeague?.commissioner_id === user.id;

  // U-10: the room (its ending) stays once the last pick lands, even after the
  // server finishes the draft and the phase moves on, until "See your Week 1 matchup".
  if ((drafting || endingFor === activeLeagueId) && activeLeagueId && activeLeague) {
    return (
      <LeagueDraftRoom
        leagueId={activeLeagueId}
        rounds={activeLeague.num_rounds ?? 6}
        onEnding={onEnding}
        onEndingDone={() => setEndingFor(null)}
      />
    );
  }

  if (inSeason) {
    if (st.status === 'error') {
      // showAvatar: Profile stays reachable from the failed state too (W4 DL gate).
      return <PhasePlaceholder title="League" showAvatar icon={() => <Icon name="alert" size="title" tone="text2" />} heading="Couldn't load the standings" message="Pull down to try again." onRefresh={onPull} />;
    }
    const ready = st.status === 'ready';
    const rows = buildStandingsRows(st.standings, user?.id ?? '', st.previousRanks);
    const standings = standingsView({ rows, completed, playoffTeams: activeLeague?.playoff_teams ?? null, bracketStatus: bracket.status, playoffRows: bracket.rows });
    // "Through Week N" agrees with Home's card (leagueView.leagueThroughWeek); hidden at N = 0.
    const throughWeek = leagueThroughWeek({ phase: phase ?? 'regular', week: st.week, numWeeks: activeLeague?.num_weeks ?? null });
    const throughLabel = standingsColumnLabel(throughWeek);
    const contentWidth = width - space[6] * 2;
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ShellHeader title="League" showAvatar />
        <BarsRefresh onRefresh={onPull} contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[6] }}>
          <View style={styles.stack}>
            {ready && RUN_IT_BACK_ON && phase && showRunItBackStrip({ phase, isCommissioner, hasSuccessor: !!activeLeague?.successor_league_id }) ? (
              <Card style={styles.strip}>
                <Text variant="headline">You're the commissioner</Text>
                {/* 1.5× at most: at XL the uncapped line outgrew its heading and the button (W4 DL gate). */}
                <Text variant="callout" tone="secondary" maxFontSizeMultiplier={1.5}>Start Season 2 with the same group. Season 1 stays in History.</Text>
                <Button label="Run it back" onPress={() => void runItBack()} />
              </Card>
            ) : null}
            {/* Board #run-it-back frame 1 (and GS-14): the member's ask sits on the League tab too. */}
            {ready && RUN_IT_BACK_ON && phase && activeLeague?.successor_league_id && showsLeagueRenewalAsk({ phase, isCommissioner, hasSuccessor: true }) ? (
              <HomeRenewalAsk
                successorId={activeLeague.successor_league_id}
                isCommissioner={false}
                commissionerName={st.standings.find((x) => x.user_id === activeLeague.commissioner_id)?.display_name || 'Your commissioner'}
              />
            ) : null}
            {/* The board's League frame: the sections as text tabs, the selected one underlined. */}
            <SegmentTabs
              options={seasonSegments({ phase: phase ?? 'regular', playoffTeams: activeLeague?.playoff_teams ?? null }).map((v) => ({
                label: SEGMENT_LABEL[v],
                value: v,
              }))}
              value={segment}
              onChange={(v) => setSegment(v)}
              width={contentWidth}
            />
            {segment === 'history' ? (
              history.status === 'error' || seasonPlayoffs.status === 'error' ? (
                <LoadFailed line={HISTORY_LOAD_FAILED} onRetry={retry} />
              ) : history.status === 'ready' ? (
                <HistoryList rows={history.rows} myUserId={user?.id ?? ''} playoffs={seasonPlayoffs.status === 'ready' ? seasonPlayoffs.byLeague : null} />
              ) : (
                <TilesSkeleton />
              )
            ) : !ready ? (
              <TilesSkeleton />
            ) : segment === 'playoffs' ? (
              bracket.status === 'error' ? (
                <LoadFailed line={BRACKET_LOAD_FAILED} onRetry={retry} />
              ) : bracket.bracket ? (
                <BracketView
                  bracket={bracket.bracket}
                  myUserId={user?.id ?? ''}
                  caption={activeLeague?.playoff_teams ? `The top ${activeLeague.playoff_teams} in the standings make the playoffs. A tied game goes to the higher seed.` : null}
                />
              ) : (
                <TilesSkeleton rows={4} />
              )
            ) : segment === 'standings' ? (
              standings.kind === 'final' ? (
                <StandingsTable
                  rows={standings.rows}
                  header={{ title: GAME_COPY.finalStandingsTitle, subtitle: GAME_COPY.finalStandingsSubtitle }}
                  caption={GAME_COPY.finalStandingsCaption}
                  seasonComplete
                  showMove={false}
                  // "After the playoffs" says what this order is; no "Through Week N" beside it (W4 DL gate).
                  throughLabel={null}
                  onPinChange={setPinnedRow}
                />
              ) : standings.kind === 'regular' ? (
                <StandingsTable rows={standings.rows} caption={STANDINGS_CAPTION} seasonComplete={standings.medals} throughLabel={throughLabel} nothingScored={throughWeek === 0} onPinChange={setPinnedRow} />
              ) : (
                // GS-4: a finished season's order waits for the bracket (never the regular medals first).
                <TilesSkeleton rows={Math.max(1, rows.length)} />
              )
            ) : (
              <ScheduleList
                rows={buildSchedule({ myUserId: user?.id ?? '', currentWeek: st.week ?? 1, numWeeks: activeLeague?.num_weeks ?? 0, names: st.standings.map((x) => ({ user_id: x.user_id, display_name: x.display_name })), matchups: st.data?.matchups ?? [] })}
                playoffLine={playoffLine(activeLeague?.playoff_teams)}
              />
            )}
            {/* Item 13: League settings (Leave league: locked in mid-season, hide after it), leave flow on only. */}
            {ready && LEAVE_LEAGUE_ON && activeLeagueId && showsLeagueSettingsRow(activeLeague?.commissioner_id, user?.id, true) ? (
              <SetupCard>
                <SettingRow
                  label="League settings"
                  maxScale={LEAGUE_ROW_MAX_SCALE}
                  onPress={() => router.push({ pathname: '/league-settings', params: { leagueId: activeLeagueId } })}
                />
              </SetupCard>
            ) : null}
          </View>
        </BarsRefresh>
        {pinnedRow && segment === 'standings' && standings.kind !== 'loading' ? (
          <PinnedRow row={pinnedRow} rows={standings.rows} seasonComplete={standings.kind === 'final' || (standings.kind === 'regular' && standings.medals)} showMove={standings.kind !== 'final'} />
        ) : null}
      </View>
    );
  }

  if (RUN_IT_BACK_ON && preDraft && activeLeagueId && activeLeague?.previous_league_id) {
    return <RenewedPreDraft leagueId={activeLeagueId} createdAt={activeLeague.created_at ?? new Date().toISOString()} />;
  }
  if (preDraft && activeLeagueId) {
    return <LeagueLobby leagueId={activeLeagueId} />;
  }

  // The empty state only for someone who truly has no leagues (leagueFallback). While the list
  // loads, or while a just-switched league isn't in it yet (Run it back), the header and the
  // tiles' skeleton: never "No leagues yet" to someone WITH leagues (W4 DL gate, P1).
  const fallback = leagueFallback({ loading, leagueCount: leagues.length, loadFailed });
  if (fallback === 'pending') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ShellHeader title="League" showAvatar />
        <View style={styles.pendingBody}>
          <TilesSkeleton />
        </View>
      </View>
    );
  }

  // The league list didn't load (gn-sweep): say so, with Try again (and the pull). Never
  // "No leagues yet" to someone whose read failed.
  if (fallback === 'failed') {
    return (
      <PhasePlaceholder
        title="League"
        showAvatar
        icon={() => <Icon name="alert" size="title" tone="text2" />}
        heading={LEAGUES_LOAD_FAILED}
        message={MONEY_COPY.loadRetryMessage}
        actionLabel={MONEY_COPY.tryAgain}
        onAction={refresh}
        onRefresh={refresh}
      />
    );
  }

  // No leagues (a read that SUCCEEDED with none): Home's own empty state, word for word, so both buttons go somewhere real (W4;
  // the old "Standings are on the way … in the next update" was stale copy).
  return (
    <PhasePlaceholder
      title="League"
      showAvatar
      icon={() => <Icon name="trophy" size="title" tone="text2" />}
      heading="No leagues yet"
      message="Create or join a league to get started."
      actionLabel="Create a league"
      onAction={() => router.push('/create-league')}
      secondaryActionLabel="Join with a code"
      onSecondaryAction={() => router.push('/join-league')}
      onRefresh={refresh}
    />
  );
}

/** UX rule 7: your row pinned over the bottom of the standings, the SAME row component on
 * the list's own layout (its stacking and caps). Game Night depth: no drop shadow in Dark;
 * the tile's `rim` is its edge in both themes. */
function PinnedRow({ row, rows, seasonComplete, showMove }: { row: StandingsRow; rows: StandingsRow[]; seasonComplete: boolean; showMove: boolean }) {
  const { colors } = useTheme();
  const layout = useStandingsLayout(rows, showMove, seasonComplete);
  return (
    // An opaque `bg` band from the pinned row down to the tab bar, so no half-cut glyph of the
    // list shows through the strip under it (W4 DL gate).
    <View style={[styles.pinned, { backgroundColor: colors.bg }]} pointerEvents="box-none">
      <View style={[styles.pinnedCard, { borderColor: colors.rim }]}>
        <StandingsRowView r={row} seasonComplete={seasonComplete} showMove={showMove} layout={layout} />
      </View>
    </View>
  );
}

/** A renewed league before its draft (3c-2): the Run it back flow until the
 * renewal is reconciled and the season is set, then the normal pre-draft lobby
 * (the countdown, the queue, League settings), per the board's Season 2
 * League tab → "Go to the draft lobby". See renewalReadyForLobby. */
function RenewedPreDraft({ leagueId, createdAt }: { leagueId: string; createdAt: string }) {
  const { activeLeague, refresh } = useLeagueContext();
  const [rosterKey, setRosterKey] = useState(0);
  const roster = useRenewalRoster(leagueId, RENEWAL_FIXTURE_CALLER, rosterKey);
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
function LeagueDraftRoom({ leagueId, rounds, onEnding, onEndingDone }: { leagueId: string; rounds: number; onEnding: () => void; onEndingDone: () => void }) {
  const { refresh, activeLeague, marketCalendar } = useLeagueContext();
  const { user } = useAuth();
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ShellHeader title="League" showAvatar />
      <BarsRefresh onRefresh={refresh} contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[6] }}>
        <DraftRoom
          leagueId={leagueId}
          myUserId={user?.id ?? ''}
          rounds={rounds}
          // The same commissioner check as the settings row (a missing id never matches).
          isCommissioner={showsLeagueSettingsRow(activeLeague?.commissioner_id, user?.id)}
          stakeMode={activeLeague?.stake_mode ?? null}
          budgetAmount={activeLeague?.budget_amount ?? null}
          notionalPerSlot={activeLeague?.notional_per_slot ?? null}
          marketCalendar={marketCalendar}
          onEnding={onEnding}
          onSeeMatchup={({ all }) => {
            onEndingDone();
            void refresh();
            // A Week 1 bye has no matchup of yours: All matchups (Design Lead, ruled).
            router.push(all ? { pathname: '/(tabs)/matchup', params: { segment: 'all' } } : '/(tabs)/matchup');
          }}
        />
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
        // 16pt between the lobby's blocks, the draft room's own gap (Design Lead, Draft gate item 4).
        contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[5] }}
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
            const c = memberPostponedCopy(commissionerName, 'lobby');
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
            tab. The commissioner; every member with the leave flow on (item 13). */}
        {showsLeagueSettingsRow(activeLeague?.commissioner_id, user?.id, LEAVE_LEAGUE_ON) ? (
          <SetupCard>
            <SettingRow
              label="League settings"
              maxScale={LEAGUE_ROW_MAX_SCALE}
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
  pendingBody: { paddingHorizontal: space[6], paddingTop: space[3] },
  // G-6: the sp Card has no padding or radius of its own (the Run it back strip).
  strip: { borderRadius: radius.lg, padding: space[5], gap: space[2] },
  queueFailed: { borderRadius: 14, padding: space[5], gap: space[3], alignItems: 'flex-start' },
  // UX rule 7: your row, pinned over the bottom of the standings (same row component).
  pinned: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space[6], paddingTop: space[2], paddingBottom: space[3] },
  pinnedCard: { borderRadius: radius.row, borderWidth: 1, overflow: 'hidden' },
});
