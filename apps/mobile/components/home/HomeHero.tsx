/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney, formatPercent, isZeroMoney } from '@/components/sp/logic/money';
import { RollingMoney } from '@/components/home/RollingMoney';
import { HERO_SEASON_GAIN_LABEL, HERO_TODAY_LABEL, heroAccessibilityLabel } from '@/lib/home/homeCopy';

// Stockpile — <HomeHero> (Phase 3b-2, D1 Concept A). The big number is
// team VALUE; the line under it is the scored season gain plus today's
// live change, labelled "season gain" — never "since the draft" (that
// label is Portfolio's alone, a different number: value − cost).
//
// H1 (hero roll): the value and the gain roll per changed digit on every
// live update, never on first paint — RollingMoney handles both (it
// diffs against itself on mount/a league switch, so nothing rolls then).
// H5: RollingMoney is keyed by `leagueId`, so switching leagues never
// presents a different league's number as a change.
//
// Zero is grey (never green/red) via Money/RollingMoney's caller passing
// colors.zero explicitly when the value rounds to zero cents — matching
// the app-wide "money flat" rule (§9A).

export interface HomeHeroProps {
  leagueId: string;
  rank: number;
  totalPlayers: number;
  record: string;
  week: number;
  numWeeks: number;
  value: number;
  seasonGainDollars: number;
  seasonGainPct: number;
  /** Null hides the "today" segment entirely (a non-trading day). */
  today: number | null;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function HomeHero({ leagueId, rank, totalPlayers, record, week, numWeeks, value, seasonGainDollars, seasonGainPct, today }: HomeHeroProps) {
  const { colors } = useTheme();

  const gainColor = isZeroMoney(seasonGainDollars) ? colors.zero : seasonGainDollars > 0 ? colors.gain : colors.loss;
  const todayColor = today == null ? colors.text2 : isZeroMoney(today) ? colors.zero : today > 0 ? colors.gain : colors.loss;

  const valueText = formatMoney(value);
  const gainText = `${formatMoney(seasonGainDollars, { sign: 'always' })} · ${formatPercent(seasonGainPct, { sign: 'always' })}`;
  const todayText = today != null ? formatMoney(today, { sign: 'always' }) : null;

  const a11yLabel = heroAccessibilityLabel(valueText, gainText, HERO_SEASON_GAIN_LABEL);

  return (
    <View style={styles.wrap}>
      <View style={styles.metaRow}>
        <Text variant="caption" tone="secondary">
          Your team
        </Text>
        <Text variant="caption" tone="secondary" style={styles.metaNum}>
          {ordinal(rank)} of {totalPlayers} · {record} · Week {week} of {numWeeks}
        </Text>
      </View>

      <View accessible accessibilityLabel={a11yLabel}>
        <RollingMoney text={valueText} size="score.xl" rollKey={leagueId} />
      </View>

      <View style={styles.gainRow}>
        <RollingMoney text={gainText} size="callout" color={gainColor} rollKey={leagueId} />
        <Text variant="callout" tone="secondary"> {HERO_SEASON_GAIN_LABEL}</Text>
        {todayText ? (
          <>
            <Text variant="callout" tone="secondary"> · </Text>
            <RollingMoney text={todayText} size="callout" color={todayColor} rollKey={leagueId} />
            <Text variant="callout" tone="secondary"> {HERO_TODAY_LABEL}</Text>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: space[2],
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  metaNum: {
    fontVariant: ['tabular-nums'],
  },
  gainRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
  },
});
