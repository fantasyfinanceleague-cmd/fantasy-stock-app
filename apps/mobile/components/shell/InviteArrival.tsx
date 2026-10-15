/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { space, type } from '@/constants/tokens';
import { Avatar } from '@/components/sp/Avatar';
import { Button } from '@/components/sp/Button';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { FittedTitle } from '@/components/shell/FittedTitle';
import { useTheme } from '@/components/sp/ThemeProvider';
import { WARN_TEXT_MAX_SCALE, WarnPanel } from '@/components/sp/WarnPanel';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { SocialSignIn } from '@/components/shell/SocialSignIn';
import { ARRIVAL_COPY, arrivalView } from '@/lib/invite/arrivalView';
import type { PendingInvite } from '@/lib/invite/usePendingInvite';

// Onboarding W4 — the signed-out arrival from an invite link (plan 2026-10-14, board frame 1;
// Giorgio's "B" redraw): "{inviter} invited you to {league}" over the inviter's initials, centred in
// the space above the actions; Apple / Google / Use email dock at the bottom, in the thumb's reach.
// Nothing else: no facts before sign-in (the no-session preview carries only the name and the
// inviter). It never blocks on the preview and never shows an error page: while it loads, or is
// unavailable, the heading is the generic "You're invited to a league" and the buttons are all there
// (lib/invite/arrivalView.ts). A link that cannot be used (full, not taking players, a dead link) is
// the shared WarnPanel in the buttons' place, then "Sign in" for someone who already has an account
// (a dead link has no invite block, so its panel and link are centred rather than docked).
// Signing in is the navigation: W3's auto-join takes over at 'ready'.

const DISC = 64;

export function InviteArrival({ invite }: { invite: PendingInvite }) {
  const { colors } = useTheme();
  const view = arrivalView(invite);

  const actions = view.canJoin ? (
    <>
      <SocialSignIn />
      <Button label={ARRIVAL_COPY.useEmail} variant="secondary" onPress={() => router.push('/create-account')} />
    </>
  ) : (
    <>
      {view.refusal ? <WarnPanel text={view.refusal} /> : null}
      <Pressable onPress={() => router.push('/login')} accessibilityRole="link" style={styles.link}>
        <Text variant="body" maxFontSizeMultiplier={WARN_TEXT_MAX_SCALE} color={colors.accent} style={styles.bold}>
          {ARRIVAL_COPY.signIn}
        </Text>
      </Pressable>
    </>
  );

  // A dead link has no invite block above the actions, so docking them leaves an empty phone: the
  // panel and "Sign in" are CENTRED instead (the decided board, frame "a dead link"). Every other state
  // keeps the invite centred and the actions docked.
  if (!view.title) {
    return (
      <AuthScaffold centerBody>
        <View style={styles.actions}>{actions}</View>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold centerBody footer={<View style={styles.actions}>{actions}</View>}>
      {view.title ? (
        <View style={styles.block}>
          {view.mark.kind === 'inviter' ? (
            <Avatar name={view.mark.name} size={DISC} tone="neutral" />
          ) : (
            <View style={[styles.disc, { backgroundColor: colors.inset }]}>
              <Icon name="trophy" size="title" tone="text2" />
            </View>
          )}
          {view.titleParts ? <FittedTitle lead={view.titleParts.lead} name={view.titleParts.name} label={view.title ?? ''} /> : null}
          {view.unreachable ? (
            <Text variant="body" tone="secondary" style={styles.title}>
              {view.unreachable}
            </Text>
          ) : null}
          {view.retry ? (
            <Pressable onPress={invite.retryPreview} accessibilityRole="button" style={styles.link}>
              <Text variant="body" maxFontSizeMultiplier={WARN_TEXT_MAX_SCALE} color={colors.accent} style={styles.bold}>
                {ARRIVAL_COPY.tryAgain}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    gap: space[4],
  },
  disc: {
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heading: {
    alignSelf: 'stretch',
  },
  title: {
    textAlign: 'center',
  },
  actions: {
    gap: space[3],
  },
  link: {
    alignSelf: 'center',
    minHeight: 44,
    justifyContent: 'center',
  },
  bold: {
    fontFamily: type.headline.fontFamily,
  },
});
