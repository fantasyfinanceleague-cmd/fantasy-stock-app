/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Constants from 'expo-constants';

import { radius, space, type } from '@/constants/tokens';
import { brand } from '@/constants/brand';
import { Avatar } from '@/components/sp/Avatar';
import { FULL_WIDTH_FONT_SCALE } from '@/components/sp/Button';
import { Card } from '@/components/sp/Card';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { useTheme, type ThemePreference } from '@/components/sp/ThemeProvider';

// Phase 3b-1 — Profile (spec row 11, board "Profile"). It left the tab bar;
// the Home avatar opens it. Username (→ the Pick-a-username validation in
// edit mode), email once, Change password, Appearance, Sign out (danger
// text), and the real app version from app.json (Constants.expoConfig) —
// the old screen hard-coded "Version 1.0.0". Account created / Last sign in
// / the emoji avatar picker / "Open Web App" are dropped (Design Lead,
// approved).
//
// Game Night (W4 Onboarding): each group is the §9C Card (surface + rim, no shadow) and its
// rows are divided by SPACE, never a line (rule 2, the League settings rows' RowDivider);
// the chevron is the drawn sp/Icon.

const APPEARANCE_LABEL: Record<ThemePreference, string> = { system: 'System', light: 'Light', dark: 'Dark' };

/** The standout stays loudest (W4 gate §5): your username heading is `title`, 22pt capped at
 * 1.6× (35.2pt). The rows and the version line are body/caption with no ceiling of their own, so
 * at XXXL they reached ~47pt, louder than the name they belong to. Capped at 2× (body 30pt). */
export const PROFILE_ROW_MAX_SCALE = 2;

export interface ProfileViewProps {
  username: string | null;
  email: string | null;
  onUsername: () => void;
  onChangePassword: () => void;
  onAppearance: () => void;
  onSignOut: () => void;
}

export function ProfileView({ username, email, onUsername, onChangePassword, onAppearance, onSignOut }: ProfileViewProps) {
  const { preference } = useTheme();
  const version = Constants.expoConfig?.version ?? '';

  return (
    <>
      <View style={styles.identity}>
        <Avatar name={username ?? email ?? ''} size={84} />
        {username ? (
          <Text variant="title" accessibilityRole="header">
            {username}
          </Text>
        ) : null}
      </View>

      <Card style={styles.card}>
        <Row label="Username" value={username ?? ''} onPress={onUsername} />
        <RowGap />
        <Row label="Email" value={email ?? ''} />
        <RowGap />
        <Row label="Change password" onPress={onChangePassword} />
        <RowGap />
        <Row label="Appearance" value={APPEARANCE_LABEL[preference]} onPress={onAppearance} />
      </Card>

      <Card style={styles.card}>
        <Row label="Sign out" onPress={onSignOut} danger />
      </Card>

      <Text variant="caption" tone="secondary" maxFontSizeMultiplier={PROFILE_ROW_MAX_SCALE} style={styles.version}>
        {`${brand.name} ${version}`}
      </Text>
    </>
  );
}

/** Between rows: space, never a line (§9C rule 2). */
function RowGap() {
  return <View style={styles.rowGap} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />;
}

function Row({ label, value, onPress, danger = false }: { label: string; value?: string; onPress?: () => void; danger?: boolean }) {
  const { colors } = useTheme();
  // At accessibility sizes the value moves under its label (full width, wrapping)
  // instead of being squeezed into an ellipsis beside it — nothing truncates.
  const { fontScale } = useWindowDimensions();
  const stacked = fontScale >= FULL_WIDTH_FONT_SCALE;
  const text = (
    <View style={stacked ? styles.rowTextStacked : styles.rowTextInline}>
      <Text variant="body" color={danger ? colors.danger : colors.text} maxFontSizeMultiplier={PROFILE_ROW_MAX_SCALE} style={styles.rowLabel}>
        {label}
      </Text>
      {value ? (
        <Text variant="body" tone="secondary" numberOfLines={stacked ? undefined : 1} maxFontSizeMultiplier={PROFILE_ROW_MAX_SCALE} style={stacked ? null : styles.rowValue}>
          {value}
        </Text>
      ) : null}
    </View>
  );
  const content = (
    <>
      {text}
      {onPress && !danger ? <Icon name="chevronRight" size="callout" tone="text2" /> : null}
    </>
  );
  const rowStyle = styles.row;
  if (!onPress) {
    return (
      <View style={rowStyle} accessible accessibilityLabel={value ? `${label}, ${value}` : label}>
        {content}
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={value ? `${label}, ${value}` : label} style={rowStyle}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  identity: {
    alignItems: 'center',
    gap: space[3],
    paddingTop: space[2],
  },
  card: {
    borderRadius: radius.lg,
    paddingHorizontal: space[5],
    paddingVertical: space[2],
  },
  // SetupRows' RowDivider: the same 8pt between rows as League settings.
  rowGap: {
    height: space[2],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
    minHeight: 50,
    paddingVertical: space[4],
  },
  rowTextInline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[4],
  },
  rowTextStacked: {
    flex: 1,
    gap: space[1],
  },
  rowLabel: {
    fontFamily: type.headline.fontFamily,
  },
  rowValue: {
    flex: 1,
    textAlign: 'right',
  },
  version: {
    textAlign: 'center',
  },
});
