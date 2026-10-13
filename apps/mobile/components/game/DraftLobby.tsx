/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { radius, space } from '@/constants/tokens';
import type { PreDraftData } from '@/lib/home/usePreDraftData';
import { countdownLabel, draftDateTimeLabel, orderWasSetLine } from '@/lib/home/draftCountdown';
import { managersProgressCaption, orderWaitingLine, pickClockLine } from '@/lib/home/homeCopy';
import { ordinal } from '@/lib/home/ordinal';
import { mySnakePicks } from '@/lib/game/draftLobby';
import { keepDots } from '@/lib/game/keepDots';
import { yourNameStyle, youA11y } from '@/lib/game/managerRow';
import { Avatar } from '@/components/sp/Avatar';
import { MANAGER_ROW_GAP } from '@/components/sp/gn';
import { YOU_RING } from '@/components/sp/logic/gameNight';

export interface DraftLobbyProps {
  data: PreDraftData;
  myUserId: string;
  draftDate: string | null;
  pickSeconds: number;
  rounds: number;
  now: Date;
  /** The countdown card. Off where the auto-start countdown (DraftCountdownCard) replaces it. */
  showCountdown?: boolean;
}

/** Draft lobby (3c, key screen 4 pre-draft): the countdown, the order (or the
 * waiting state with its progress), and your own picks ("You pick 4th, then
 * 13th, 20th…"). Every line is a real value or an honest waiting state. */
export function DraftLobby({ data, myUserId, draftDate, pickSeconds, rounds, now, showCountdown = true }: DraftLobbyProps) {
  const { colors } = useTheme();
  const countdown = countdownLabel(now, draftDate);
  const when = draftDateTimeLabel(draftDate);
  const order = data.orderRevealed;
  const seat = order ? order.indexOf(myUserId) + 1 : 0;
  const yourPicks = order && seat > 0 ? mySnakePicks(seat, order.length, rounds).slice(0, 3) : [];
  const nameOf = (id: string) => data.members.find((m) => m.userId === id)?.displayName ?? '';

  return (
    <View style={styles.stack}>
      {showCountdown ? (
        <Card style={styles.card}>
          <Text variant="tag" tone="secondary">Draft starts in</Text>
          <Text variant="score.md" style={styles.countdown}>{countdown ?? '—'}</Text>
          <Text variant="caption" tone="secondary">{keepDots(when ? `${when} · ${pickClockLine(pickSeconds, rounds)}` : pickClockLine(pickSeconds, rounds))}</Text>
        </Card>
      ) : null}

      {data.waiting || !order ? (
        <Card style={styles.card}>
          <Text variant="tag" tone="secondary">{keepDots('Draft order · waiting')}</Text>
          <Text variant="callout">{orderWaitingLine(data.minMembers)}</Text>
          <Text variant="caption" tone="secondary">{managersProgressCaption(data.memberCount, data.minMembers)}</Text>
        </Card>
      ) : (
        // Game Night (W4): the order is a list of manager tiles on the page (Standings'
        // ManagerRow shape: `surface`, radius 12, 6pt apart, divided by space), your row on your
        // tint with its 1.5pt ring and your name bold (shading B, S-10: no "(you)").
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text variant="tag" tone="secondary">Draft order</Text>
            {orderWasSetLine(data.finalizeAt) ? <Text variant="caption" tone="secondary">{orderWasSetLine(data.finalizeAt)}</Text> : null}
            {seat > 0 ? (
              <Text variant="callout" style={{ color: colors.youText, fontWeight: '700' }}>
                {`You pick ${ordinal(seat)}`}
                {yourPicks.length > 1 ? <Text variant="callout" tone="secondary">{`, then ${yourPicks.slice(1).map(ordinal).join(', ')}…`}</Text> : null}
              </Text>
            ) : null}
          </View>
          <View style={styles.order}>
            {order.map((id, i) => {
              const you = id === myUserId;
              return (
                <View key={id} style={[styles.orderRow, { backgroundColor: colors.surface }]} accessible accessibilityLabel={`${i + 1}, ${nameOf(id)}${youA11y(you)}`}>
                  {you ? <View testID="lobby-order-you" pointerEvents="none" style={[styles.youOverlay, { backgroundColor: colors.youTint, borderColor: colors.you }]} /> : null}
                  <Text variant="score.sm" color={you ? colors.text : colors.text2} style={styles.seatNo}>{i + 1}</Text>
                  <Avatar name={nameOf(id)} size={32} tone={you ? 'you' : 'neutral'} />
                  <Text variant="body" numberOfLines={2} style={[styles.name, yourNameStyle(you)]}>{nameOf(id)}</Text>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // The sp Card has no padding or radius of its own (callers set both); bare, the
  // text sat flush on the card edge (final sweep S-1, seen in the capture pass).
  card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },
  stack: { gap: space[5] },
  countdown: { marginVertical: space[1] },
  section: { gap: space[4] },
  sectionHead: { gap: space[2] },
  order: { gap: MANAGER_ROW_GAP },
  // ManagerRow's tile (W4 Home's 4pt scale): 12 around, 56 tall, radius 12.
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, paddingVertical: space[4], paddingHorizontal: space[4], borderRadius: radius.row, overflow: 'hidden' },
  youOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: radius.row, borderWidth: YOU_RING },
  seatNo: { width: 22, fontVariant: ['tabular-nums'] },
  name: { flex: 1, minWidth: 0 },
});
