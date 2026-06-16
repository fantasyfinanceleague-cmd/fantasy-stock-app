import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';
import { Ionicons } from '@expo/vector-icons';

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleResetPassword() {
    if (!email) {
      Alert.alert('Error', 'Please enter your email address');
      return;
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert('Error', 'Please enter a valid email address');
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: 'fantasystockapp://reset-password',
    });

    setLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setSent(true);
  }

  if (sent) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}>
          <View style={styles.iconContainer}>
            <Ionicons name="mail-outline" size={64} color={Colors.primary} />
          </View>
          <Text style={styles.title}>Check Your Email</Text>
          <Text style={styles.description}>
            We've sent a password reset link to:
          </Text>
          <Text style={styles.email}>{email}</Text>
          <Text style={styles.hint}>
            Click the link in the email to reset your password. The link will expire in 24 hours.
          </Text>

          <TouchableOpacity
            style={styles.button}
            onPress={() => router.replace('/login')}
          >
            <Text style={styles.buttonText}>Back to Sign In</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.resendButton}
            onPress={() => {
              setSent(false);
              handleResetPassword();
            }}
          >
            <Text style={styles.resendText}>Didn't receive it? Send again</Text>
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
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.primary} />
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={styles.title}>Forgot Password?</Text>
          <Text style={styles.description}>
            Enter your email address and we'll send you a link to reset your password.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#94A3B8"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoFocus
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleResetPassword}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Sending...' : 'Send Reset Link'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => router.back()}
          >
            <Text style={styles.switchText}>Back to Sign In</Text>
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
  backButton: {
    padding: 16,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginTop: -60,
  },
  iconContainer: {
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  email: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: 16,
  },
  hint: {
    fontSize: 14,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 20,
  },
  input: {
    backgroundColor: Colors.cardBg,
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    color: '#0F172A',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  button: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  switchButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  switchText: {
    color: Colors.primary,
    fontSize: 14,
  },
  resendButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  resendText: {
    color: '#64748B',
    fontSize: 14,
  },
});
