/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Skeleton } from '@/components/Skeleton';

// 3c-2, UX rule 9 (Design Lead): loading shows the SHAPE of what's coming, not
// an empty body. The room: its clock card and a board grid. Home: the draft /
// hero card and the This Week card. Placeholders only, never numbers. One
// accessible element each ("Loading", busy), so VoiceOver doesn't walk blocks.

const LOADING = 'Loading';

export function DraftRoomSkeleton() {
  return (
    <View style={styles.stack} accessible accessibilityLabel={LOADING} accessibilityState={{ busy: true }}>
      <Card style={styles.card}>
        <Skeleton width={70} height={12} />
        <Skeleton width={90} height={28} />
        <Skeleton width={180} height={16} />
        <Skeleton width={120} height={14} />
      </Card>
      <Card style={styles.card}>
        {Array.from({ length: 3 }, (_, r) => (
          <View key={r} style={styles.boardRow}>
            {Array.from({ length: 4 }, (__, c) => (
              <Skeleton key={c} width={64} height={40} borderRadius={radius.sm} />
            ))}
          </View>
        ))}
      </Card>
    </View>
  );
}

export function HomeSkeleton() {
  return (
    <View style={styles.stack} accessible accessibilityLabel={LOADING} accessibilityState={{ busy: true }}>
      <Card style={styles.card}>
        <Skeleton width={80} height={12} />
        <Skeleton width={200} height={24} />
        <Skeleton width={140} height={40} />
        <Skeleton width={160} height={14} />
      </Card>
      <Card style={styles.card}>
        <Skeleton width={100} height={16} />
        <Skeleton height={14} />
        <Skeleton height={14} />
        <Skeleton width={180} height={14} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[3],
  },
  card: {
    borderRadius: radius.lg,
    padding: space[5],
    gap: space[3],
  },
  boardRow: {
    flexDirection: 'row',
    gap: space[2],
  },
});
