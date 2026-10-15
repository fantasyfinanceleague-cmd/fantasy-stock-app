/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import type { ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space } from '@/constants/tokens';
import { Icon } from '@/components/sp/Icon';
import { Sheet } from '@/components/sp/Sheet';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { FinalVignette, RosterVignette, VersusVignette, type VignetteProps } from '@/components/shell/onboarding/Vignettes';
import { ONBOARDING_CARDS } from '@/components/shell/onboarding/sampleData';

// Onboarding W4 — "How it works" in Profile (board #1.3 frame 8): the three onboarding cards,
// still, for anyone who skipped them or wants them again. Each row is the card's own line (Giorgio's
// words, unchanged) beside a thumbnail of its scene, the SAME scene components the cards use
// (their final frame, no motion). The thumbnails are decorative: the line carries the meaning.

const SCENES: ComponentType<VignetteProps>[] = [RosterVignette, VersusVignette, FinalVignette];
/** The scene's own layout width (the cards' art panel on a 17e) scaled into the thumbnail. */
const SCENE_WIDTH = 308;
/** 96pt tall and 0.34x: the FINAL scene's winner line sat on the 88pt thumbnail's rounded edge and was clipped. */
const THUMB = { width: 120, height: 96 } as const;
const SCALE = 0.34;

export function HowItWorksSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, space[5]) + space[3] }]}>
        <View style={styles.header}>
          <Text variant="title" accessibilityRole="header">
            How it works
          </Text>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
            <View>
              <Icon name="close" size="title" tone="text2" />
            </View>
          </Pressable>
        </View>
        {ONBOARDING_CARDS.map((line, i) => {
          const Scene = SCENES[i];
          return (
            <View key={line} style={styles.row}>
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                style={[styles.thumb, THUMB, { backgroundColor: colors.inset }]}
              >
                <View style={{ width: SCENE_WIDTH, transform: [{ scale: SCALE }] }}>
                  <Scene active still />
                </View>
              </View>
              <Text variant="headline" numberOfLines={0} maxFontSizeMultiplier={1.4} style={styles.line}>
                {line}
              </Text>
            </View>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: space[6],
    paddingTop: space[3],
    gap: space[4],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  close: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
  },
  thumb: {
    borderRadius: radius.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  line: {
    flex: 1,
  },
});
