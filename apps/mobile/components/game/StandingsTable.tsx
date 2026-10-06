/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { formatMoney } from '@/components/sp/logic/money';
import { space } from '@/constants/tokens';
import type { StandingsRow } from '@/lib/game/standings';

export interface StandingsTableProps {
  rows: StandingsRow[];
  /** Board copy under the table, verbatim. */
  caption: string;
  /** Medals (§9A) show ONLY when the season is complete. */
  seasonComplete: boolean;
}

/** The medal disc for ranks 1–3 (season complete only): a filled disc with the
 * rank numeral in on-medal. Never medal-coloured text (§9A). */
const MEDAL: Record<number, { fill: 'medalGold' | 'medalSilver' | 'medalBronze'; label: string }> = {
  1: { fill: 'medalGold', label: '1st place' },
  2: { fill: 'medalSilver', label: '2nd place' },
  3: { fill: 'medalBronze', label: '3rd place' },
};

/** The broadcast table: rank, the move since last week, the name (+ Bot),
 * the record, and the season gain. A row with no known move shows no arrow. */
export function StandingsTable({ rows, caption, seasonComplete }: StandingsTableProps) {
  const { colors } = useTheme();
  return (
    <Card>
      {rows.map((r) => {
        const medal = seasonComplete ? MEDAL[r.rank] : undefined;
        return (
        <View key={r.userId} style={[styles.row, r.isYou ? { backgroundColor: colors.youTint } : null]} accessible accessibilityLabel={`${medal ? `${medal.label}, ` : ''}${r.rank}, ${r.name}, ${r.record}, season gain ${formatMoney(r.seasonGain, { sign: 'always' })}${r.move ? `, up ${Math.abs(r.move)}` : ''}`}>
          {medal ? (
            <View style={[styles.disc, { backgroundColor: colors[medal.fill] }]}>
              <Text variant="caption" style={[styles.discNumeral, { color: colors.onMedal }]}>{r.rank}</Text>
            </View>
          ) : (
            <Text variant="callout" style={styles.rank}>{r.rank}</Text>
          )}
          <View style={styles.moveCell}>
            {r.move === null ? null : r.move > 0 ? (
              <Text variant="caption" style={{ color: colors.gain }}>▲{r.move}</Text>
            ) : r.move < 0 ? (
              <Text variant="caption" style={{ color: colors.loss }}>▼{Math.abs(r.move)}</Text>
            ) : (
              <Text variant="caption" tone="secondary">–</Text>
            )}
          </View>
          <View style={styles.name}>
            <Text variant="callout" style={r.isYou ? { fontWeight: '700' } : undefined}>
              {r.name}{r.isYou ? <Text variant="callout" tone="secondary"> (you)</Text> : null}
            </Text>
            {r.isBot ? <Text variant="caption" tone="secondary">Bot</Text> : null}
          </View>
          <Text variant="caption" tone="secondary" style={styles.record}>{r.record}</Text>
          <Text variant="callout" style={styles.gain}>{formatMoney(r.seasonGain, { sign: 'always' })}</Text>
        </View>
        );
      })}
      <Text variant="caption" tone="secondary" style={styles.caption}>{caption}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2] },
  rank: { width: 22, textAlign: 'right' },
  disc: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  discNumeral: { fontSize: 11, fontWeight: '800' },
  moveCell: { width: 30 },
  name: { flex: 1 },
  record: { width: 56, textAlign: 'right' },
  gain: { minWidth: 92, textAlign: 'right' },
  caption: { marginTop: space[2] },
});
