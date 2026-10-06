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
}

/** The broadcast table: rank, the move since last week, the name (+ Bot),
 * the record, and the season gain. A row with no known move shows no arrow. */
export function StandingsTable({ rows, caption }: StandingsTableProps) {
  const { colors } = useTheme();
  return (
    <Card>
      {rows.map((r) => (
        <View key={r.userId} style={[styles.row, r.isYou ? { backgroundColor: colors.accentWash } : null]} accessible accessibilityLabel={`${r.rank}, ${r.name}, ${r.record}, season gain ${formatMoney(r.seasonGain, { sign: 'always' })}${r.move ? `, up ${Math.abs(r.move)}` : ''}`}>
          <Text variant="callout" style={styles.rank}>{r.rank}</Text>
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
      ))}
      <Text variant="caption" tone="secondary" style={styles.caption}>{caption}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2] },
  rank: { width: 22, textAlign: 'right' },
  moveCell: { width: 30 },
  name: { flex: 1 },
  record: { width: 56, textAlign: 'right' },
  gain: { minWidth: 92, textAlign: 'right' },
  caption: { marginTop: space[2] },
});
