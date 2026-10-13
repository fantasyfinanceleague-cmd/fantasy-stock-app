/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import { radius, space } from '@/constants/tokens';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { rangeLook, rangeTabWidth, type RangeVariant } from '@/components/sp/logic/gameNight';

// Stockpile — <RangePills>, Game Night (§9C "RangePills"): the chart's range picker.
//   - `tabs` (Home): text tabs, the selected one in `text` with a 2pt `accent` underline;
//   - `pills` (money screens): the selected one a filled `accent` pill with `onAccent` ink.
// The ranges are the caller's (Home: Season / 1M / 1W; a stock: 1W / 1M / 3M / 1Y). Every
// option is a 44pt target; the selected one doesn't re-fire.

export interface RangePillsProps<R extends string> {
  options: readonly R[];
  value: R;
  onChange: (next: R) => void;
  variant: RangeVariant;
  /** Where the row sits: Home's tabs sit at the end of the line; money pills at the start. */
  align?: 'start' | 'end';
}

const UNDERLINE = 2;
// The tab bar's and SegmentedControl's Dynamic Type ceiling (GS-3), so range labels never truncate.
const LABEL_MAX_SCALE = 1.3;

export function RangePills<R extends string>({ options, value, onChange, variant, align = variant === 'tabs' ? 'end' : 'start' }: RangePillsProps<R>) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  // `tabs`: every box the same width (the widest label + 16, at least 44), the label centred,
  // so the labels sit evenly apart; the boxes touch, so no shared hit areas (no hitSlop).
  const tabWidth = variant === 'tabs' ? rangeTabWidth(options, fontScale) : undefined;
  return (
    <View accessibilityRole="tablist" style={[styles.row, variant === 'tabs' ? styles.rowTabs : styles.rowPills, { justifyContent: align === 'end' ? 'flex-end' : 'flex-start' }]}>
      {options.map((option) => {
        const selected = option === value;
        const look = rangeLook(variant, selected, colors);
        return (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            hitSlop={variant === 'tabs' ? undefined : 8}
            onPress={() => {
              if (selected) return;
              Haptics.selectionAsync().catch(() => {});
              onChange(option);
            }}
            style={[styles.option, variant === 'pills' ? styles.pill : [styles.tab, { width: tabWidth }], look.fill ? { backgroundColor: look.fill } : null]}
          >
            {variant === 'tabs' ? (
              // The underline spans the LABEL, not the box: this view hugs the text.
              <View testID="range-tab-label">
                <Text variant="callout" color={look.ink} maxFontSizeMultiplier={LABEL_MAX_SCALE} style={selected ? styles.selected : styles.idle}>{option}</Text>
                <View style={[styles.underline, { backgroundColor: look.underline ?? 'transparent' }]} />
              </View>
            ) : (
              <Text variant="callout" color={look.ink} maxFontSizeMultiplier={LABEL_MAX_SCALE} style={selected ? styles.selected : styles.idle}>{option}</Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // Equal boxes that touch: the space between labels is each box's own 16 (W4 gate).
  rowTabs: {
    gap: 0,
  },
  rowPills: {
    gap: 6,
  },
  option: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // §9B: every option is a 44pt target, the text tabs too.
  tab: {
    minWidth: 44,
    paddingTop: space[2],
    alignItems: 'center',
  },
  pill: {
    minWidth: 44,
    paddingHorizontal: space[4],
    borderRadius: radius.pill,
    minHeight: 32,
    marginVertical: 6,
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
  idle: {
    fontWeight: '600',
  },
});
