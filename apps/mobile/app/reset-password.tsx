/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useEffect, useState } from 'react';
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
import { resetScreenState, RESET_VERIFY_TIMEOUT_MS } from '@/lib/recoveryLink';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@/components/ui';

// This screen is reached only from the password-recovery deep link
// (app/_layout.tsx's handleDeepLink). Its state is decided by the pure
// resetScreenState() (lib/recoveryLink.ts):
//
//   - verifying: no `status=invalid` param yet, and no session yet either.
//     Covers the brief window on cold start where this route is showing
//     (expo-router restored it from the link before anything else rendered)
//     but the async nonce-check + setSession in _layout.tsx hasn't resolved
//     — and also a URL that routes here by PATH but that _layout.tsx's
//     parser doesn't recognize as a recovery link at all (a bare `?rn=`
//     with no fragment, a truncated link, a future PKCE `?code=` redirect):
//     _layout.tsx never sets a status OR a session for those, so nothing
//     but RESET_VERIFY_TIMEOUT_MS moves this screen off "verifying".
//   - invalid: the link was rejected (bad/replayed/mismatched nonce), was
//     already used, has expired, or verifying simply timed out — no
//     session was set. There's nothing to recover from here; the user
//     needs to request a new email.
//   - form: a session exists, so this is a real recovery in progress.

export default function ResetPasswordScreen() {
  const { status } = useLocalSearchParams<{ status?: string }>();
  const { user, signOut } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [verifyTimedOut, setVerifyTimedOut] = useState(false);

  // Bounded wait: if neither a session nor an explicit status ever arrives
  // (see the "verifying" case above), stop spinning and show "invalid".
  useEffect(() => {
    if (user || status === 'invalid') {
      return;
    }
    const timer = setTimeout(() => setVerifyTimedOut(true), RESET_VERIFY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [user, status]);

  const screenState = resetScreenState({
    status,
    hasSession: !!user,
    elapsedMs: verifyTimedOut ? RESET_VERIFY_TIMEOUT_MS : 0,
  });

  async function handleCancel() {
    // A recovery link fully signs the device in (that's how the form gets
    // its session), so leaving via Cancel should not leave the user signed
    // in to an account they never meant to open here.
    await signOut();
    router.replace('/login');
  }

  async function handleUpdatePassword() {
    if (!password) {
      Alert.alert('Error', 'Please enter a new password');
      return;
    }

    if (password.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Error', 'Passwords do not match');
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.updateUser({ password });

    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setSuccess(true);
  }

  if (success) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Ionicons name="checkmark-circle" size={64} color={Colors.success} />
          </View>
          <Text style={styles.title}>Password Reset!</Text>
          <Text style={styles.description}>
            Your password has been successfully updated.
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
            Verifying your reset link…
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
          <Text style={styles.title}>Link No Longer Valid</Text>
          <Text style={styles.description}>
            This password reset link has expired, was already used, or doesn't
            match this device. Request a new one to continue.
          </Text>

          <Button
            title="Request a New Link"
            onPress={() => router.replace('/forgot-password')}
            variant="primary"
            style={styles.buttonSpacing}
          />

          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelText}>Back to Login</Text>
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
          <Text style={styles.title}>Set New Password</Text>
          <Text style={styles.description}>
            Enter your new password below. Make sure it's at least 6 characters long.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="New Password"
            placeholderTextColor={Colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoFocus
          />

          <TextInput
            style={styles.input}
            placeholder="Confirm New Password"
            placeholderTextColor={Colors.textMuted}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
          />

          <Button
            title="Update Password"
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