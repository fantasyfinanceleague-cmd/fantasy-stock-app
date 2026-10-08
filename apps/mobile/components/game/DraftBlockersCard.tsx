/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius, space, typeFontFamily } from '@/constants/tokens';
import { Button } from '@/components/sp/Button';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Stepper } from '@/components/game/Stepper';
import {
  INVITE_SOMEONE_NEW,
  PICK_NEW_TIME,
  PICK_NEW_TIME_NOTE,
  PICK_NEW_TIME_READY,
  blockerTitle,
  blockersCardCopy,
  moveForwardLabel,
  playoffFixLine,
  type Blocker,
} from '@/lib/game/autoStart';
import { playoffStepperBounds, stepPlayoffTeams } from '@/lib/game/draftLobby';

// 3c-2 — the commissioner's blockers card (board #call-auto-start
// BlockersCard), what was the "Start the draft?" confirm: there is no Start
// button any more (the draft starts by itself). The warn-tint card says what
// stands in the way and by when (the room-open time, the real gate); each
// blocker is its own sub-card with its fix: the reconfirm choices, the
// playoff-teams stepper, or the invite code. Postponed: the same blockers,
// then "Pick a new draft time", disabled until nothing blocks.

export interface DraftBlockersCardProps {
  phase: 'risk' | 'postponed';
  /** "6:00 PM ET": the room-open time (risk) or the time it wasn't ready at (postponed). */
  deadlineLabel: string | null;
  /** The fixable blockers (autoStart.fixableBlockers), in the server's order. */
  blockers: Blocker[];
  memberCount: number;
  playoffTeams: number | null;
  onSetPlayoffTeams: (teams: number) => void;
  onReconfirm: (choice: 'move_forward' | 'invite') => void;
  inviteCode: string | null;
  onShareInvite: () => void;
  onPickNewTime: () => void;
  busy?: boolean;
  /** A fix that didn't save (shown at the bottom). */
  error?: string | null;
}

export function DraftBlockersCard({
  phase, deadlineLabel, blockers, memberCount, playoffTeams, onSetPlayoffTeams, onReconfirm,
  inviteCode, onShareInvite, onPickNewTime, busy = false, error,
}: DraftBlockersCardProps) {
  const { colors } = useTheme();
  const copy = blockersCardCopy(phase, deadlineLabel);
  const { min, max } = playoffStepperBounds(memberCount);
  const current = playoffTeams ?? 0;

  const fixFor = (b: Blocker) => {
    if (b.code === 'roster_reconfirm_required') {
      const members = typeof b.members === 'number' ? b.members : memberCount;
      return (
        <View style={styles.actions}>
          <Button label={moveForwardLabel(members)} size="sm" onPress={() => onReconfirm('move_forward')} disabled={busy} />
          <Button label={INVITE_SOMEONE_NEW} variant="secondary" size="sm" onPress={() => onReconfirm('invite')} disabled={busy} />
        </View>
      );
    }
    if (b.code === 'playoff_teams_exceeds_members') {
      const members = typeof b.members === 'number' ? b.members : memberCount;
      return (
        <>
          <Stepper
            label="Playoff teams"
            value={current}
            onStep={(d) => onSetPlayoffTeams(stepPlayoffTeams(current, d, members))}
            canDecrement={current > min}
            canIncrement={current < Math.min(max, members)}
            disabled={busy}
            emphasis="warn"
          />
          <Text variant="caption">{playoffFixLine(members)}</Text>
        </>
      );
    }
    if (b.code === 'not_enough_members' && inviteCode) {
      return (
        <View style={styles.invite}>
          <Text variant="caption" tone="secondary">Invite code</Text>
          <Text variant="headline" selectable>{inviteCode}</Text>
          <Button label="Share invite code" variant="secondary" size="sm" onPress={onShareInvite} />
        </View>
      );
    }
    return null;
  };

  const blocked = blockers.length > 0;

  return (
    <View accessibilityRole="alert" style={[styles.card, { backgroundColor: colors.warnTint, borderColor: colors.warnLine }]}>
      <Text variant="tag" color={colors.warnText}>{copy.tag}</Text>
      <View style={styles.head}>
        <Text variant="headline" style={styles.bold}>{copy.title}</Text>
        <Text variant="caption">{copy.line}</Text>
      </View>
      {blockers.map((b, i) => (
        <Card key={`${b.code}-${i}`} style={styles.blocker}>
          <Text variant="callout" style={styles.bold}>{blockerTitle(b)}</Text>
          {fixFor(b)}
        </Card>
      ))}
      {phase === 'postponed' ? (
        <View style={styles.actions}>
          <Button label={PICK_NEW_TIME} onPress={onPickNewTime} disabled={blocked || busy} />
          <Text variant="caption" style={styles.center}>{blocked ? PICK_NEW_TIME_NOTE : PICK_NEW_TIME_READY}</Text>
        </View>
      ) : null}
      {error ? (
        <Text variant="callout" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space[5],
    paddingVertical: space[4],
    gap: space[4],
  },
  head: {
    gap: space[1],
  },
  blocker: {
    borderRadius: radius.md,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    gap: space[3],
  },
  actions: {
    gap: space[3],
  },
  invite: {
    gap: space[2],
  },
  bold: {
    fontFamily: typeFontFamily.bold,
  },
  center: {
    textAlign: 'center',
  },
});
