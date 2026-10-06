/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { space } from '@/constants/tokens';
import type { PreDraftData } from '@/lib/home/usePreDraftData';
import { countdownLabel, draftDateTimeLabel, orderSetLine } from '@/lib/home/draftCountdown';
import { managersProgressCaption, orderWaitingLine, pickClockLine } from '@/lib/home/homeCopy';
import { ordinal } from '@/lib/home/ordinal';
import { mySnakePicks } from '@/lib/game/draftLobby';

export interface DraftLobbyProps {
  data: PreDraftData;
  myUserId: string;
  draftDate: string | null;
  pickSeconds: number;
  rounds: number;
  now: Date;
}

/** Draft lobby (3c, key screen 4 pre-draft): the countdown, the order (or the
 * waiting state with its progress), and your own picks ("You pick 4th, then
 * 13th, 20th…"). Every line is a real value or an honest waiting state. */
export function DraftLobby({ data, myUserId, draftDate, pickSeconds, rounds, now }: DraftLobbyProps) {
  const { colors } = useTheme();
  const countdown = countdownLabel(now, draftDate);
  const when = draftDateTimeLabel(draftDate);
  const order = data.orderRevealed;
  const seat = order ? order.indexOf(myUserId) + 1 : 0;
  const yourPicks = order && seat > 0 ? mySnakePicks(seat, order.length, rounds).slice(0, 3) : [];
  const nameOf = (id: string) => data.members.find((m) => m.userId === id)?.displayName ?? '';

  return (
    <View style={styles.stack}>
      <Card>
        <Text variant="tag" tone="secondary">Draft starts in</Text>
        <Text variant="score.md" style={styles.countdown}>{countdown ?? '—'}</Text>
        <Text variant="caption" tone="secondary">{when ? `${when} · ${pickClockLine(pickSeconds, rounds)}` : pickClockLine(pickSeconds, rounds)}</Text>
      </Card>

      {data.waiting || !order ? (
        <Card>
          <Text variant="tag" tone="secondary">Draft order · waiting</Text>
          <Text variant="callout">{orderWaitingLine(data.minMembers)}</Text>
          <Text variant="caption" tone="secondary">{managersProgressCaption(data.memberCount, data.minMembers)}</Text>
        </Card>
      ) : (
        <Card>
          <Text variant="tag" tone="secondary">Draft order</Text>
          {orderSetLine(data.finalizeAt) ? <Text variant="caption" tone="secondary">{orderSetLine(data.finalizeAt)}</Text> : null}
          {seat > 0 ? (
            <Text variant="callout" style={{ color: colors.youText, fontWeight: '700' }}>
              {`You pick ${ordinal(seat)}`}
              {yourPicks.length > 1 ? <Text variant="callout" tone="secondary">{`, then ${yourPicks.slice(1).map(ordinal).join(', ')}…`}</Text> : null}
            </Text>
          ) : null}
          <View style={styles.order}>
            {order.map((id, i) => (
              <View key={id} style={styles.orderRow}>
                <Text variant="caption" tone="secondary" style={styles.seatNo}>{i + 1}</Text>
                <Text variant="callout" style={id === myUserId ? { fontWeight: '700' } : undefined}>
                  {nameOf(id)}{id === myUserId ? <Text variant="callout" tone="secondary"> (you)</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        </Card>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
  countdown: { marginVertical: space[1] },
  order: { gap: space[2], marginTop: space[2] },
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  seatNo: { minWidth: 18, textAlign: 'right' },
});
