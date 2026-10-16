/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { Skeleton } from '@/components/Skeleton';

// Stockpile — <PortfolioSkeleton> (W4, Game Night; UX rule 9: the shape, never a blank or a
// made-up number): the hero's value and two lines, the line's plot, the range pills, then
// four holding rows (disc, two lines, the value) in the places the real ones take.

const LOADING = 'Loading your portfolio';

/** `label`: what VoiceOver hears. `chart: false` is the leaguemate team view (no value line, no range pills). */
export function PortfolioSkeleton({ label = LOADING, chart = true }: { label?: string; chart?: boolean } = {}) {
  return (
    <View style={styles.blocks} accessible accessibilityLabel={label} accessibilityState={{ busy: true }}>
      <View style={styles.hero}>
        <Skeleton width={96} height={12} />
        <Skeleton width={220} height={44} borderRadius={8} />
        <Skeleton width={200} height={14} />
        <Skeleton width={150} height={14} />
        {chart ? (
          <>
            <Skeleton height={168} borderRadius={12} />
            <View style={styles.pills}>
              {[0, 1, 2].map((i) => <Skeleton key={i} width={56} height={32} borderRadius={16} />)}
            </View>
          </>
        ) : null}
      </View>
      <View style={styles.rows}>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.row}>
            <Skeleton width={40} height={40} borderRadius={20} />
            <View style={styles.lines}>
              <Skeleton width={64} height={14} />
              <Skeleton width={150} height={12} />
            </View>
            <Skeleton width={72} height={14} />
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  blocks: { gap: space[7] },
  hero: { gap: space[3] },
  pills: { flexDirection: 'row', gap: 6 },
  rows: { gap: space[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4], minHeight: 56 },
  lines: { flex: 1, gap: space[2] },
});
