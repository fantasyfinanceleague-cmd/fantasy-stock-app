/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { space } from '@/constants/tokens';
import { countsLine } from '@/lib/game/renewal';
import { useRenewalRoster } from '@/lib/game/useRenewalRoster';

/** R4 (Home, the commissioner while replies come in): the counts line, "Waiting on …",
 * and [See who's in], which opens the reconcile list on the League tab. */
export function RenewalCountsCard({ successorId }: { successorId: string }) {
  const st = useRenewalRoster(successorId, null, 0);
  if (st.status !== 'ready' || !st.roster || st.roster.status !== 'ok' || !st.roster.full_list) return null;
  const r = st.roster;
  const waiting = r.people.filter((p) => p.group === 'pending').map((p) => p.display_name);
  return (
    <Card>
      <Text variant="tag" tone="secondary">{`Season 2 · running back`}</Text>
      <Text variant="callout">{countsLine(r.counts)}</Text>
      {waiting.length > 0 ? <Text variant="caption" tone="secondary">{`Waiting on ${waiting.join(', ')}. You'll set up the draft once everyone has replied.`}</Text> : null}
      <View style={styles.action}>
        <Button label="See who's in" variant="secondary" onPress={() => router.push('/(tabs)/league')} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  action: { marginTop: space[2] },
});
