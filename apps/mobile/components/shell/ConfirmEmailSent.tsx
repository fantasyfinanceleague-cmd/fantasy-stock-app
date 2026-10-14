/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
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
import { useSession } from '@/lib/SessionProvider';

// Onboarding W2 — "Check your email" after an email sign-up (plan 2026-10-14: email confirmation
// ON; "the forgot-password pattern"). The words are Giorgio's approved copy, in
// constants/confirmEmailCopy.ts. The email's link returns into the app
// (lib/auth/confirmLink.ts) and the flow continues from there; confirming on another device
// leaves the person to sign in here with their password.

export function ConfirmEmailSent({
  email,
  league,
  onBack,
}: {
  email: string;
  /** The pending invite's league name (W3 passes it); without one the body is the no-invite sentence. */
  league?: string | null;
  onBack: () => void;
}) {
  const { colors } = useTheme();
  const { resendConfirmation } = useSession();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resend() {
    if (sending) return;
    setSending(true);
    setError(null);
    const { error: resendError } = await resendConfirmation(email);
    setSending(false);
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
