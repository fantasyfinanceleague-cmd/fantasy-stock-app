import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactElement } from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';

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
import { HomeSeason } from '@/components/home/HomeSeason';
import { StandingsCard, type StandingRow } from '@/components/home/StandingsCard';
import { PreDraftCard } from '@/components/home/PreDraftCard';
import { DraftingCard } from '@/components/home/DraftingCard';
import { SeasonCompleteCard } from '@/components/home/SeasonCompleteCard';
import { RunItBackCard } from '@/components/home/RunItBackCard';
import { HomeRenewalAsk } from '@/components/game/HomeRenewalAsk';
import { RenewalCountsCard } from '@/components/home/RenewalCountsCard';
import { heldFullRoster, homeRepliesPending, runItBackEnabled } from '@/lib/game/renewal';
import { RENEWAL_FIXTURE_CALLER, useRenewalRoster } from '@/lib/game/useRenewalRoster';

import { PhaseMessageCard } from '@/components/home/PhaseMessageCard';
import { HomeSkeleton } from '@/components/game/LoadingSkeletons';
import { PhaseTransition } from '@/components/home/PhaseTransition';
import { HomeLeagueTransition } from '@/components/home/HomeLeagueTransition';
import type { PhaseResult } from '@/lib/home/homePhase';
import {
  MARKET_CLOSED_CHIP, SCORING_CHIP, SCORED_CHIP, LIVE_CHIP, endsAtLabel, marketClosedAt, marketResumesAt,
  PRE_SEASON_CAPTION, PRE_SEASON_TAG, PRE_SEASON_CHIP, preSeasonStartsLabel, BYE_MESSAGE, byeNextWeekLabel,
  byeToRoundLabel, eliminatedLabel, SEE_THE_BRACKET, scoredResultLine, nextWeekStartsLabel,
  MISSED_PLAYOFFS_MESSAGE, THIS_WEEK_TAG, heroWeekOrRoundLabel, playoffPendingLine,
  standingsThroughWeek,
} from '@/lib/home/homeCopy';
import { seasonOverPrimary } from '@/lib/home/calmHome';
import { resultFromGains } from '@/lib/home/weekMarks';

/** Run it back stays off until its backend (PR #94) is live: see runItBackEnabled. */
const RUN_IT_BACK_ON = runItBackEnabled(process.env.EXPO_PUBLIC_RUN_IT_BACK);

