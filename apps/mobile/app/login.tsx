/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles` is declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { space, type } from '@/constants/tokens';
import { brand } from '@/constants/brand';
import { PASSWORD_RULE_SENTENCE } from '@/constants/passwordRules';
import { Button, type ButtonStatus } from '@/components/sp/Button';
import { Text } from '@/components/sp/Text';
import { useTheme } from '@/components/sp/ThemeProvider';
import { AuthScaffold } from '@/components/shell/AuthScaffold';
import { BrandLockup } from '@/components/shell/BrandBars';
import { Field } from '@/components/shell/Field';
import { getAuthErrorMessage } from '@/lib/authErrors';
import { useSession } from '@/lib/SessionProvider';
import { clearSignInIntent, markSignInIntent } from '@/lib/shell/signInTransition';

// Phase 3b-1 — Sign in (spec row 1, board "Sign in"). Strings verbatim from
// the previous login.tsx, sentence case: "Welcome back", "Sign in to your
// league", "Forgot password?", "New here? Create an account", "Sign in".
//
// S4: the brand bars rise on arrival; the button goes loading → ✓ done, and
// the root layout holds the ✓ for `quick` before the app crossfades and
// scales in (lib/shell/signInTransition.ts). The session flip is the
// navigation — nothing here calls the router on success.
//
// Create account moved to its own screen (app/create-account.tsx; board
// "Create account"), so this file is sign-in only.

export default function SignInScreen() {
  const { colors } = useTheme();
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<ButtonStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInput>(null);

  async function handleSignIn() {
    if (status !== 'idle') return;
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }
    setError(null);
    setStatus('loading');
    markSignInIntent();
    const { error: authError } = await signIn(email.trim(), password);
    if (authError) {
      clearSignInIntent();
      setStatus('idle');
      setError(getAuthErrorMessage(authError, PASSWORD_RULE_SENTENCE, brand.name));
      return;
    }
    setStatus('done');
  }

  return (
    <AuthScaffold>
      <View style={styles.brand}>
        <BrandLockup />
      </View>
      <View style={styles.heading}>
        <Text variant="display" accessibilityRole="header">
          Welcome back
        </Text>
        <Text variant="body" tone="secondary">
          Sign in to your league
        </Text>
      </View>
      <View style={styles.fields}>
        <Field
          label="Email address"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="username"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          invalid={!!error && !email}
        />
        <Field
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={handleSignIn}
          error={error}
        />
        <Pressable
          onPress={() => router.push('/forgot-password')}
          accessibilityRole="link"
          style={styles.forgot}
          hitSlop={8}
        >
          <Text variant="body" color={colors.accent} style={styles.bold}>
            Forgot password?
          </Text>
        </Pressable>
      </View>
      <Button label="Sign in" status={status} onPress={handleSignIn} />
      <Pressable onPress={() => router.push('/create-account')} accessibilityRole="link" style={styles.switch} hitSlop={8}>
        <Text variant="body" tone="secondary" style={styles.center}>
          New here? <Text variant="body" color={colors.accent} style={styles.bold}>Create an account</Text>
        </Text>
      </Pressable>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  brand: {
    paddingTop: space[7],
  },
  heading: {
    gap: space[2],
  },
  fields: {
    gap: space[5],
  },
  forgot: {
    alignSelf: 'flex-end',
    minHeight: 32,
    justifyContent: 'center',
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
