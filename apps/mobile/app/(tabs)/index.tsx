import { useEffect, useRef, type ReactElement } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

import { space } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';
import { PhasePlaceholder } from '@/components/shell/PhasePlaceholder';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { BarsRefresh } from '@/components/shell/BarsRefresh';
import { useLeagueContext } from '@/lib/LeagueContext';
import type { League } from '@/lib/LeagueContext';
import { useHomeLeague } from '@/lib/home/useHomeLeague';
import { HomeHero } from '@/components/home/HomeHero';
import { ThisWeekCard } from '@/components/home/ThisWeekCard';
import { SeasonCard } from '@/components/home/SeasonCard';
import { StandingsCard, type StandingRow } from '@/components/home/StandingsCard';
import { PreDraftCard } from '@/components/home/PreDraftCard';
import { DraftingCard } from '@/components/home/DraftingCard';
import { SeasonCompleteCard } from '@/components/home/SeasonCompleteCard';
import { PhaseMessageCard } from '@/components/home/PhaseMessageCard';
import { PhaseTransition } from '@/components/home/PhaseTransition';
import { HomeLeagueTransition } from '@/components/home/HomeLeagueTransition';
import type { PhaseResult } from '@/lib/home/homePhase';
import {
  MARKET_CLOSED_CHIP, SCORING_CHIP, SCORED_CHIP, endsAtLabel, marketClosedAt, marketResumesAt,
  PRE_SEASON_NO_LEADER, PRE_SEASON_SCORING_STARTS, BYE_MESSAGE, byeNextWeekLabel,
  byeToRoundLabel, eliminatedLabel, SEE_THE_BRACKET, scoredResultLine, nextWeekStartsLabel,
  MISSED_PLAYOFFS_MESSAGE, THIS_WEEK_TAG, heroWeekOrRoundLabel, playoffPendingLine,
} from '@/lib/home/homeCopy';

// `rightLabel` for live/closed states is derived from the phase's own
// `weekEnd`/`resumesAt` (never a hardcoded literal — code review,
// 2026-09-29 found "Ends Fri 4:00 PM ET" as a constant, wrong on any
// holiday-shifted week). Takes the whole phase, not just its kind, so it
// has the real timestamps to format.
function thisWeekChrome(phase: PhaseResult, week: number): { isLive: boolean; rightLabel: string; liveChipLabel: string; tag: string } {
  const tag = phase.kind !== 'missed_playoffs' && 'isPlayoff' in phase && phase.isPlayoff && 'round' in phase && phase.round ? phase.round : THIS_WEEK_TAG;
  switch (phase.kind) {
    case 'live_open':
      return { isLive: true, rightLabel: endsAtLabel(phase.weekEnd), liveChipLabel: `Week ${week} · Live`, tag };
    case 'live_closed':
      return {
        isLive: false,
        rightLabel: `${marketClosedAt(phase.weekEnd)}${phase.resumesAt ? ` · ${marketResumesAt(phase.resumesAt)}` : ''}`,
        liveChipLabel: MARKET_CLOSED_CHIP,
        tag,
      };
    case 'scoring':
      return { isLive: false, rightLabel: '', liveChipLabel: SCORING_CHIP, tag };
    case 'scored':
      return { isLive: false, rightLabel: '', liveChipLabel: SCORED_CHIP, tag };
    default:
      return { isLive: false, rightLabel: '', liveChipLabel: `Week ${week}`, tag };
  }
}

