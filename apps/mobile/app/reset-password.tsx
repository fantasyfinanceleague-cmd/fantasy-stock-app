/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { space } from '@/constants/tokens';
import { brand } from '@/constants/brand';
import { PASSWORD_RULE_SENTENCE } from '@/constants/passwordRules';
import { EmptyState } from '@/components/sp/EmptyState';
import { Icon } from '@/components/sp/Icon';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { NewPasswordForm } from '@/components/shell/NewPasswordForm';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/useAuth';
import { isRecoverySession, setRecoverySession, subscribeRecoverySession } from '@/lib/auth/recoverySession';
import { resetScreenState, RESET_VERIFY_TIMEOUT_MS } from '@/lib/recoveryLink';
import { getAuthErrorMessage } from '@/lib/authErrors';
import { parseResetCaptureView } from '@/lib/shell/resetCaptureView';
import { pendingRoute } from '@/lib/shell/pendingRoute';

// DEV-only (design captures): render the form or success state without a recovery link.
const CAPTURE_VIEW = parseResetCaptureView(process.env.EXPO_PUBLIC_RESET_CAPTURE, __DEV__);

// Phase 3b-1 (spec row 5): rebuilt visually on the shell's Field / Button /
// EmptyState, with every string and ALL of the recovery logic below kept as
// it was (PR #41). Alerts became inline, instant errors (§4).
//
// This screen is reached only from the password-recovery deep link
// (app/_layout.tsx's handleDeepLink). Its state is decided by the pure
// resetScreenState() (lib/recoveryLink.ts):
//
//   - verifying: no `status=invalid` param yet, and the recovery-session
//     flag (lib/auth/recoverySession.ts) isn't set yet either. Covers the
//     brief window on cold start where this route is showing (expo-router
//     restored it from the link before anything else rendered) but the
//     async code exchange in _layout.tsx hasn't resolved — and also a URL
//     that routes here by PATH without the link handler ever seeing it
//     (the app opened this route some other way): _layout.tsx sets neither
//     a status nor the flag for those, so nothing but
//     RESET_VERIFY_TIMEOUT_MS moves this screen off "verifying".
//   - invalid: the link was rejected (a code that won't exchange: forged,
//     replayed, from another device), was already used, has expired, or
//     verifying simply timed out — no
//     recovery session was set. There's nothing to recover from here; the
//     user needs to request a new email.
//   - form: the recovery flag is set, so this is a real recovery in
//     progress. Deliberately NOT "is there any session" — a user already
//     signed in for an unrelated reason who lands here some other way
//     must not see the form; they fall through to verifying -> timeout ->
//     invalid instead, same as someone with no session at all.

export default function ResetPasswordScreen() {
  const { status } = useLocalSearchParams<{ status?: string }>();
  const { signOut } = useAuth();
  const { colors } = useTheme();
  const isRecovery = useSyncExternalStore(subscribeRecoverySession, isRecoverySession, isRecoverySession);
  const [success, setSuccess] = useState(CAPTURE_VIEW === 'success');
  const [verifyTimedOut, setVerifyTimedOut] = useState(false);

  // Bounded wait: if neither the recovery flag nor an explicit status ever
  // arrives (see the "verifying" case above), stop spinning and show "invalid".
  useEffect(() => {
    if (isRecovery || status === 'invalid') {
      return;
    }
    const timer = setTimeout(() => setVerifyTimedOut(true), RESET_VERIFY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [isRecovery, status]);

  const screenState = CAPTURE_VIEW === 'form' ? 'form' : resetScreenState({
    status,
    isRecovery,
    elapsedMs: verifyTimedOut ? RESET_VERIFY_TIMEOUT_MS : 0,
  });

  async function handleCancel() {
    // Only end a session THIS screen created. A recovery link signs the
    // device in as a side effect of recovering it, so leaving via Cancel
    // should undo that — but a user who reached this screen some other
    // way while already signed in for an unrelated reason keeps their
    // real session; Cancel just takes them home.
    if (isRecoverySession()) {
      // Drop a deep link the recovery hold was keeping BEFORE the flag clears: ending the hold would otherwise
      // open it while this recovery session is still signed in, a moment before the sign-out below.
      pendingRoute.dropHeld();
      setRecoverySession(false);
      await signOut();
    }
    router.replace('/');
  }

  async function updatePassword(password: string): Promise<string | null> {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) return getAuthErrorMessage(error, PASSWORD_RULE_SENTENCE, brand.name);
    setRecoverySession(false);
    return null;
  }

  if (success) {
    return (
      <AuthScaffold>
        <EmptyState
          icon={() => <Icon name="checkCircle" size="title" tone="text2" />}
          title="Password updated"
          message="You're signed in with your new password."
          actionLabel="Continue"
          onAction={() => router.replace('/')}
        />
      </AuthScaffold>
    );
  }

  if (screenState === 'verifying') {
    return (
      <AuthScaffold>
        <View style={styles.verifying}>
          <ActivityIndicator size="large" color={colors.accent} accessibilityLabel="Loading" />
          <Text variant="body" tone="secondary" style={styles.center}>
            Checking your reset link…
          </Text>
          <Pressable onPress={handleCancel} accessibilityRole="button" style={styles.link} hitSlop={8}>
            <Text variant="body" tone="secondary">
              Cancel
            </Text>
          </Pressable>
        </View>
      </AuthScaffold>
    );
  }

  if (screenState === 'invalid') {
    return (
      <AuthScaffold>
        <EmptyState
          icon={() => <Icon name="alert" size="title" tone="text2" />}
          title="This link didn't work"
          message="It may have expired, been used already, or been opened on a different device than the one that asked for it. Request a new link to continue."
          actionLabel="Request a new link"
          onAction={() => router.replace('/forgot-password')}
          secondaryActionLabel="Back to sign in"
          onSecondaryAction={handleCancel}
        />
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold>
      <NewPasswordForm submit={updatePassword} onDone={() => setSuccess(true)} onCancel={handleCancel} />
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  verifying: {
    alignItems: 'center',
    gap: space[5],
    paddingTop: space[11],
  },
  center: {
    textAlign: 'center',
  },
  link: {
    minHeight: 44,
    justifyContent: 'center',
  },
});
