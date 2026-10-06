/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { space } from '@/constants/tokens';
import type { DraftStatus } from '@/lib/game/useDraftStatus';
import { byeNoticeCopy, startBlockerCopy } from '@/lib/game/draftLobby';
import { playoffLine } from '@/lib/playoffs';

export interface StartDraftConfirmProps {
  status: DraftStatus;
  playoffTeams: number | null;
  numWeeks: number;
  pickSeconds: number;
  onStart: () => void;
  onNotYet: () => void;
}

/** Start the draft (3c, board): the confirm names the action and shows the
 * draft order mode's summary, the playoff line, the uneven-bye heads-up, and
 * each blocker in plain words. "Start draft" is disabled until it can start,
 * and never enabled on a failed status read. */
export function StartDraftConfirm({ status, playoffTeams, numWeeks, pickSeconds, onStart, onNotYet }: StartDraftConfirmProps) {
  const bye = byeNoticeCopy(status.memberCount, numWeeks);
  const playoffs = playoffLine(playoffTeams);
  return (
    <Card>
      <Text variant="title">Start the draft?</Text>
      <Text variant="callout" tone="secondary">{`${status.memberCount} managers are in, and each pick gets ${pickSeconds} seconds.`}</Text>
      {playoffs ? <Text variant="caption" tone="secondary">{`Playoffs: ${playoffs}`}</Text> : null}
      {bye ? <Text variant="caption" tone="secondary">{bye}</Text> : null}
      {status.blockers.map((b, i) => (
        <Text key={`${b.code}-${i}`} variant="callout">{startBlockerCopy(b)}</Text>
      ))}
      <View style={styles.actions}>
        <Button label="Start draft" onPress={onStart} disabled={!status.canStart} />
        <Button label="Not yet" variant="secondary" onPress={onNotYet} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  actions: { gap: space[2], marginTop: space[3] },
});
