/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { LiveDot } from '@/components/sp/game/LiveDot';
import { formatMoney } from '@/components/sp/logic/money';
import { space } from '@/constants/tokens';
import type { ScheduleRow } from '@/lib/game/schedule';

export interface ScheduleListProps {
  rows: ScheduleRow[];
  /** The playoff line under the list (lib/playoffs playoffLine), or null. */
  playoffLine: string | null;
}

/** League › Schedule (board frame, D4 = keep). Each week's opponent, and the
 * result with your score once it posts; "● Live" this week until it posts;
 * "Next" the week after. A bye is neutral: never W or L. */
export function ScheduleList({ rows, playoffLine }: ScheduleListProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.stack}>
      <Card>
        {rows.map((r) => (
          <View key={r.week} style={[styles.row, r.state === 'live' ? { backgroundColor: colors.youTint } : null]} accessible accessibilityLabel={label(r)}>
            <Text variant="caption" style={styles.week}>W{r.week}</Text>
            <Text variant="callout" tone={r.state === 'future' || r.state === 'next' ? 'secondary' : undefined} style={r.state === 'live' ? styles.bold : undefined}>
              {r.bye ? 'Bye' : r.opponent === null ? '' : `vs ${r.opponent}`}
            </Text>
            <View style={styles.result}>
              {r.bye ? (
                <Text variant="caption" tone="secondary">{r.gain === null ? '' : formatMoney(r.gain, { sign: 'always' })}</Text>
              ) : r.state === 'live' ? (
                <View style={styles.liveRow}>
                  <LiveDot size={7} />
                  <Text variant="callout" style={{ color: colors.liveText, fontWeight: '700' }}>Live</Text>
                </View>
              ) : r.state === 'next' ? (
                <Text variant="caption" tone="secondary">Next</Text>
              ) : r.gain !== null ? (
                <Text variant="callout" style={styles.bold}>
                  <Text variant="callout" style={{ color: r.tie ? colors.text2 : r.won ? colors.gain : colors.loss, fontWeight: '700' }}>{r.tie ? 'T' : r.won ? 'W' : 'L'}</Text>{' '}
                  {formatMoney(r.gain, { sign: 'always' })}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </Card>
      {playoffLine ? <Text variant="caption" tone="secondary">Then the playoffs: {playoffLine}.</Text> : null}
    </View>
  );
}

function label(r: ScheduleRow): string {
  const what = r.bye ? 'Bye' : r.opponent ? `against ${r.opponent}` : '';
  if (r.state === 'live') return `Week ${r.week}, ${what}, live`;
  if (r.state === 'next') return `Week ${r.week}, ${what}, next`;
  if (r.bye) return `Week ${r.week}, bye, no result`;
  if (r.gain === null) return `Week ${r.week}, ${what}`;
  return `Week ${r.week}, ${what}, ${r.tie ? 'tie' : r.won ? 'won' : 'lost'}, ${formatMoney(r.gain, { sign: 'always' })}`;
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingVertical: space[2] },
  week: { minWidth: 34, fontWeight: '700' },
  bold: { fontWeight: '700' },
  result: { marginLeft: 'auto', alignItems: 'flex-end' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
});
