/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Button } from '@/components/sp/Button';
import { radius, space } from '@/constants/tokens';
import { countsLine } from '@/lib/game/renewal';
import { RENEWAL_FIXTURE_CALLER, useRenewalRoster } from '@/lib/game/useRenewalRoster';

/** R4 (Home, the commissioner while replies come in): the counts line, "Waiting on …",
 * and [See who's in], which opens the reconcile list on the League tab. */
export function RenewalCountsCard({ successorId }: { successorId: string }) {
  const st = useRenewalRoster(successorId, RENEWAL_FIXTURE_CALLER, 0);
  if (st.status !== 'ready' || !st.roster || st.roster.status !== 'ok' || !st.roster.full_list) return null;
  const r = st.roster;
  const waiting = r.people.filter((p) => p.group === 'pending').map((p) => p.display_name);
  return (
    <Card style={styles.card}>
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
  // The sp Card has no padding or radius of its own (callers set both); bare, the
  // text sat flush on the card edge (final sweep S-1, seen in the capture pass).
  card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },
  action: { marginTop: space[2] },
});