function HomeBody({
  status,
  viewModel,
  league,
  leagueId,
  onRefresh,
  skipEntrance,
}: {
  status: string;
  viewModel: ReturnType<typeof useHomeLeague>['viewModel'];
  league: League | null;
  leagueId: string | null;
  onRefresh: () => Promise<void>;
  /** True when this Home body was mounted by a LEAGUE SWITCH, not the
   * screen's first open (H5, Design Lead ruling 2026-09-29, Blocking 1). */
  skipEntrance: boolean;
}) {
  // Error checked BEFORE the `!viewModel` fallback (code review,
  // 2026-09-29: a first-load failure has no viewModel yet, so the old
  // ordering returned a silent blank body instead of this message).
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
  if (status === 'loading' || !viewModel) {
    // A skeleton card is a later polish item; an empty body while loading
    // is honest and never fabricates numbers.
    return null;
  }

  const { phase, hero, thisWeek, standings, myUserId, season, weeklyResults } = viewModel;

  // States 6/7: no money views at all — the draft's own cards.
  if (phase.kind === 'pre_draft') {
    return league ? (
      <PreDraftCard leagueId={leagueId!} inviteCode={league.invite_code} pickSeconds={league.pick_seconds} numRounds={league.num_rounds} />
    ) : null;
  }
  if (phase.kind === 'drafting') {
    return league ? <DraftingCard leagueId={leagueId!} myUserId={myUserId} numRounds={league.num_rounds} /> : null;
  }
  // State 8: no money views — the honest-minimum season-complete tiles
  // (get_season_result upgrades this in place once merged; see the
  // component's own doc).
  if (phase.kind === 'complete') {
    const myStanding = standings.find((s) => s.user_id === myUserId);
    return (
      <SeasonCompleteCard
        leagueId={leagueId!}
        seasonNumber={null}
        finalRank={myStanding?.rank ?? 0}
        standingsCount={standings.length}
        wins={myStanding?.wins ?? 0}
        losses={myStanding?.losses ?? 0}
        ties={myStanding?.ties ?? 0}
        seasonGain={myStanding?.points_for ?? 0}
        playoffTeams={league?.playoff_teams ?? null}
        numWeeks={league?.num_weeks ?? null}
      />
    );
  }

  if (!hero) {
    // Shouldn't reach here (every remaining phase.kind builds the money
    // views), but never render nothing silently if it ever does.
    return (
      <PhasePlaceholder title="Home" icon={(p) => <Ionicons name="hourglass-outline" {...p} />} heading="One moment" message="" onRefresh={onRefresh} />
    );
  }

  const week = 'week' in phase ? phase.week : 0;
  const chrome = thisWeekChrome(phase, week);

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

  // The opponent's name/bot flag for THIS card's week — from `standings`
  // (every league member, any week) keyed by `thisWeek.opponentUserId`,
  // NOT get_home_summary (which only ever names the CURRENT week's
  // opponent). Code review, 2026-09-29: using `summary` unconditionally
  // named the WRONG opponent during the Fri-close -> next-open grace
  // period, when the card is about last week's (already-different)
  // matchup.
  const opponentName = thisWeek?.opponentUserId
    ? standings.find((s) => s.user_id === thisWeek.opponentUserId)?.display_name ?? 'Opponent'
    : 'Opponent';

  // The middle slot: the this-week card for live/scoring/scored states, or
  // a plain message card for the states the board has no scoreboard for
  // at all (pre_season, bye, and the playoff_bye/eliminated/missed
  // modifiers of state 10 — spec: "No score and no tug" for a bye; the
  // same holds for these).
  let middleCard: ReactElement | null = null;
  if (phase.kind === 'pre_season') {
    middleCard = <PhaseMessageCard lines={[PRE_SEASON_NO_LEADER, PRE_SEASON_SCORING_STARTS]} />;
  } else if (phase.kind === 'bye') {
    middleCard = <PhaseMessageCard lines={[BYE_MESSAGE, byeNextWeekLabel(week + 1, phase.nextStart)]} />;
  } else if (phase.kind === 'playoff_bye') {
    middleCard = <PhaseMessageCard lines={[byeToRoundLabel(phase.round)]} />;
  } else if (phase.kind === 'eliminated') {
    middleCard = (
      <PhaseMessageCard lines={[eliminatedLabel(phase.round)]} actionLabel={SEE_THE_BRACKET} onAction={() => router.push('/(tabs)/league')} />
    );
  } else if (phase.kind === 'missed_playoffs') {
    middleCard = <PhaseMessageCard lines={[MISSED_PLAYOFFS_MESSAGE]} />;
  } else if (phase.kind === 'playoff_pending') {
    // A real playoff row for me this week, but no named opponent yet —
    // the previous round hasn't posted (Design Lead ruling, 2026-09-30).
    // thisWeek is null here by construction (relevantRow.hasOpponent is
    // false), so this reuses the scoring-state shape directly rather than
    // needing real you/opponent data that doesn't exist yet.
    middleCard = (
      <ThisWeekCard
        week={week}
        isLive
        you={{ gain: 0, pct: 0 }}
        opponent={{ gain: 0, pct: 0 }}
        opponentName={opponentName}
        rightLabel=""
        tag={phase.round ?? THIS_WEEK_TAG}
        scoring
        scoringMessage={playoffPendingLine(phase.previousRound)}
      />
    );
  } else if (thisWeek) {
    if (phase.kind === 'scoring') {
      middleCard = (
        <ThisWeekCard week={week} isLive={false} you={thisWeek.you} opponent={thisWeek.opponent} opponentName={opponentName} rightLabel="" liveChipLabel={chrome.liveChipLabel} tag={chrome.tag} scoring />
      );
    } else if (phase.kind === 'scored') {
      // `thisWeek.won` — the AUTHORITATIVE result from the pure phase
      // module, never re-derived from the displayed gains (code review,
      // 2026-09-29: `you.gain > opponent.gain` misreads a tie as a loss,
      // since `false` there means "the opponent wins" in the old code).
      const won = thisWeek.won ?? false;
      middleCard = (
        <ThisWeekCard
          week={week}
          isLive={false}
          you={thisWeek.you}
          opponent={thisWeek.opponent}
          opponentName={opponentName}
          rightLabel={'nextStart' in phase ? nextWeekStartsLabel(week + 1, phase.nextStart) : ''}
          liveChipLabel={chrome.liveChipLabel}
          tag={chrome.tag}
          resultLine={scoredResultLine(won, week, opponentName)}
        />
      );
    } else {
      middleCard = (
        <ThisWeekCard
          week={week}
          isLive={chrome.isLive}
          you={thisWeek.you}
          opponent={thisWeek.opponent}
          opponentName={opponentName}
          rightLabel={chrome.rightLabel}
          liveChipLabel={chrome.liveChipLabel}
          tag={chrome.tag}
        />
      );
    }
  }

  const showSeasonCard = season && !['pre_season'].includes(phase.kind);

  return (
    <>
      <HomeHero
        leagueId={leagueId ?? ''}
        rank={myRow?.rank ?? 0}
        totalPlayers={standingRows.length}
        record={record}
        weekOrRound={heroWeekOrRoundLabel(phase)}
        value={hero.value}
        seasonGainDollars={hero.seasonGainDollars}
        seasonGainPct={hero.seasonGainPct}
        today={hero.today}
        unpricedValue={hero.unpricedValue}
        unpricedToday={hero.unpricedToday}
        skipEntrance={skipEntrance}
      />
      {middleCard ? <PhaseTransition key={phase.kind}>{middleCard}</PhaseTransition> : null}
      {showSeasonCard ? (
        <SeasonCard
          series={season!}
          // Regular-season byes are NO RESULT (Giorgio, 2026-09-29): never
          // shown as a W/L chip.
          weekResults={weeklyResults
            .filter((w): w is typeof w & { result: 'W' | 'L' | 'T' } => w.result !== 'BYE')
            .map((w) => ({ week: w.week, result: w.result }))}
          currentWeek={week}
          isLive={chrome.isLive}
          skipEntrance={skipEntrance}
        />
      ) : null}
      <StandingsCard rows={standingRows} throughWeek={Math.max(0, week - 1)} skipEntrance={skipEntrance} />
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
  const { leagues, loading, refresh, activeLeagueId, activeLeague } = useLeagueContext();
  const { colors } = useTheme();
  const { status, viewModel } = useHomeLeague(activeLeagueId);

  // H5 (Design Lead ruling, 2026-09-29, Blocking 1): entrance animations
  // (hero rise, chart draw-in, standings stagger) play only on Home's
  // FIRST open. `hasOpenedRef` lives above the leagueId-keyed subtree
  // (HomeLeagueTransition below), so it survives every later switch — a
  // switch reads `skipEntrance: true` on the very render that shows the
  // new league, not one render late.
  const hasOpenedRef = useRef(false);
  const skipEntrance = hasOpenedRef.current;
  useEffect(() => {
    if (activeLeagueId) hasOpenedRef.current = true;
  }, [activeLeagueId]);

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
        <HomeLeagueTransition key={activeLeagueId ?? 'none'}>
          <HomeBody status={status} viewModel={viewModel} league={activeLeague} leagueId={activeLeagueId} onRefresh={refresh} skipEntrance={skipEntrance} />
        </HomeLeagueTransition>
      </BarsRefresh>
    </View>
  );
}
