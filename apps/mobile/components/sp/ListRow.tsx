/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { color, space } from '@/constants/tokens';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useSurface } from '@/components/sp/Surface';

// Stockpile — <ListRow> (Phase 2 foundation). A generic row for standings,
// holdings, league lists, settings — leading slot, title/subtitle, trailing
// slot, with the press affordance built in when `onPress` is given.

export interface ListRowProps {
  leading?: ReactNode;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  onPress?: () => void;
  /** Hides the trailing chevron even when `onPress` is set. */
  hideChevron?: boolean;
}

export function ListRow({ leading, title, subtitle, trailing, onPress, hideChevron }: ListRowProps) {
  const { kind } = useSurface();
  const onGame = kind === 'game';
  const chevronColor = onGame ? color.text.onGame.secondary : color.text.secondary;
  const dividerColor = onGame ? color.surface.game.line : color.border.default;

  const content = (
    <View style={[styles.row, { borderBottomColor: dividerColor }]}>
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
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
      {onPress && !hideChevron ? <Ionicons name="chevron-forward" size={18} color={chevronColor} /> : null}
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
    borderBottomWidth: StyleSheet.hairlineWidth,
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
