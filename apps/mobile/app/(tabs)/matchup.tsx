/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { space } from '@/constants/tokens';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Text } from '@/components/sp/Text';
import { PhasePlaceholder } from '@/components/shell/PhasePlaceholder';
import { ShellHeader } from '@/components/shell/ShellHeader';
import { BarsRefresh } from '@/components/shell/BarsRefresh';
import { MatchScoreboard } from '@/components/game/MatchScoreboard';
import { WeekRace } from '@/components/game/WeekRace';
import { Chyron } from '@/components/sp/game/Chyron';
import { useLeadChyron } from '@/lib/game/useLeadChyron';
import { raceLayout } from '@/lib/game/raceLayout';
import { useLeagueContext } from '@/lib/LeagueContext';
import { useMatchup, type MatchupDerived } from '@/lib/game/useMatchup';
import { nameOf } from '@/lib/game/buildMatchupViewModel';
import { buildMatchScoreboardModel } from '@/lib/game/matchScoreboardModel';
import { COPY } from '@/lib/game/gameCopy';
import { formatMoney } from '@/components/sp/logic/money';
import { unpricedNote } from '@/lib/plCoverage';
import {
  endsAtLabel,
  preSeasonStartsLabel,
  byeToRoundLabel,
  eliminatedLabel,
  playoffPendingLine,
} from '@/lib/home/homeCopy';
import { useAuth } from '@/lib/useAuth';
import type { LineupRow } from '@/lib/game/lineupLedger';

// Matchup (3c, key screen 2). One MatchScoreboard for the score row (the
// Design Lead's D9 ruling), Home's rules through the shared model. The lineups
// show each stock's dollar contribution, and their rows sum to the score
// exactly. A FINAL matchup shows no lineups: the server row carries the two
// gains but not per-stock week-end prices, so a per-stock final would be a
// guess (a follow-up).
export default function MatchupScreen() {
  const { activeLeagueId, activeLeague, refresh } = useLeagueContext();
  const { colors } = useTheme();
  const m = useMatchup(activeLeagueId);
  const chyron = useLeadChyron(m.derived?.live ?? null, m.quote, m.bars, m.todayIso);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ShellHeader title="Matchup" showAvatar />
      <BarsRefresh onRefresh={refresh} contentContainerStyle={{ paddingHorizontal: space[6], paddingBottom: space[9], gap: space[6] }}>
        <MatchupBody status={m.status} derived={m.derived} phase={m.phase} onRefresh={m.refresh} leagueName={activeLeague?.name ?? ''} chyron={chyron} />
      </BarsRefresh>
    </View>
  );
}

interface BodyProps {
  status: 'loading' | 'ready' | 'error' | 'no-league';
  derived: MatchupDerived | null;
  phase: import('@/lib/home/homePhase').PhaseResult | null;
  onRefresh: () => Promise<void>;
  leagueName: string;
  chyron: string | null;
}

function MatchupBody({ status, derived, phase, onRefresh, chyron }: BodyProps) {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  if (status === 'error') {
    return (
      <PhasePlaceholder title="Matchup" icon={(p) => <Ionicons name="alert-circle-outline" {...p} />} heading="Couldn't load this matchup" message="Pull down to try again." onRefresh={onRefresh} />
    );
  }
  if (status === 'loading' || !derived || !user) return null; // honest empty while loading, never a made-up number

  const { view, live, final, weekEnd, week } = derived;
  const youName = live.me.name;

  if (view.kind === 'not_started') {
    return <PhasePlaceholder title="Matchup" icon={(p) => <Ionicons name="trophy-outline" {...p} />} heading="Not started yet" message="Your matchups start when the draft is done." onRefresh={onRefresh} />;
  }

  if (view.kind === 'pre_season') {
    const model = buildMatchScoreboardModel({
      week, live: false, noLeader: true,
      me: { name: youName, gain: 0, pct: null },
      opp: live.opp ? { name: live.opp.name, gain: 0, pct: null } : null,
      endsLabel: '',
    });
    return (
      <View style={styles.stack}>
        <MatchScoreboard model={model} mineGain={0} oppGain={0} size="hero" youName={youName} oppName={live.opp?.name ?? null} statusLine={preSeasonStartsLabel(phase && phase.kind === 'pre_season' ? phase.seasonStartsAt : null)} />
      </View>
    );
  }

  if (view.kind === 'bye') {
    return <Text variant="callout" tone="secondary">{COPY.byeNoResult}</Text>;
  }

  if (view.kind === 'playoff_bye' || view.kind === 'playoff_pending' || view.kind === 'eliminated' || view.kind === 'missed_playoffs') {
    const line =
      view.kind === 'playoff_bye' ? byeToRoundLabel(view.round)
      : view.kind === 'playoff_pending' ? playoffPendingLine(view.round)
      : view.kind === 'eliminated' ? eliminatedLabel(view.round)
      : "You didn't make the playoffs.";
    return <Text variant="callout" tone="secondary">{line}</Text>;
  }

  if (view.kind === 'complete') return null;

  if (view.kind === 'scoring' || (view.kind === 'final' && final === null)) {
    return <Text variant="callout" tone="secondary">{COPY.scoringLabel}</Text>;
  }

  const isFinal = view.kind === 'final';
  const mine = isFinal && final ? final.me : live.me.gain;
  const theirs = isFinal && final ? final.opp : live.opp?.gain ?? 0;
  const model = buildMatchScoreboardModel({
    week,
    live: !isFinal,
    me: { name: youName, gain: mine, pct: isFinal ? null : live.me.pct },
    opp: live.opp ? { name: live.opp.name, gain: theirs, pct: isFinal ? null : live.opp.pct } : null,
    endsLabel: weekEnd ? endsAtLabel(weekEnd) : '',
  });
  const note = isFinal ? null : unpricedNote(live.me.unpriced.length);

  const raceWidth = width - space[6] * 2;
  return (
    <View style={styles.stack}>
      {!isFinal ? <Chyron message={chyron} /> : null}
      <MatchScoreboard
        model={model}
        mineGain={mine}
        oppGain={theirs}
        size="hero"
        youName={youName}
        oppName={live.opp?.name ?? null}
        statusLine={isFinal ? 'Final' : `Week ${week}, live`}
      />
      {!isFinal && live.opp && derived.days.length > 0 ? (
        <WeekRace
          layout={raceLayout({ days: derived.days.map((d) => d.date), mine: live.me.race, opp: live.opp.race })}
          width={raceWidth}
          a11yLabel="Week race: cumulative dollar gain by day"
        />
      ) : null}
      {note ? <Text variant="caption" tone="secondary">{note}</Text> : null}
      {!isFinal && live.opp ? (
        <View style={styles.lineups}>
          <Lineup title={youName} rows={live.me.lineup} />
          <Lineup title={live.opp.name} rows={live.opp.lineup} />
        </View>
      ) : null}
    </View>
  );
}

function Lineup({ title, rows }: { title: string; rows: LineupRow[] }) {
  return (
    <View style={styles.lineup}>
      <Text variant="caption" tone="secondary">{title}</Text>
      {rows.map((r) => (
        <View key={r.symbol} style={styles.lineRow}>
          <Text variant="callout" style={styles.symbol}>{r.symbol}</Text>
          <Text variant="callout">{formatMoney(r.cents / 100, { sign: 'always' })}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[4] },
  lineups: { flexDirection: 'row', gap: space[4] },
  lineup: { flex: 1, gap: space[2] },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between' },
  symbol: { fontWeight: '600' },
});
