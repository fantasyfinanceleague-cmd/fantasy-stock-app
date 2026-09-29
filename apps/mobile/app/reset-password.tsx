/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/lib/useAuth';
import { isRecoverySession, setRecoverySession, subscribeRecoverySession } from '@/lib/recoveryNonce';
import { resetScreenState, RESET_VERIFY_TIMEOUT_MS } from '@/lib/recoveryLink';
import { getAuthErrorMessage } from '@/lib/authErrors';
import { checkPassword, PASSWORD_RULE_SENTENCE } from '@/constants/passwordRules';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui';

const ALERT_TITLE = "Couldn't update password";

// This screen is reached only from the password-recovery deep link
// (app/_layout.tsx's handleDeepLink). Its state is decided by the pure
// resetScreenState() (lib/recoveryLink.ts):
//
//   - verifying: no `status=invalid` param yet, and the recovery-session
//     flag (lib/recoveryNonce.ts) isn't set yet either. Covers the brief
//     window on cold start where this route is showing (expo-router
//     restored it from the link before anything else rendered) but the
//     async nonce-check + setSession in _layout.tsx hasn't resolved — and
//     also a URL that routes here by PATH but that _layout.tsx's parser
//     doesn't recognize as a recovery link at all (a bare `?rn=` with no
//     fragment, a truncated link, a future PKCE `?code=` redirect):
//     _layout.tsx never sets a status OR the flag for those, so nothing
//     but RESET_VERIFY_TIMEOUT_MS moves this screen off "verifying".
//   - invalid: the link was rejected (bad/replayed/mismatched nonce), was
//     already used, has expired, or verifying simply timed out — no
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
  const isRecovery = useSyncExternalStore(subscribeRecoverySession, isRecoverySession, isRecoverySession);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
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

  const screenState = resetScreenState({
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
      setRecoverySession(false);
      await signOut();
    }
    router.replace('/');
  }

  async function handleUpdatePassword() {
    if (!password) {
      Alert.alert(ALERT_TITLE, 'Please enter a new password.');
      return;
    }

    const { failing } = checkPassword(password);
    if (failing.length > 0) {
      Alert.alert(ALERT_TITLE, `Your password needs: ${failing.map((r) => r.label.toLowerCase()).join(', ')}.`);
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(ALERT_TITLE, "Passwords don't match.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      Alert.alert(ALERT_TITLE, getAuthErrorMessage(error, PASSWORD_RULE_SENTENCE));
      return;
    }

    setRecoverySession(false);
    setSuccess(true);
  }

  if (success) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Ionicons name="checkmark-circle" size={64} color={Colors.success} />
          </View>
          <Text style={styles.title}>Password updated</Text>
          <Text style={styles.description}>
            You're signed in with your new password.
          </Text>

          <Button
            title="Continue"
            onPress={() => router.replace('/')}
            variant="primary"
            style={styles.buttonSpacing}
          />
        </View>
      </SafeAreaView>
    );
  }

  if (screenState === 'verifying') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={[styles.description, styles.verifyingText]}>
            Checking your reset link…
          </Text>
          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (screenState === 'invalid') {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Ionicons name="alert-circle-outline" size={64} color={Colors.error} />
          </View>
          <Text style={styles.title}>This link didn't work</Text>
          <Text style={styles.description}>
            It may have expired, been used already, or been opened on a
            different device than the one that asked for it. Request a new
            link to continue.
          </Text>

          <Button
            title="Request a new link"
            onPress={() => router.replace('/forgot-password')}
            variant="primary"
            style={styles.buttonSpacing}
          />

          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelText}>Back to sign in</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Ionicons name="lock-closed-outline" size={64} color={Colors.primary} />
          </View>
          <Text style={styles.title}>Set a new password</Text>
          <Text style={styles.description}>
            {PASSWORD_RULE_SENTENCE}
          </Text>

          <TextInput
            style={styles.input}
            placeholder="New password"
            placeholderTextColor={Colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
          />

          <TextInput
            style={styles.input}
            placeholder="Confirm new password"
            placeholderTextColor={Colors.textMuted}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />

          <Button
            title="Update password"
            onPress={handleUpdatePassword}
            variant="primary"
            loading={loading}
            style={styles.buttonSpacing}
          />

          <TouchableOpacity
            style={styles.cancelButton}
            onPress={handleCancel}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  input: {
    backgroundColor: Colors.cardBg,
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: Colors.textPrimary,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  buttonSpacing: {
    marginTop: 8,
  },
  cancelButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  cancelText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
  verifyingText: {
    marginTop: 20,
    marginBottom: 0,
  },
});
