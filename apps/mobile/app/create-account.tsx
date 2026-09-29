/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { radius, space, type } from '@/constants/tokens';
import { brand } from '@/constants/brand';
import { PASSWORD_REQUIREMENTS, PASSWORD_RULE_SENTENCE, checkPassword } from '@/constants/passwordRules';
import { Button, type ButtonStatus } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { useMotion } from '@/components/sp/motion';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { BrandLockup } from '@/components/shell/BrandBars';
import { Field } from '@/components/shell/Field';
import { getAuthErrorMessage, isSignupsPausedError } from '@/lib/authErrors';
import { validateUsername } from '@/lib/contentModeration';
import { useSession } from '@/lib/SessionProvider';
import { firstFailingRule } from '@/lib/shell/usernameRules';
import { clearSignInIntent, markSignInIntent } from '@/lib/shell/signInTransition';

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
//   [Sign in instead] in place of the primary action.

type UsernameError = string | null;

export default function CreateAccountScreen() {
  const { colors } = useTheme();
  const { signUp } = useSession();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<ButtonStatus>('idle');
  const [usernameError, setUsernameError] = useState<UsernameError>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const { reduced } = useMotion();
  const scrollRef = useRef<ScrollView>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  const passwordRules = PASSWORD_REQUIREMENTS.map((r) => ({ label: r.label, ok: r.test(password) }));

  function checkUsername(value: string): UsernameError {
    const trimmed = value.trim();
    if (!trimmed) return 'Please enter a username';
    const failing = firstFailingRule(trimmed);
    if (failing) return failing;
    // Spec: the client content check's message is exactly this (the checker's
    // own reason text is not shown).
    if (!validateUsername(trimmed).isValid) return 'Username is not allowed';
    return null;
  }

  async function handleCreate() {
    if (status !== 'idle') return;
    const uError = checkUsername(username);
    setUsernameError(uError);
    if (uError) return;
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
    const result = await signUp(email.trim(), password, username.trim());

    if (result.error) {
      clearSignInIntent();
      setStatus('idle');
      if (isSignupsPausedError(result.error)) {
        setPaused(true);
        // The banner sits under the form: drop the keyboard and bring it
        // into view (a jump under Reduce Motion).
        Keyboard.dismiss();
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: !reduced }), 0);
        return;
      }
      setFormError(getAuthErrorMessage(result.error, PASSWORD_RULE_SENTENCE, brand.name));
      return;
    }
    if (result.usernameTaken) {
      clearSignInIntent();
      setStatus('idle');
      setUsernameError('This username is already taken.');
      return;
    }
    if (result.needsConfirmation) {
      clearSignInIntent();
      setStatus('idle');
      Alert.alert('Success', 'Account created! Check your email to verify.');
      router.replace('/login');
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

  return (
    <AuthScaffold ref={scrollRef} footer={footer}>
      <BrandLockup />
      <View style={styles.heading}>
        <Text variant="display" accessibilityRole="header">
          Create account
        </Text>
        <Text variant="body" tone="secondary">
          Join the competition
        </Text>
      </View>
      <View style={styles.fields}>
        <Field
          label="Username"
          value={username}
          onChangeText={(v) => {
            setUsername(v);
            if (usernameError) setUsernameError(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username-new"
          textContentType="nickname"
          returnKeyType="next"
          onSubmitEditing={() => emailRef.current?.focus()}
          helper="Displayed on leaderboards"
          error={usernameError}
        />
        <Field
          ref={emailRef}
          label="Email address"
          value={email}
          onChangeText={setEmail}
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
          onChangeText={setPassword}
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
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={[styles.banner, { backgroundColor: colors.warnTint, borderColor: colors.warnLine }]}
        >
          <Text variant="body" style={styles.bold}>
            {`${brand.name} is not open for new signups yet — check back soon. Existing accounts can still sign in.`}
          </Text>
        </View>
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
  banner: {
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space[5],
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
