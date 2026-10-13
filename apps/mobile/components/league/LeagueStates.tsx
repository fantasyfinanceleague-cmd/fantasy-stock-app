/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Button } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { Skeleton } from '@/components/Skeleton';
import { MANAGER_ROW_GAP } from '@/components/sp/gn';
import { TRY_AGAIN } from '@/lib/game/renewal';

// League's in-between states on Game Night (W4). UX rule 9: loading shows the SHAPE of what's
// coming (the manager tiles, 6pt apart), never numbers, as one accessible "Loading" element.
// A failed read says so in the house "X didn't load." form with Try again, which re-reads
// (the hooks' reloadKey): never a blank segment.

const LOADING = 'Loading';

/** The standings' (and schedule's) tiles while the read is in flight. */
export function TilesSkeleton({ rows = 6 }: { rows?: number }) {
  const { colors } = useTheme();
  return (
    <View style={styles.rows} accessible accessibilityLabel={LOADING} accessibilityState={{ busy: true }}>
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={[styles.tile, { backgroundColor: colors.surface }]}>
          <Skeleton width={16} height={14} />
          <Skeleton width={32} height={32} borderRadius={16} />
          <View style={styles.grow}>
            <Skeleton width="60%" height={14} />
          </View>
          <Skeleton width={64} height={14} />
        </View>
      ))}
    </View>
  );
}

/** A read that failed: its line and Try again (the lobby's queue card, the same shape). */
export function LoadFailed({ line, onRetry }: { line: string; onRetry: () => void }) {
  return (
    <Card style={styles.failed}>
      <Text variant="callout" accessibilityRole="alert">{line}</Text>
      <Button label={TRY_AGAIN} variant="secondary" size="sm" onPress={onRetry} />
    </Card>
  );
}

const styles = StyleSheet.create({
  rows: { gap: MANAGER_ROW_GAP },
  // ManagerRow's tile: radius 12, 12pt padding, 56pt tall.
  tile: { flexDirection: 'row', alignItems: 'center', gap: space[3], minHeight: 56, paddingHorizontal: space[4], borderRadius: radius.row },
  grow: { flex: 1 },
  failed: { borderRadius: radius.lg, padding: space[5], gap: space[3], alignItems: 'flex-start' },
});
