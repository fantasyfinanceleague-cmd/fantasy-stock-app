/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { space } from '@/constants/tokens';
import { brand } from '@/constants/brand';
import { CONFIRM_EMAIL_COPY as COPY, confirmSentBody } from '@/constants/confirmEmailCopy';
import { EmptyState } from '@/components/sp/EmptyState';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { getAuthErrorMessage } from '@/lib/authErrors';
import type { AuthResult } from '@/lib/SessionProvider';

// Onboarding W2 — "Check your email" after an email sign-up (plan 2026-10-14: email confirmation
// ON; "the forgot-password pattern"). The words are Giorgio's approved copy, in
// constants/confirmEmailCopy.ts. The email's link is the https universal link
// (lib/auth/confirmLink.ts; no invite code rides on it, decision 17): with the app installed it opens the app
// and the flow continues from there; confirming on another device lands on the web app's /auth/confirm page, and
// the person signs in here with their password.
//
// "Send again" is the parent's: it repeats signUp() for the same address (SessionProvider explains why
// supabase.auth.resend() is not used with PKCE), so it needs the password the parent already holds.

export function ConfirmEmailSent({
  email,
  league,
  onResend,
  onBack,
}: {
  email: string;
  /** The pending invite's league name (W3 passes it); without one the body is the no-invite sentence. */
  league?: string | null;
  /** Sends the confirmation email again; the parent owns the credentials it needs. */
  onResend: () => Promise<AuthResult>;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A ref, not the `sending` state: two taps in one frame both read the same stale state value.
  const inFlight = useRef(false);

  async function resend() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setSending(true);
    let resendError: Awaited<ReturnType<typeof onResend>>['error'] = null;
    try {
      ({ error: resendError } = await onResend());
    } finally {
      inFlight.current = false;
      setSending(false);
    }
    if (resendError) setError(getAuthErrorMessage(resendError, undefined, brand.name));
  }

  return (
    <AuthScaffold back={{ label: COPY.back, onPress: onBack }}>
      <EmptyState
        icon={(p) => <Ionicons name="mail-outline" {...p} />}
        title={COPY.title}
        message={confirmSentBody(email, league)}
        actionLabel={COPY.back}
        onAction={onBack}
        secondaryActionLabel={COPY.resend}
        onSecondaryAction={resend}
      />
      {error ? (
        <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          <Text variant="callout" color={colors.danger}>
            {error}
          </Text>
        </View>
      ) : null}
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  error: {
    alignItems: 'center',
    paddingHorizontal: space[5],
  },
});
