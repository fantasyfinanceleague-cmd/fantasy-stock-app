/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { View, StyleSheet } from 'react-native';
import { Card } from '@/components/sp/Card';
import { Text } from '@/components/sp/Text';
import { Icon } from '@/components/sp/Icon';
import { radius, space } from '@/constants/tokens';

/** R9, the last season's champion, until the next draft: a compact banner. */
export function ChampBanner({ tag, line }: { tag: string; line: string }) {
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <Icon name="trophy" size="headline" tone="live" />
        <View style={styles.text}>
          <Text variant="tag" tone="secondary">{tag}</Text>
          <Text variant="callout" style={{ fontWeight: '700' }}>{line}</Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  // The sp Card has no padding or radius of its own (callers set both); bare, the
  // text sat flush on the card edge (final sweep S-1, seen in the capture pass).
  card: { borderRadius: radius.lg, padding: space[5], gap: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  text: { flex: 1, gap: space[1] },
});
