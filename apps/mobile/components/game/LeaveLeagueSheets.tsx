/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Sheet } from '@/components/sp/Sheet';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { ChoiceRow, RowDivider, SetupCard } from '@/components/game/SetupRows';
import {
  HAND_OVER, LEAVE_LEAGUE, MEMBER_LINE, STAY, TRANSFER_CANCEL, TRANSFER_NOTE, TRANSFER_TITLE, WHO_TAKES_OVER, handOverLabel,
  type LeaveRowView, type LeaveSheetCopy, type TransferCandidate,
} from '@/lib/game/leaveLeague';

// 3c-2, item 13 — leaving a league (board #call-leave). The row sits at the
// bottom of League settings in red, the way Sign out sits on Profile; the sheet
// IS the confirmation (no second alert). The transfer sheet has no board frame:
// it follows the Q4 frame's picker (human members only, nothing preselected,
// the button names the pick once there is one).

/** "Leave league" at the bottom of League settings: red when open; disabled with its reason otherwise. */
export function LeaveLeagueRow({ view, onPress }: { view: LeaveRowView; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <SetupCard>
      <Pressable
        onPress={view.enabled ? onPress : undefined}
        disabled={!view.enabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: !view.enabled }}
        accessibilityLabel={view.sub ? `${LEAVE_LEAGUE}. ${view.sub}` : LEAVE_LEAGUE}
        style={styles.row}
      >
        <Text variant="callout" color={view.enabled ? colors.danger : colors.text3} style={styles.bold}>
          {LEAVE_LEAGUE}
        </Text>
        {view.sub ? <Text variant="caption" tone="secondary">{view.sub}</Text> : null}
      </Pressable>
    </SetupCard>
  );
}

export interface LeaveLeagueSheetProps {
  visible: boolean;
  copy: LeaveSheetCopy | null;
  busy: boolean;
  /** A refusal's line (the audit's Rule 8 table), shown in the sheet. */
  error: string | null;
  onLeave: () => void;
  onStay: () => void;
}

export function LeaveLeagueSheet({ visible, copy, busy, error, onLeave, onStay }: LeaveLeagueSheetProps) {
  const { colors } = useTheme();
  return (
    <Sheet visible={visible && !!copy} onClose={onStay}>
      {copy ? (
        <View style={styles.body}>
          <Text variant="title" accessibilityRole="header">{copy.title}</Text>
          <View style={styles.bullets}>
            {copy.bullets.map((b) => (
              <View key={b} style={styles.bullet}>
                <Text variant="callout" tone="secondary">•</Text>
                <Text variant="callout" style={styles.grow}>{b}</Text>
              </View>
            ))}
          </View>
          {error ? <Text variant="callout" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
          <Button label={LEAVE_LEAGUE} variant="destructive" onPress={onLeave} status={busy ? 'loading' : 'idle'} disabled={busy} fullWidth />
          {/* G-3: one filled action per sheet; the safe choice is never a second primary. */}
          <Button label={STAY} variant="ghost" onPress={onStay} disabled={busy} fullWidth />
        </View>
      ) : null}
    </Sheet>
  );
}

export interface TransferSheetProps {
  visible: boolean;
  candidates: TransferCandidate[];
  busy: boolean;
  error: string | null;
  onTransfer: (userId: string) => void;
  onClose: () => void;
}

export function TransferCommissionerSheet({ visible, candidates, busy, error, onTransfer, onClose }: TransferSheetProps) {
  const { colors } = useTheme();
  // Nothing preselected (the board's condition): a fresh pick every time it opens.
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    if (visible) setPicked(null);
  }, [visible]);
  const pickedName = candidates.find((c) => c.userId === picked)?.name ?? null;
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <Text variant="title" accessibilityRole="header">{TRANSFER_TITLE}</Text>
        <Text variant="callout" tone="secondary">{TRANSFER_NOTE}</Text>
        <Text variant="tag" tone="secondary">{WHO_TAKES_OVER}</Text>
        <SetupCard>
          <View accessibilityRole="radiogroup">
            {candidates.map((c, i) => (
              <View key={c.userId}>
                {i > 0 ? <RowDivider /> : null}
                <ChoiceRow title={c.name} help={MEMBER_LINE} selected={picked === c.userId} onPress={() => setPicked(c.userId)} disabled={busy} />
              </View>
            ))}
          </View>
        </SetupCard>
        {error ? <Text variant="callout" color={colors.danger} accessibilityLiveRegion="polite">{error}</Text> : null}
        <Button
          label={pickedName ? handOverLabel(pickedName) : HAND_OVER}
          onPress={() => (picked ? onTransfer(picked) : undefined)}
          disabled={!picked || busy}
          status={busy ? 'loading' : 'idle'}
          fullWidth
        />
        <Button label={TRANSFER_CANCEL} variant="ghost" onPress={onClose} disabled={busy} fullWidth />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { paddingVertical: space[4], gap: space[1], minHeight: 44, justifyContent: 'center' },
  bold: { fontWeight: '700' },
  body: { gap: space[4], paddingHorizontal: space[6], paddingBottom: space[4] },
  bullets: { gap: space[2] },
  bullet: { flexDirection: 'row', gap: space[2] },
  grow: { flex: 1 },
});
