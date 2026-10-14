/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, View } from 'react-native';

import { radius, space, type } from '@/constants/tokens';
import { Card } from '@/components/sp/Card';
import { Icon } from '@/components/sp/Icon';
import type { IconName } from '@/components/sp/logic/icon';
import { PressableScale } from '@/components/sp/PressableScale';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { BrandLockup } from '@/components/shell/BrandBars';
import { ScreenTitle } from '@/components/shell/ScreenTitle';

// Phase 3b-1 — Get started (spec row 7, board "Get started"; D1 ruling).
// Shown at the end of onboarding, signed out. Each choice records where the
// user was heading, then goes to Create account; after auth (and a
// username) the app resumes straight into create-league / join-league.
// "Already have an account? Sign in" is the existing string (D1).
// The heading line and both descriptions are the board's new copy.
//
// Game Night (W4 Onboarding): each choice is the §9C Card (surface + rim, no shadow); its icon
// sits on an `inset` tile in `text`, not the accent, because the accent means live, your turn
// or selected (§9C rule 3) and neither choice is any of those. The one accent on the screen is
// the "Sign in" link.

export interface GetStartedProps {
  onCreate: () => void;
  onJoin: () => void;
  onSignIn: () => void;
}

export function GetStarted({ onCreate, onJoin, onSignIn }: GetStartedProps) {
  const { colors } = useTheme();
  return (
    <>
      <BrandLockup />
      <View style={styles.heading}>
        <ScreenTitle>Get started</ScreenTitle>
        <Text variant="body" tone="secondary">
          Start a league for your friends, or join one with a code.
        </Text>
      </View>
      <View style={styles.choices}>
        <Choice icon="add" title="Create a league" description="Pick the rules, invite friends, set the draft." onPress={onCreate} />
        <Choice icon="trophy" title="Join with a code" description="Got a code from a friend? Enter it here." onPress={onJoin} />
      </View>
      <Pressable onPress={onSignIn} accessibilityRole="link" style={styles.switch} hitSlop={8}>
        <Text variant="body" tone="secondary" style={styles.center}>
          Already have an account? <Text variant="body" color={colors.accent} style={styles.bold}>Sign in</Text>
        </Text>
      </Pressable>
    </>
  );
}

function Choice({
  icon,
  title,
  description,
  onPress,
}: {
  icon: IconName;
  title: string;
  description: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${description}`}>
      <Card style={styles.choice}>
        <View style={[styles.tile, { backgroundColor: colors.inset }]}>
          <Icon name={icon} size="title" tone="text" />
        </View>
        <View style={styles.choiceText}>
          <Text variant="headline" style={styles.bold}>
            {title}
          </Text>
          <Text variant="callout" tone="secondary">
            {description}
          </Text>
        </View>
        <Icon name="chevronRight" size="body" tone="text2" />
      </Card>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: space[2],
  },
  choices: {
    gap: space[5],
  },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[5],
    padding: space[6] - 2,
    borderRadius: radius.lg,
  },
  tile: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  choiceText: {
    flex: 1,
    gap: space[1],
  },
  bold: {
    fontFamily: type.headline.fontFamily,
  },
  switch: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  center: {
    textAlign: 'center',
  },
});
