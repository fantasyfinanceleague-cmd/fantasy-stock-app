/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { space } from '@/constants/tokens';
import { Button, type ButtonStatus } from '@/components/sp/Button';
import { EmptyState } from '@/components/sp/EmptyState';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { Field } from '@/components/shell/Field';
import { getAuthErrorMessage } from '@/lib/authErrors';
import { ScreenTitle } from '@/components/shell/ScreenTitle';
import { supabase } from '@/lib/supabase';
import { buildRecoveryRedirect } from '@/lib/recoveryLink';
import { pkceCryptoReady } from '@/lib/auth/pkceCrypto';
import { resetCooldown, RESEND_TOO_SOON } from '@/lib/auth/resendCooldown';
import { verifierSlot } from '@/lib/auth/verifierStorage';
import { withVerifierKept } from '@/lib/auth/verifierSlot';
import { FIXTURE_NETWORK_MS, SHELL_FIXTURE } from '@/lib/shell/devFixture';

// Phase 3b-1 — Forgot password + "Check your email" (spec row 4; board
// "Forgot password", "Check your email"). Existing strings kept verbatim in
// sentence case ("Forgot password?", "Send reset link", "Back to sign in",
// "Didn't receive it? Send again", and the original description). The
// sent state's explanation line is the board's new copy, as the spec allows.
// Errors are inline and instant (§4). F2 (session fixation) is closed by PKCE
// now: the reset is bound to this device by the code verifier supabase-js stores.

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<ButtonStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function handleResetPassword() {
    if (status === 'loading') return;
    if (!email) {
      setError('Please enter your email address');
      return;
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address');
      return;
    }

    // The floor (lib/auth/resendCooldown.ts): a repeat inside GoTrue's interval would fail AND delete the
    // verifier the first, still-valid reset email needs. "Send again" re-enters here, so it is covered too.
    if (resetCooldown.remainingMs(email) > 0) {
      setError(getAuthErrorMessage(RESEND_TOO_SOON));
      return;
    }

    setError(null);
    setStatus('loading');

    if (SHELL_FIXTURE) {
      // DEV fixture (lib/shell/devFixture.ts): show the sent state without
      // emailing anyone — no network, no verifier.
      setTimeout(() => {
        setStatus('idle');
        setSent(true);
      }, FIXTURE_NETWORK_MS);
      return;
    }

    // PKCE binds this reset to THIS device: supabase-js stores a code verifier before the request (flowType
    // 'pkce', lib/supabase.ts) and the emailed link carries only a one-time code that exchanges with it
    // (lib/recoveryLink.ts, app/_layout.tsx). Nothing else is generated here. A storage failure throws out
    // of resetPasswordForEmail BEFORE any email is sent; treat it like the old "could not start" case.
    let resetError: { message: string; code?: string } | null = null;
    if (!pkceCryptoReady()) {
      // No WebCrypto: auth-js would fall back to Math.random + the "plain" method. Refuse instead.
      setStatus('idle');
      setError('Could not start a secure password reset on this device. Please try again.');
      return;
    }
    try {
      // The ONE stored verifier is shared with a pending sign-up, and auth-js deletes it when this call fails:
      // keep it (lib/auth/verifierSlot.ts). A successful new reset supersedes the old flow, on purpose.
      // The floor is re-checked and marked INSIDE the critical section (same reasoning as SessionProvider.signUp):
      // two overlapping requests cannot both pass it, and a throw holds the floor too.
      const res = await withVerifierKept(
        verifierSlot,
        async () => {
          if (resetCooldown.remainingMs(email) > 0) return { tooSoon: true as const };
          try {
            const r = await supabase.auth.resetPasswordForEmail(email, { redirectTo: buildRecoveryRedirect() });
            if (!r.error) resetCooldown.markSent(email);
            return { tooSoon: false as const, r };
          } catch (e) {
            resetCooldown.markSent(email);
            throw e;
          }
        },
        (x) => x.tooSoon || !!x.r.error
      );
      if (res.tooSoon) {
        setStatus('idle');
        setError(getAuthErrorMessage(RESEND_TOO_SOON));
        return;
      }
      resetError = res.r.error;
    } catch {
      // (The floor was already held inside the critical section: see above.)
      setStatus('idle');
      setError('Could not start a secure password reset on this device. Please try again.');
      return;
    }

    setStatus('idle');

    if (resetError) {
      // The shared mapper (lib/authErrors.ts), never the server's own words (W4 Onboarding).
      setError(getAuthErrorMessage(resetError));
      return;
    }

    setSent(true);
  }

  const backToSignIn = () => router.replace('/login');

  if (sent) {
    return (
      <AuthScaffold back={{ label: 'Back to sign in', onPress: backToSignIn }}>
        <EmptyState
          icon={() => <Icon name="mail" size="title" tone="text2" />}
          title="Check your email"
          message={`We sent a reset link to ${email}. It opens the app to set a new password.`}
          actionLabel="Back to sign in"
          onAction={backToSignIn}
          secondaryActionLabel="Didn't receive it? Send again"
          onSecondaryAction={() => {
            setSent(false);
            handleResetPassword();
          }}
        />
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold back={{ label: 'Back to sign in', onPress: () => (router.canGoBack() ? router.back() : backToSignIn()) }}>
      <View style={styles.heading}>
        <ScreenTitle>Forgot password?</ScreenTitle>
        <Text variant="body" tone="secondary">
          Enter your email address and we&apos;ll send you a link to reset your password.
        </Text>
      </View>
      <Field
        label="Email address"
        value={email}
        onChangeText={(v) => {
          setEmail(v);
          if (error) setError(null);
        }}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={handleResetPassword}
        autoFocus
        error={error}
      />
      <Button label="Send reset link" status={status} onPress={handleResetPassword} />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: space[2],
  },
});
