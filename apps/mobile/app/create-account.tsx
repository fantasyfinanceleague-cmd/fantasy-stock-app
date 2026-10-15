/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { space, type } from '@/constants/tokens';
import { brand } from '@/constants/brand';
import { PASSWORD_REQUIREMENTS, PASSWORD_RULE_SENTENCE, checkPassword } from '@/constants/passwordRules';
import { Button, type ButtonStatus } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { WarnPanel } from '@/components/sp/WarnPanel';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { BrandLockup } from '@/components/shell/BrandBars';
import { ConfirmEmailSent } from '@/components/shell/ConfirmEmailSent';
import { Field } from '@/components/shell/Field';
import { ScreenTitle } from '@/components/shell/ScreenTitle';
import { SocialSignIn } from '@/components/shell/SocialSignIn';
import { getAuthErrorMessage, isSignupsPausedError } from '@/lib/authErrors';
import { useSession } from '@/lib/SessionProvider';
import { clearSignInIntent, markSignInIntent } from '@/lib/shell/signInTransition';
import { CAPTURE } from '@/lib/shell/captureDev';

// Phase 3b-1 — Create account (spec rows 2–3; board "Create account" and
// "Create account · sign-ups paused"). Split out of the old combined
// login.tsx; its strings are kept verbatim in sentence case ("Create
// account", "Join the competition", "Displayed on leaderboards",
// "Already have an account? Sign in", the password rule labels).
//
// - The primary action is docked under the form and rides above the
//   keyboard (AuthScaffold's footer).
// - Password rules check off live (the real 5-rule server policy,
//   constants/passwordRules.ts; the board mock shows 3).
// - Every error is inline and appears INSTANTLY (§4).
// - When the server's signup gate refuses, the form stays and a warn-tint
//   banner carries Giorgio's final text verbatim through brand.name, with
//   [Sign in instead] in place of the primary action. Game Night (W4 Onboarding): the banner
//   is the shared WarnPanel, its text in the fill's own `warnText` ink (§9C rule 4).
//
// Onboarding W2 (plan 2026-10-14):
// - Continue with Apple / Google sit above the email form; a first social sign-in IS an account
//   creation, so it meets the same signup gate and shows the same banner.
// - The username field is gone: every new account reaches the pick-username gate (its profile row
//   has a NULL username), which W4 pre-fills.
// - Email confirmation is ON: success shows "Check your email" (ConfirmEmailSent), and the
//   email's link returns into the app and continues the flow.

export default function CreateAccountScreen() {
  const { colors } = useTheme();
  const { signUp } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<ButtonStatus>('idle');
  const [formError, setFormError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { reduced } = useMotion();
  const scrollRef = useRef<ScrollView>(null);
  const passwordRef = useRef<TextInput>(null);
  // A ref, not the `status` state: two taps in one frame both read the same stale value.
  const creating = useRef(false);

  const passwordRules = PASSWORD_REQUIREMENTS.map((r) => ({ label: r.label, ok: r.test(password) }));

  /** The signups-paused refusal: the panel replaces the primary, the keyboard drops and the panel
   * scrolls into view (a jump under Reduce Motion). */
  function showPaused() {
    setPaused(true);
    Keyboard.dismiss();
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !reduced }), 0);
  }

  // DEV captures only (lib/shell/captureKnobs.ts): take the SAME refusal path once the form has
  // laid out, so the capture shows what a real refusal shows (the panel scrolled into view).
  useEffect(() => {
    if (!CAPTURE.signupPaused) return;
    const t = setTimeout(showPaused, 600);
    return () => clearTimeout(t);
    // Mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleCreate() {
    if (status !== 'idle' || creating.current) return;
    if (!email || !password) {
      setFormError('Please enter email and password');
      return;
    }
    const { failing } = checkPassword(password);
    if (failing.length > 0) {
      setFormError(`Your password needs: ${failing.map((r) => r.label.toLowerCase()).join(', ')}.`);
      return;
    }
    setFormError(null);
    setStatus('loading');
    markSignInIntent();
    creating.current = true;
    const result = await signUp(email.trim(), password);
    creating.current = false;

    if (result.error) {
      clearSignInIntent();
      setStatus('idle');
      if (isSignupsPausedError(result.error)) {
        showPaused();
        return;
      }
      setFormError(getAuthErrorMessage(result.error, PASSWORD_RULE_SENTENCE, brand.name));
      return;
    }
    if (result.needsConfirmation) {
      clearSignInIntent();
      setStatus('idle');
      Keyboard.dismiss();
      setSentTo(email.trim());
      return;
    }
    // Signed straight in: the session flip navigates (and shows Pick a
    // username first if the profile has none).
    setStatus('done');
  }

  const footer = paused ? (
    <Button label="Sign in instead" variant="secondary" onPress={() => router.replace('/login')} />
  ) : (
    <>
      <Button label="Create account" status={status} onPress={handleCreate} />
      <Pressable onPress={() => router.replace('/login')} accessibilityRole="link" style={styles.switch} hitSlop={8}>
        <Text variant="body" tone="secondary" style={styles.center}>
          Already have an account? <Text variant="body" color={colors.accent} style={styles.bold}>Sign in</Text>
        </Text>
      </Pressable>
    </>
  );

  if (sentTo) {
    return (
      <ConfirmEmailSent
        email={sentTo}
        onResend={() => signUp(sentTo, password)}
        onBack={() => router.replace('/login')}
      />
    );
  }

  return (
    <AuthScaffold ref={scrollRef} footer={footer}>
      <BrandLockup />
      <View style={styles.heading}>
        <ScreenTitle>Create account</ScreenTitle>
        <Text variant="body" tone="secondary">
          Join the competition
        </Text>
      </View>
      {paused ? null : <SocialSignIn onPaused={showPaused} />}
      <View style={styles.fields}>
        <Field
          label="Email address"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            if (formError) setFormError(null);
          }}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          invalid={!!formError && !email}
        />
        <Field
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            if (formError) setFormError(null); // a stale "needs: …" must not sit under a now-valid password
          }}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={handleCreate}
          error={formError}
          rules={passwordRules}
        />
      </View>
      {paused ? (
        <WarnPanel text={`${brand.name} is not open for new signups yet — check back soon. Existing accounts can still sign in.`} />
      ) : null}
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  heading: {
    gap: space[2],
  },
  fields: {
    gap: space[5],
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
