/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { space } from '@/constants/tokens';
import { Button, type ButtonStatus } from '@/components/sp/Button';
import { Card } from '@/components/sp/Card';
import { EmptyState } from '@/components/sp/EmptyState';
import { Text } from '@/components/sp/Text';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { Field } from '@/components/shell/Field';
import { supabase } from '@/lib/supabase';
import { generateRecoveryNonce, storeRecoveryNonce } from '@/lib/recoveryNonce';

// Phase 3b-1 — Forgot password + "Check your email" (spec row 4; board
// "Forgot password", "Check your email"). Existing strings kept verbatim in
// sentence case ("Forgot password?", "Send reset link", "Back to sign in",
// "Didn't receive it? Send again", and the original description). The
// sent state's explanation line is the board's new copy, as the spec allows.
// Errors are inline and instant (§4). The recovery-nonce logic below is
// unchanged (F2).

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

    setError(null);
    setStatus('loading');

    // Bind this reset to a per-request nonce so only a link WE requested on THIS
    // device can complete the recovery (fixes F2: deep-link session fixation).
    // The nonce is stored single-use and echoed back via redirectTo; the genuine
    // Supabase email redirects to fantasystockapp://reset-password?rn=<nonce>#...,
    // and app/_layout.tsx refuses to set a session unless the inbound rn matches.
    const nonce = generateRecoveryNonce();
    const stored = await storeRecoveryNonce(nonce);
    if (!stored) {
      setStatus('idle');
      setError('Could not start a secure password reset on this device. Please try again.');
      return;
    }

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `fantasystockapp://reset-password?rn=${encodeURIComponent(nonce)}`,
    });

    setStatus('idle');

    if (resetError) {
      setError(resetError.message);
      return;
    }

    setSent(true);
  }

  const backToSignIn = () => router.replace('/login');

  if (sent) {
    return (
      <AuthScaffold back={{ label: 'Back to sign in', onPress: backToSignIn }}>
        <Card>
          <EmptyState
            icon={(p) => <Ionicons name="mail-outline" {...p} />}
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
        </Card>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold back={{ label: 'Back to sign in', onPress: () => (router.canGoBack() ? router.back() : backToSignIn()) }}>
      <View style={styles.heading}>
        <Text variant="display" accessibilityRole="header">
          Forgot password?
        </Text>
        <Text variant="body" tone="secondary">
          Enter your email address and we&apos;ll send you a link to reset your password.
        </Text>
      </View>
      <Field
        label="Email address"
        value={email}
        onChangeText={setEmail}
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
