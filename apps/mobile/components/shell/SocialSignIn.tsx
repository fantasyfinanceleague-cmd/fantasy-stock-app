/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { space } from '@/constants/tokens';
import { brand } from '@/constants/brand';
import { Button, type ButtonStatus } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { getAuthErrorMessage, isSignupsPausedError } from '@/lib/authErrors';
import { useSession } from '@/lib/SessionProvider';
import { isAppleSignInAvailable, isGoogleSignInAvailable, loadApple } from '@/lib/auth/socialSignIn';
import type { SocialSignInResult } from '@/lib/auth/socialOutcome';
import { SHELL_FIXTURE } from '@/lib/shell/devFixture';
import { clearSignInIntent, markSignInIntent } from '@/lib/shell/signInTransition';
import { setDeletedNotice } from '@/lib/account/deletedNotice';

// Onboarding W2 — Continue with Apple / Continue with Google (plan 2026-10-14: "Apple first on
// iOS, then Google, then email"). Labels are the plan's own. Apple's button is Apple's NATIVE
// button (App Review 4.8 and the HIG ask for it): it draws its own "Continue with Apple" in
// Apple's black/white styles, flipped with the theme. Google's is the sp Button; its look (and
// any Google mark) is the W1 board's call.
//
// Each button renders only when this build can actually use it (native module present, and for
// Google the client IDs configured), so a binary without the modules shows the email form alone.
//
// Outcomes: success → the session flip navigates (as email sign-in does, S4's ✓ hold);
// cancelled → nothing; signups closed → `onPaused` (Create account's banner) or the same text
// inline; anything else → the shared mapper, never the server's own words.

const HEIGHT = 52; // the md Button's minHeight, so the two sit as a pair
type Provider = 'apple' | 'google';

export function SocialSignIn({
  onPaused,
}: {
  /** The signups-closed refusal (Create account's banner). Without it the paused text shows inline. */
  onPaused?: () => void;
}) {
  const { resolvedTheme, colors } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const { signInWithApple, signInWithGoogle } = useSession();
  const [apple, setApple] = useState(false);
  const [google] = useState(() => !!SHELL_FIXTURE || isGoogleSignInAvailable());
  const [busy, setBusy] = useState<Provider | null>(null);
  const [googleStatus, setGoogleStatus] = useState<ButtonStatus>('idle');

  useEffect(() => {
    let live = true;
    isAppleSignInAvailable().then((ok) => {
      if (live) setApple(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  async function run(provider: Provider) {
    if (busy) return;
    setDeletedNotice(false); // "Your account is deleted." is shown once; the next sign-in attempt spends it
    setError(null);
    setBusy(provider);
    if (provider === 'google') setGoogleStatus('loading');
    markSignInIntent();
    const result: SocialSignInResult = provider === 'apple' ? await signInWithApple() : await signInWithGoogle();
    if (result.kind === 'signedIn') {
      if (provider === 'google') setGoogleStatus('done');
      return; // the session flip takes over; this screen unmounts
    }
    clearSignInIntent();
    setBusy(null);
    setGoogleStatus('idle');
    if (result.kind !== 'error') return; // cancelled / unavailable: say nothing
    if (isSignupsPausedError(result.error) && onPaused) {
      onPaused();
      return;
    }
    setError(getAuthErrorMessage(result.error, undefined, brand.name));
  }

  const appleModule = apple ? loadApple() : null;
  if (!appleModule && !google) return null;

  return (
    <View style={styles.stack}>
      {appleModule ? (
        <View pointerEvents={busy ? 'none' : 'auto'} style={busy ? styles.dimmed : null}>
          <appleModule.AppleAuthenticationButton
            buttonType={appleModule.AppleAuthenticationButtonType.CONTINUE}
            buttonStyle={
              resolvedTheme === 'dark'
                ? appleModule.AppleAuthenticationButtonStyle.WHITE
                : appleModule.AppleAuthenticationButtonStyle.BLACK
            }
            cornerRadius={HEIGHT / 2}
            style={styles.apple}
            onPress={() => run('apple')}
          />
        </View>
      ) : null}
      {google ? (
        <Button
          label="Continue with Google"
          variant="secondary"
          status={googleStatus}
          disabled={busy === 'apple'}
          onPress={() => run('google')}
        />
      ) : null}
      {error ? (
        <Text variant="callout" color={colors.danger} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: space[3],
  },
  apple: {
    height: HEIGHT,
    width: '100%',
  },
  dimmed: {
    opacity: 0.5,
  },
});
