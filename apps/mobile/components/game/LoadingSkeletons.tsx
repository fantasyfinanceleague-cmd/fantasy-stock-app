/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { radius, space } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Skeleton } from '@/components/Skeleton';
import { CLOCK_RING_SIZE } from '@/lib/game/draftClockCard';
import { BOARD_GAP, TILE_HEIGHT } from '@/lib/game/draftBoardLayout';

// 3c-2, UX rule 9 (Design Lead): loading shows the SHAPE of what's coming, not
// an empty body. The room: its clock card and a board grid. Home: the draft /
// hero card and the This Week card. Placeholders only, never numbers. One
// accessible element each ("Loading", busy), so VoiceOver doesn't walk blocks.

const LOADING = 'Loading';

export function DraftRoomSkeleton() {
  // W4 Draft: the room's own shape. The clock card (the ring beside its two lines), then the
  // board's six columns of tiles, at the board's gap and the tile's radius.
  return (
    <View style={styles.roomStack} accessible accessibilityLabel={LOADING} accessibilityState={{ busy: true }}>
      <Card style={styles.card}>
        <View style={styles.clockRow}>
          <Skeleton width={CLOCK_RING_SIZE} height={CLOCK_RING_SIZE} borderRadius={CLOCK_RING_SIZE / 2} />
          <View style={styles.clockLines}>
            <Skeleton width={180} height={24} />
            <Skeleton width={140} height={16} />
          </View>
        </View>
      </Card>
      <View style={styles.board}>
        {Array.from({ length: 3 }, (_, r) => (
          <View key={r} style={styles.boardRow}>
            {Array.from({ length: 6 }, (__, c) => (
              <View key={c} style={styles.tile}>
                <Skeleton height={TILE_HEIGHT} borderRadius={radius.tile} />
              </View>
            ))}
          </View>
        ))}
      </View>
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

/** Matchup (S-6, W4): the scoreboard (two halves, two totals) and the roster's mirrored rows. */
export function MatchupSkeleton() {
  return (
    <View style={styles.stack} accessible accessibilityLabel={LOADING} accessibilityState={{ busy: true }}>
      <Card style={styles.card}>
        <View style={styles.scoreRow}>
          <Skeleton width={110} height={20} />
          <Skeleton width={110} height={20} />
        </View>
        <View style={styles.scoreRow}>
          <Skeleton width={120} height={32} />
          <Skeleton width={120} height={32} />
        </View>
      </Card>
      <RosterRowsSkeleton />
    </View>
  );
}

/** The roster alone, while its order loads (the ledger and the slots): mirrored rows, never
 * a list that would re-sort under the reader once the order arrives. */
export function RosterRowsSkeleton() {
  return (
    <View style={styles.stack} accessible accessibilityLabel={LOADING} accessibilityState={{ busy: true }}>
      {[0, 1, 2, 3].map((r) => (
        <View key={r} style={styles.scoreRow}>
          <Skeleton width={140} height={40} borderRadius={radius.row} />
          <Skeleton width={140} height={40} borderRadius={radius.row} />
        </View>
      ))}
    </View>
  );
}

/** All matchups (S-6): the week's games, as compact score rows. */
export function AllMatchupsSkeleton() {
  return (
    <View style={styles.stack} accessible accessibilityLabel={LOADING} accessibilityState={{ busy: true }}>
      {[0, 1, 2].map((r) => (
        <Card key={r} style={styles.card}>
          <Skeleton width={100} height={12} />
          <View style={styles.scoreRow}>
            <Skeleton width={110} height={20} />
            <Skeleton width={110} height={20} />
          </View>
          <Skeleton height={6} borderRadius={radius.sm} />
        </Card>
      ))}
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
  roomStack: {
    gap: space[5],
  },
  clockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
  },
  clockLines: {
    gap: space[3],
  },
  board: {
    gap: BOARD_GAP,
  },
  boardRow: {
    flexDirection: 'row',
    gap: BOARD_GAP,
  },
  tile: {
    flex: 1,
  },
  scoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space[3],
  },
});
