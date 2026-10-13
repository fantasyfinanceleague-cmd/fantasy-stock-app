/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { rangeLook, TAB_LABEL_MAX_SCALE, TAB_MIN } from '@/components/sp/logic/gameNight';
import { segmentTabsScroll } from '@/lib/game/leagueView';

// Stockpile — <SegmentTabs>, Game Night (the board's League frame, `.dr-seg`): a page's
// sections as text tabs, left-aligned, the selected one in `text` at 800 with a 2pt `accent`
// underline under its LABEL; the rest `text2` at 600. The same look as Home's range tabs
// (rangeLook 'tabs'), so the two read as one system. Each tab is a 44pt target. When the
// tabs are wider than the screen (four at XL on the 17e) the row scrolls sideways rather
// than truncating a label; otherwise it sits still.

export interface SegmentTabsProps<V extends string> {
  options: readonly { label: string; value: V }[];
  value: V;
  onChange: (next: V) => void;
  /** The content width the row sits in (the screen less its gutters). */
  width: number;
}

const UNDERLINE = 2;

export function SegmentTabs<V extends string>({ options, value, onChange, width }: SegmentTabsProps<V>) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const scroll = segmentTabsScroll(options.map((o) => o.label), fontScale, width);
  const tabs = options.map((o) => {
    const selected = o.value === value;
    const look = rangeLook('tabs', selected, colors);
    return (
      <Pressable
        key={o.value}
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        accessibilityLabel={o.label}
        onPress={() => {
          if (selected) return;
          Haptics.selectionAsync().catch(() => {});
          onChange(o.value);
        }}
        style={styles.tab}
      >
        <View>
          {/* Each tab keeps its SELECTED (800) width whether or not it's selected, so the tabs
              never shift sideways when the selection moves (W4 capture): an invisible 800 copy
              sizes the box, the visible label sits centred over it. */}
          <Text variant="callout" numberOfLines={1} maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE} style={[styles.selected, styles.sizer]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{o.label}</Text>
          <View style={styles.labelOver} pointerEvents="none">
            <Text variant="callout" color={look.ink} numberOfLines={1} maxFontSizeMultiplier={TAB_LABEL_MAX_SCALE} style={selected ? styles.selected : styles.idle}>{o.label}</Text>
          </View>
          <View style={[styles.underline, { backgroundColor: look.underline ?? 'transparent' }]} />
        </View>
      </Pressable>
    );
  });
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="tablist" style={styles.bleed} contentContainerStyle={styles.row}>
        {tabs}
      </ScrollView>
    );
  }
  return (
    <View accessibilityRole="tablist" style={[styles.row, styles.bleed]}>
      {tabs}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // The tabs' own 8pt pads reach into the gutter, so the first LABEL sits on the content edge.
  bleed: {
    marginHorizontal: -space[3],
  },
  // The label + 8 each side (so 16 between labels), never under 44 (§9B: text tabs need
  // minWidth 44, not only hitSlop). The first label sits on the content's left edge.
  tab: {
    minWidth: TAB_MIN,
    minHeight: 44,
    paddingTop: space[2],
    paddingHorizontal: space[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  underline: {
    marginTop: space[1],
    alignSelf: 'stretch',
    height: UNDERLINE,
    borderRadius: 1,
  },
  selected: {
    fontWeight: '800',
  },
  sizer: {
    opacity: 0,
  },
  labelOver: {
    ...StyleSheet.absoluteFillObject,
    bottom: UNDERLINE + space[1],
    alignItems: 'center',
    justifyContent: 'center',
  },
  idle: {
    fontWeight: '600',
  },
});