// `rightLabel` for live/closed states is derived from the phase's own
// `weekEnd`/`resumesAt` (never a hardcoded literal — code review,
// 2026-09-29 found "Ends Fri 4:00 PM ET" as a constant, wrong on any
// holiday-shifted week). Takes the whole phase, not just its kind, so it
// has the real timestamps to format.
function thisWeekChrome(phase: PhaseResult, week: number): { isLive: boolean; rightLabel: string; leadSuffix?: string; liveChipLabel: string; tag: string } {
  const tag = phase.kind !== 'missed_playoffs' && 'isPlayoff' in phase && phase.isPlayoff && 'round' in phase && phase.round ? phase.round : THIS_WEEK_TAG;
  switch (phase.kind) {
    case 'live_open':
      // A calm Home: "Live", playoff or not. The week is in the hero's meta.
      return { isLive: true, rightLabel: endsAtLabel(phase.weekEnd), liveChipLabel: LIVE_CHIP, tag };
    case 'live_closed':
      // R2 (Design Lead, 2026-09-30): the actual last-closed session, not
      // `weekEnd` (always Friday) -- a Tuesday-evening after-hours state
      // used to read "…at Friday's close" three days early. The close is
      // the tail of the LEAD line ("You lead by $X at Wednesday's close");
      // the right side carries only the resume time, one sentence per side.
      return {
        isLive: false,
        rightLabel: marketResumesAt(phase.resumesAt),
        leadSuffix: marketClosedAt(phase.lastCloseAt ?? phase.weekEnd),
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

/** The commissioner's Season 2 Home before the draft (board RibHomeCounts): ONE roster read,
 * shared by the counts card (R4) and PreDraftCard, which drops its draft block while
 * replies are pending (GS-11). Re-read whenever Home comes back into focus, so the block
 * returns once the last reply has landed. */
function RenewedPreDraftHome({ successorId, preDraft }: { successorId: string; preDraft: ComponentProps<typeof PreDraftCard> }) {
  const [readKey, setReadKey] = useState(0);
  const focused = useRef(false);
  useFocusEffect(
    useCallback(() => {
      // The first focus is the mount's own read.
      if (focused.current) setReadKey((k) => k + 1);
      focused.current = true;
    }, []),
  );
  const st = useRenewalRoster(successorId, RENEWAL_FIXTURE_CALLER, readKey);
  const roster = heldFullRoster(st);
  return (
    <>
      {roster ? <RenewalCountsCard roster={roster} /> : null}
      <PreDraftCard {...preDraft} repliesPending={homeRepliesPending(st)} />
    </>
  );
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
    // UX rule 9 (3c-2): the shape of Home while it loads, placeholders only,
    // never numbers.
    return <HomeSkeleton />;
  }

  const { phase, hero: heroVm, thisWeek, standings, myUserId, season, weeklyResults } = viewModel;

  // States 6/7: no money views at all — the draft's own cards.
  if (phase.kind === 'pre_draft') {
    if (!league) return null;
    const preDraft: ComponentProps<typeof PreDraftCard> = {
      leagueId: leagueId!,
      inviteCode: league.invite_code,
      pickSeconds: league.pick_seconds,
      numRounds: league.num_rounds,
      draftDate: league.draft_date,
      numParticipants: league.num_participants,
    };
    // R4: the commissioner of a renewed league sees the counts while replies come in (GS-11: and no draft block).
    return RUN_IT_BACK_ON && league.previous_league_id && league.commissioner_id === myUserId
      ? <RenewedPreDraftHome successorId={leagueId!} preDraft={preDraft} />
      : <PreDraftCard {...preDraft} />;
  }
  if (phase.kind === 'drafting') {
    return league ? <DraftingCard leagueId={leagueId!} myUserId={myUserId} numRounds={league.num_rounds} /> : null;
  }
  // State 8: no money views — the honest-minimum season-complete tiles
  // (get_season_result upgrades this in place once merged; see the
  // component's own doc).
  if (phase.kind === 'complete') {
    const myStanding = standings.find((s) => s.user_id === myUserId);
    // One primary on the screen: Run it back (commissioner) or the ask (member).
    const primary = seasonOverPrimary({
      runItBackOn: RUN_IT_BACK_ON,
      isCommissioner: league?.commissioner_id === myUserId,
      hasSuccessor: !!league?.successor_league_id,
    });
    return (
      <>
      <SeasonCompleteCard
        leagueId={leagueId!}
        leagueName={league?.name ?? 'your league'}
        seasonNumber={null}
        finalRank={myStanding?.rank ?? 0}
        standingsCount={standings.length}
        myUserId={myUserId}
        standings={standings}
        wins={myStanding?.wins ?? 0}
        losses={myStanding?.losses ?? 0}
        ties={myStanding?.ties ?? 0}
        seasonGain={myStanding?.points_for ?? 0}
        playoffTeams={league?.playoff_teams ?? null}
        // phase.numWeeks, not league.num_weeks (B7 bullet 3): the value that
        // decided this phase's own round labels. In the dev fixtures, league
        // and phase are two independent axes with their own numbers.
        numWeeks={phase.numWeeks}
      />
      {primary === 'run_it_back' ? <RunItBackCard /> : null}
      {/* Board #run-it-back frame 1: members are asked on Home too, until they answer. */}
      {primary === 'renewal_ask' && league?.successor_league_id ? (
        <HomeRenewalAsk
          successorId={league.successor_league_id}
          isCommissioner={false}
          commissionerName={standings.find((s) => s.user_id === league.commissioner_id)?.display_name || 'Your commissioner'}
        />
      ) : null}
    </>
    );
  }

  if (!heroVm) {
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
    // B3 (Design Lead, 2026-09-30): the board's HomePreSeason is a real
    // scoreboard PREVIEW -- both team names, $0.00/$0.00 in zero grey --
    // not a plain message card with no opponent shown at all.
    middleCard = (
      <ThisWeekCard
        week={1}
        isLive={false}
        you={{ gain: thisWeek?.you.gain ?? 0, pct: 0 }}
        opponent={{ gain: thisWeek?.opponent.gain ?? 0, pct: 0 }}
        opponentName={opponentName}
        rightLabel=""
        tag={PRE_SEASON_TAG}
        liveChipLabel={PRE_SEASON_CHIP}
        preSeason
        scoringMessage={PRE_SEASON_CAPTION}
      />
    );
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
          leadSuffix={chrome.leadSuffix}
          liveChipLabel={chrome.liveChipLabel}
          tag={chrome.tag}
        />
      );
    }
  }

  const showSeason = !!season && !['pre_season'].includes(phase.kind);
  // B2/B3 (Design Lead, 2026-09-30): the board has no Standings card at
  // all before the season starts — there's no record yet to show.
  const showStandingsCard = !['pre_season'].includes(phase.kind);

  // The current week's posted result, when it is a scored week (its axis mark).
  const currentScored = phase.kind === 'scored' && thisWeek ? resultFromGains(thisWeek.you.gain, thisWeek.opponent.gain) : null;
  const hero = (
    <HomeHero
      leagueId={leagueId ?? ''}
      rank={phase.kind === 'pre_season' ? null : myRow?.rank ?? 0}
      totalPlayers={standingRows.length}
      record={record}
      weekOrRound={heroWeekOrRoundLabel(phase)}
      value={heroVm.value}
      seasonGainDollars={heroVm.seasonGainDollars}
      seasonGainPct={heroVm.seasonGainPct}
      today={heroVm.today}
      unpricedValue={heroVm.unpricedValue}
      unpricedToday={heroVm.unpricedToday}
      preSeasonLabel={phase.kind === 'pre_season' ? preSeasonStartsLabel(phase.seasonStartsAt) : null}
      skipEntrance={skipEntrance}
    />
  );

  return (
    <>
      {/* A calm Home (2026-10-12): the hero block is the hero, then the season chart
          and its range tabs, with no card (the old Season card). Team value is the
          ONE standout number. Pre-season stays hero only. */}
      {showSeason ? (
        <View style={{ gap: space[3] }}>
          {hero}
          <HomeSeason
            series={season!}
            // Regular-season byes are NO RESULT (Giorgio, 2026-09-29): never
            // coloured green/red as a win or loss; the axis reads "Bye" (or "–").
            weekResults={weeklyResults.map((w) => ({ week: w.week, result: w.result }))}
            currentWeek={week}
            marketOpen={chrome.isLive}
            // B′ (Design Lead, 2026-10-12): in the playoffs the line's end is the
            // static dot; season gain is frozen at its regular-season total.
            isPlayoff={'isPlayoff' in phase && !!phase.isPlayoff}
            currentScored={currentScored}
            skipEntrance={skipEntrance}
          />
        </View>
      ) : hero}
      {middleCard ? <PhaseTransition key={phase.kind}>{middleCard}</PhaseTransition> : null}
      {showStandingsCard ? (
        <StandingsCard rows={standingRows} throughWeek={standingsThroughWeek(phase)} skipEntrance={skipEntrance} />
      ) : null}
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
  // B2-H2 fix (Design Lead gate, 2026-10-05): the flag flips once Home has
  // SHOWN content, not merely when a league is active. Before, the flag was
  // set while the data was still loading, so the chart's first real mount
  // always read skipEntrance: true and the first-view draw-in never ran.
  const hasOpenedRef = useRef(false);
  const skipEntrance = hasOpenedRef.current;
  useEffect(() => {
    if (activeLeagueId && viewModel) hasOpenedRef.current = true;
  }, [activeLeagueId, viewModel]);

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
        {/* 24pt between Home's blocks (a calm Home, 2026-10-12), on the wrapper that holds
            them (PR #217). Never compressed to win back the 17e's fold. */}
        <HomeLeagueTransition key={activeLeagueId ?? 'none'} style={{ gap: space[7] }}>
          <HomeBody status={status} viewModel={viewModel} league={activeLeague} leagueId={activeLeagueId} onRefresh={refresh} skipEntrance={skipEntrance} />
        </HomeLeagueTransition>
      </BarsRefresh>
    </View>
  );
}
