/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';

import { radius, space, type } from '@/constants/tokens';
import { Avatar } from '@/components/sp/Avatar';
import { Button, FULL_WIDTH_FONT_SCALE } from '@/components/sp/Button';
import { Card } from '@/components/sp/Card';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { WarnPanel } from '@/components/sp/WarnPanel';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { ScreenTitle } from '@/components/shell/ScreenTitle';
import { SocialSignIn } from '@/components/shell/SocialSignIn';
import { ARRIVAL_COPY, arrivalView } from '@/lib/invite/arrivalView';
import type { PendingInvite } from '@/lib/invite/usePendingInvite';
import { keepDots } from '@/lib/game/keepDots';

// Onboarding W4 — the signed-out arrival from an invite link (plan 2026-10-14, board frame 1):
// the league's disc, "{inviter} invited you to {league}", its facts, then Apple / Google / Use
// email. It never blocks on the preview and never shows an error page: while the preview loads, or
// is not found or unavailable, the title is the generic "You're invited to a league" and the buttons
// are all there (lib/invite/arrivalView.ts). A refusal (full, drafting, season over) is the shared
// WarnPanel with Join's own words, and replaces the sign-in buttons; "Sign in" stays for someone
// who already has an account. Signing in is the navigation: W3's auto-join takes over at 'ready'.

const PREVIEW_ROW_MAX_SCALE = 2;
const DISC = 64;

export function InviteArrival({ invite }: { invite: PendingInvite }) {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const stackRows = fontScale >= FULL_WIDTH_FONT_SCALE;
  const view = arrivalView(invite);

  return (
    <AuthScaffold>
      <View style={styles.head}>
        {view.avatarName ? (
          <Avatar name={view.avatarName} size={DISC} />
        ) : (
          <View style={[styles.disc, { backgroundColor: colors.inset }]}>
            <Icon name="trophy" size="title" tone="text2" />
          </View>
        )}
        <ScreenTitle>{view.title}</ScreenTitle>
        {view.unreachable ? (
          <Text variant="body" tone="secondary">
            {view.unreachable}
          </Text>
        ) : null}
      </View>
      {view.retry ? (
        <Pressable onPress={invite.retryPreview} accessibilityRole="button" style={styles.link}>
          <Text variant="body" color={colors.accent} style={styles.bold}>
            {ARRIVAL_COPY.tryAgain}
          </Text>
        </Pressable>
      ) : null}
      {view.rows.length > 0 ? (
        <Card style={styles.rows}>
          {view.rows.map((row) => (
            <View key={row.label} accessible accessibilityLabel={`${row.label}, ${row.value}`} style={stackRows ? styles.rowStacked : styles.row}>
              <Text variant="callout" tone="secondary" maxFontSizeMultiplier={PREVIEW_ROW_MAX_SCALE}>
                {row.label}
              </Text>
              <Text variant="callout" numberOfLines={0} maxFontSizeMultiplier={PREVIEW_ROW_MAX_SCALE} style={stackRows ? styles.rowValueStacked : styles.rowValue}>
                {keepDots(row.value)}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}
      {view.refusal ? <WarnPanel text={view.refusal} /> : null}
      {view.canJoin ? (
        <View style={styles.signIns}>
          <SocialSignIn />
          <Button label={ARRIVAL_COPY.useEmail} variant="secondary" onPress={() => router.push('/create-account')} />
        </View>
      ) : (
        <Pressable onPress={() => router.push('/login')} accessibilityRole="link" style={styles.link}>
          <Text variant="body" color={colors.accent} style={styles.bold}>
            {ARRIVAL_COPY.signIn}
          </Text>
        </Pressable>
      )}
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  head: {
    gap: space[3],
    paddingTop: space[7],
  },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rows: {
    borderRadius: radius.lg,
    paddingHorizontal: space[5],
    paddingVertical: space[2],
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: space[4],
    minHeight: 44,
    paddingVertical: space[3],
  },
  rowStacked: {
    gap: space[1],
    minHeight: 44,
    paddingVertical: space[3],
  },
  rowValueStacked: {
    fontFamily: type.headline.fontFamily,
    fontVariant: ['tabular-nums'],
  },
  rowValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontFamily: type.headline.fontFamily,
    fontVariant: ['tabular-nums'],
  },
  signIns: {
    gap: space[3],
  },
  link: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  bold: {
    fontFamily: type.headline.fontFamily,
  },
});
