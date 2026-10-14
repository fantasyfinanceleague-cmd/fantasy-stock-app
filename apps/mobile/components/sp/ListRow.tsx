/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { Icon } from '@/components/sp/Icon';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';

// Stockpile — <ListRow> (Phase 2 foundation). A generic row for standings,
// holdings, league lists, settings — leading slot, title/subtitle, trailing
// slot, with the press affordance built in when `onPress` is given.
// Game Night (§9C rule 2, gn-sweep): no rule line under a row; rows divide by
// space (their own 12pt padding), a surface step, or your side's tint.

export interface ListRowProps {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  /** A second line under `subtitle`, e.g. an ownership or status note that
   * needs its own colour or must never truncate — the caller renders its own
   * <Text>, so it controls both. */
  subtitle2?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Hides the trailing chevron even when `onPress` is set. */
  hideChevron?: boolean;
}

export function ListRow({ leading, title, subtitle, subtitle2, trailing, onPress, hideChevron }: ListRowProps) {
  const content = (
    <View style={styles.row}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.titles}>
        <Text variant="body" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="callout" tone="secondary" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {subtitle2 ?? null}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {onPress && !hideChevron ? <Icon name="chevronRight" size="body" tone="text2" /> : null}
    </View>
  );

  if (!onPress) return content;

  return (
    <PressableScale accessibilityRole="button" onPress={onPress} haptic={false}>
      {content}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space[4],
    gap: space[4],
  },
  leading: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  titles: {
    flex: 1,
    gap: 2,
  },
  trailing: {
    alignItems: 'flex-end',
  },
});
