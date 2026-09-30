import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { space } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';
import { PhasePlaceholder } from '@/components/shell/PhasePlaceholder';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { BarsRefresh } from '@/components/shell/BarsRefresh';
import { useLeagueContext } from '@/lib/LeagueContext';
import type { HomeSummaryRow } from '@/lib/LeagueContext';
import { useHomeLeague } from '@/lib/home/useHomeLeague';
import { HomeHero } from '@/components/home/HomeHero';
import { ThisWeekCard } from '@/components/home/ThisWeekCard';
import { SeasonCard } from '@/components/home/SeasonCard';
import { StandingsCard, type StandingRow } from '@/components/home/StandingsCard';
import { ENDS_FRIDAY_LABEL, MARKET_CLOSED_CHIP, SCORING_CHIP, SCORED_CHIP } from '@/lib/home/homeCopy';

function thisWeekChrome(phaseKind: string, week: number): { isLive: boolean; rightLabel: string; liveChipLabel: string } {
  switch (phaseKind) {
    case 'live_open':
      return { isLive: true, rightLabel: ENDS_FRIDAY_LABEL, liveChipLabel: `Week ${week} · Live` };
    case 'live_closed':
      return { isLive: false, rightLabel: ENDS_FRIDAY_LABEL, liveChipLabel: MARKET_CLOSED_CHIP };
    case 'scoring':
      return { isLive: false, rightLabel: '', liveChipLabel: SCORING_CHIP };
    case 'scored':
      return { isLive: false, rightLabel: '', liveChipLabel: SCORED_CHIP };
    default:
      return { isLive: false, rightLabel: '', liveChipLabel: `Week ${week}` };
  }
}

function HomeBody({
  status,
  viewModel,
  summary,
  leagueId,
  onRefresh,
}: {
  status: string;
  viewModel: ReturnType<typeof useHomeLeague>['viewModel'];
  summary: HomeSummaryRow | null;
  leagueId: string | null;
  onRefresh: () => Promise<void>;
}) {
  if (status === 'loading' || !viewModel) {
    // A skeleton card is a later polish item; an empty body while loading
    // is honest and never fabricates numbers.
    return null;
  }
  if (status === 'error') {
    return (
      <PhasePlaceholder
        title="Home"
        icon={(p) => <Ionicons name="alert-circle-outline" {...p} />}
        heading="Couldn't load this league"
        message="Pull down to try again."
        onRefresh={onRefresh}
      />
    );
  }

  const { phase, hero, thisWeek, standings, myUserId, season, weeklyResults } = viewModel;

  // States 6/7/8 (pre_draft, drafting, complete) have no money views yet —
  // Task 8 replaces this branch with the real phase cards (pick clock,
  // draft order, the get_season_result-backed season-complete tiles).
  if (!hero) {
    return (
      <PhasePlaceholder
        title="Home"
        icon={(p) => <Ionicons name="hourglass-outline" {...p} />}
        heading={phase.kind === 'complete' ? 'Season complete' : phase.kind === 'drafting' ? 'Draft in progress' : 'Before the draft'}
        message="This state's full card is coming in the next update."
        onRefresh={onRefresh}
      />
    );
  }

  const week = 'week' in phase ? phase.week : 0;
  const chrome = thisWeekChrome(phase.kind, week);

  const standingRows: StandingRow[] = standings.map((s) => ({
    userId: s.user_id,
    rank: s.rank,
    wins: s.wins,
    losses: s.losses,
    ties: s.ties,
    pointsFor: s.points_for,
    displayName: s.display_name,
    isBot: s.is_bot,
    isYou: s.user_id === myUserId,
  }));
  const myRow = standingRows.find((r) => r.isYou);
  const record = myRow ? `${myRow.wins}–${myRow.losses}${myRow.ties ? `–${myRow.ties}` : ''}` : '';

  // The opponent's name/bot flag come from get_home_summary (the current
  // matchup's two slots), not from the standings list — a standings row
  // can be absent from the displayed top-3+you, but the opponent is
  // always known from the summary whenever `thisWeek` is non-null.
  const opponentName = summary
    ? summary.team1_user_id === myUserId
      ? summary.team2_display_name ?? 'Opponent'
      : summary.team1_display_name ?? 'Opponent'
    : 'Opponent';

  return (
    <>
      <HomeHero
        leagueId={leagueId ?? ''}
        rank={myRow?.rank ?? 0}
        totalPlayers={standingRows.length}
        record={record}
        week={week}
        numWeeks={phase.numWeeks ?? 0}
        value={hero.value}
        seasonGainDollars={hero.seasonGainDollars}
        seasonGainPct={hero.seasonGainPct}
        today={hero.today}
      />
      {thisWeek ? (
        <ThisWeekCard
          week={week}
          isLive={chrome.isLive}
          you={thisWeek.you}
          opponent={thisWeek.opponent}
          opponentName={opponentName}
          rightLabel={chrome.rightLabel}
          liveChipLabel={chrome.liveChipLabel}
        />
      ) : null}
      {season ? (
        <SeasonCard
          series={season}
          // Regular-season byes are NO RESULT (Giorgio, 2026-09-29): never
          // shown as a W/L chip.
          weekResults={weeklyResults
            .filter((w): w is typeof w & { result: 'W' | 'L' | 'T' } => w.result !== 'BYE')
            .map((w) => ({ week: w.week, result: w.result }))}
          currentWeek={week}
          isLive={chrome.isLive}
        />
      ) : null}
      <StandingsCard rows={standingRows} numWeeks={phase.numWeeks ?? 0} />
    </>
  );
}

// Phase 3b-2: Home = the league picked in the pill (Concept B), rendering
// the ONE hero card keyed by homePhase. The 3b-1 header (pill + avatar)
// and no-leagues carded EmptyState are unchanged from that phase.
//
// Layout note (carry-over 1, the 3b-1 review — "Home's content must start
// below the real header height, measured not hard-coded"): ShellHeader and
// the scrollable body below are plain FLEXBOX SIBLINGS in a column, never
// an absolutely-positioned header over content, so there is nothing to
// measure or offset in the first place — a taller header (the pill
// wrapping the league name at Accessibility XL) simply pushes the body
// down, by ordinary layout, with no extra code and no jump.
export default function HomeScreen() {
  const { leagues, loading, refresh, activeLeagueId } = useLeagueContext();
  const { colors } = useTheme();
  const { status, viewModel, summary } = useHomeLeague(activeLeagueId);

  // First load (e.g. just signed in): just the header, so neither state
  // flashes and then swaps for the other.
  if (loading && leagues.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ShellHeader title="Home" showAvatar />
      </View>
    );
  }

  if (!loading && leagues.length === 0) {
    return (
      <PhasePlaceholder
        title="Home"
        showAvatar
        icon={(p) => <Ionicons name="trophy-outline" {...p} />}
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ShellHeader title="Home" showAvatar />
      <BarsRefresh onRefresh={refresh} contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[6] }}>
        <HomeBody status={status} viewModel={viewModel} summary={summary} leagueId={activeLeagueId} onRefresh={refresh} />
      </BarsRefresh>
    </View>
  );
}
