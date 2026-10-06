/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet, Pressable } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { space } from '@/constants/tokens';
import type { DraftStatus } from '@/lib/game/useDraftStatus';
import { byeNoticeCopy, startBlockerCopy, playoffStepperBounds, stepPlayoffTeams } from '@/lib/game/draftLobby';
import { useTheme } from '@/components/sp/ThemeProvider';
import { playoffLine } from '@/lib/playoffs';

export interface StartDraftConfirmProps {
  status: DraftStatus;
  playoffTeams: number | null;
  numWeeks: number;
  pickSeconds: number;
  onStart: () => void;
  onNotYet: () => void;
  /** Writes the new playoff team count (the same leagues update as League settings). */
  onSetPlayoffTeams: (teams: number) => void;
  /** The league's invite code, offered when there are fewer than the minimum managers. */
  inviteCode: string | null;
  onShareInvite: () => void;
}

/** Start the draft (3c, board): the confirm names the action and shows the
 * draft order mode's summary, the playoff line, the uneven-bye heads-up, and
 * each blocker in plain words. "Start draft" is disabled until it can start,
 * and never enabled on a failed status read. */
export function StartDraftConfirm({ status, playoffTeams, numWeeks, pickSeconds, onStart, onNotYet, onSetPlayoffTeams, inviteCode, onShareInvite }: StartDraftConfirmProps) {
  const { colors } = useTheme();
  const bye = byeNoticeCopy(status.memberCount, numWeeks);
  const playoffs = playoffLine(playoffTeams);
  const tooManyTeams = status.blockers.some((b) => b.code === 'playoff_teams_exceeds_members');
  const short = status.memberCount < status.minMembers;
  const { max } = playoffStepperBounds(status.memberCount);
  const current = playoffTeams ?? 0;
  return (
    <Card>
      <Text variant="title">Start the draft?</Text>
      <Text variant="callout" tone="secondary">{`${status.memberCount} managers are in, and each pick gets ${pickSeconds} seconds.`}</Text>
      {playoffs ? <Text variant="caption" tone="secondary">{`Playoffs: ${playoffs}`}</Text> : null}
      {bye ? <Text variant="caption" tone="secondary">{bye}</Text> : null}
      {status.blockers.map((b, i) => (
        <Text key={`${b.code}-${i}`} variant="callout">{startBlockerCopy(b)}</Text>
      ))}
      {tooManyTeams ? (
        <View style={styles.stepper}>
          <Text variant="callout">Playoff teams</Text>
          <View style={styles.stepRow}>
            <Pressable
              onPress={() => onSetPlayoffTeams(stepPlayoffTeams(current, -1, status.memberCount))}
              disabled={current <= 2}
              accessibilityRole="button"
              accessibilityLabel="Fewer playoff teams"
              style={styles.stepButton}
            >
              <Text variant="headline">−</Text>
            </Pressable>
            <Text variant="headline" style={{ color: colors.danger }}>{String(current)}</Text>
            <Pressable
              onPress={() => onSetPlayoffTeams(stepPlayoffTeams(current, 1, status.memberCount))}
              disabled={current >= max}
              accessibilityRole="button"
              accessibilityLabel="More playoff teams"
              style={styles.stepButton}
            >
              <Text variant="headline">+</Text>
            </Pressable>
          </View>
          <Text variant="caption" tone="secondary">{`Up to ${status.memberCount}, one per manager.`}</Text>
        </View>
      ) : null}
      {short && inviteCode ? (
        <View style={styles.invite}>
          <Text variant="caption" tone="secondary">Invite code</Text>
          <Text variant="headline">{inviteCode}</Text>
          <Button label="Share invite code" variant="secondary" onPress={onShareInvite} />
        </View>
      ) : null}
      <View style={styles.actions}>
        <Button label="Start draft" onPress={onStart} disabled={!status.canStart} />
        <Button label="Not yet" variant="secondary" onPress={onNotYet} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { gap: space[2], marginTop: space[3] },
  stepper: { gap: space[2], marginTop: space[2] },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  // 44 x 44 pt, the minimum hit area (the craft floor).
  stepButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  invite: { gap: space[2], marginTop: space[2] },
});
