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
import { managersProgressShown, mySnakePicks, orderSetLine } from '@/lib/game/draftLobby';
import { keepDots } from '@/lib/game/keepDots';
import { MANAGER_ROW_GAP, ManagerRow } from '@/components/sp/gn';

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
          {managersProgressShown(data.memberCount, data.minMembers) ? <Text variant="caption" tone="secondary">{managersProgressCaption(data.memberCount, data.minMembers)}</Text> : null}
        </Card>
      ) : (
        // Game Night (W4): the order is Standings' ManagerRow tiles on the page (`surface`, radius
        // 12, 6pt apart, divided by space), your row tinted and ringed, your name bold (shading B,
        // S-10: no "(you)").
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text variant="tag" tone="secondary">Draft order</Text>
            {orderSetLine(orderWasSetLine(data.finalizeAt), draftDate) ? <Text variant="caption" tone="secondary">{orderSetLine(orderWasSetLine(data.finalizeAt), draftDate)}</Text> : null}
            {seat > 0 ? (
              <Text variant="callout" style={{ color: colors.youText, fontWeight: '700' }}>
                {`You pick ${ordinal(seat)}`}
                {yourPicks.length > 1 ? <Text variant="callout" tone="secondary">{`, then ${yourPicks.slice(1).map(ordinal).join(', ')}…`}</Text> : null}
              </Text>
            ) : null}
          </View>
          <View style={styles.order}>
            {/* Standings' ManagerRow itself, its order kind (the seat, the avatar, the name). */}
            {order.map((id, i) => (
              <ManagerRow key={id} kind="order" rank={i + 1} name={nameOf(id)} isYou={id === myUserId} />
            ))}
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
});
