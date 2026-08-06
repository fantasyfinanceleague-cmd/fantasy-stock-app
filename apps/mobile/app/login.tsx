/* eslint-disable @typescript-eslint/no-use-before-define -- RN styles-at-bottom idiom: `styles`/`cardShadow` are declared below and only referenced inside the render, which runs after module init, so there is no TDZ. See CLAUDE.md ("ESLint (mobile)"). */
import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { validateUsername } from '@/lib/contentModeration';
import { PASSWORD_REQUIREMENTS, failingPasswordRequirements } from '@/constants/passwordRules';
import { Colors } from '@/constants/Colors';
import { Button, Card } from '@/components/ui';

const { width } = Dimensions.get('window');

function getUserFriendlyError(error: any): string {
  const message = error?.message?.toLowerCase() || '';
  if (message.includes('invalid login credentials')) return 'Invalid email or password. Please try again.';
  if (message.includes('email not confirmed')) return 'Please verify your email before signing in.';
  if (message.includes('user already registered')) return 'An account with this email already exists.';
  if (message.includes('password should be at least') || message.includes('weak_password')) return 'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a symbol.';
  if (message.includes('invalid email') || message.includes('unable to validate email')) return 'Please enter a valid email address.';
  if (message.includes('rate limit') || message.includes('for security purposes')) return 'Too many attempts — please wait a minute and try again.';
  // Server-side signup gate (Before User Created hook).
  if (message.includes('not open for new signups')) return 'Stockpile isn\'t open for new signups yet — check back soon. Existing accounts can still sign in.';
  return error?.message || 'An error occurred. Please try again.';
}

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);

  async function handleAuth() {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }
    if (isSignUp) {
      const trimmedUsername = username.trim();
      if (!trimmedUsername) { Alert.alert('Error', 'Please enter a username'); return; }
      if (trimmedUsername.length < 3) { Alert.alert('Error', 'Username must be at least 3 characters'); return; }
      if (trimmedUsername.length > 20) { Alert.alert('Error', 'Username must be 20 characters or less'); return; }
      if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) { Alert.alert('Error', 'Username can only contain letters, numbers, and underscores'); return; }
      const contentCheck = validateUsername(trimmedUsername);
      if (!contentCheck.isValid) { Alert.alert('Error', contentCheck.reason || 'Username is not allowed'); return; }
    }

    setLoading(true);
    if (isSignUp) {
      // Enforce the password policy before hitting the server, naming what's missing.
      const failing = failingPasswordRequirements(password);
      if (failing.length > 0) {
        Alert.alert('Weak password', `Your password needs: ${failing.map((r) => r.label.toLowerCase()).join(', ')}.`);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) { Alert.alert('Error', getUserFriendlyError(error)); setLoading(false); return; }
      if (data?.user) {
        const { error: profileError } = await supabase.from('user_profiles').upsert({ id: data.user.id, username: username.trim() }, { onConflict: 'id' });
        if (profileError?.code === '23505') { Alert.alert('Error', 'This username is already taken.'); setLoading(false); return; }
      }
      Alert.alert('Success', 'Account created! Check your email to verify.');
      setIsSignUp(false);
      setUsername('');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { Alert.alert('Error', getUserFriendlyError(error)); }
      else { router.replace('/'); }
    }
    setLoading(false);
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      {/* Logo */}
      <View style={styles.logoContainer}>
        <Image
          source={require('../assets/images/stockpile-logo-light-full.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.tagline}>Fantasy Sports Meets the Stock Market</Text>
      </View>

      {/* Card */}
      <Card padded={false} style={styles.card}>
        <Text style={styles.title}>{isSignUp ? 'Create Account' : 'Welcome back'}</Text>
        <Text style={styles.subtitle}>{isSignUp ? 'Join the competition' : 'Sign in to your league'}</Text>

        {isSignUp && (
          <>
            <View style={styles.inputContainer}>
              <Ionicons name="person-outline" size={20} color={Colors.textMuted} style={styles.inputIcon} />
              <TextInput
                style={styles.inputField}
                placeholder="Username"
                placeholderTextColor={Colors.textMuted}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <Text style={styles.hint}>Displayed on leaderboards</Text>
          </>
        )}

        <View style={styles.inputContainer}>
          <Ionicons name="mail-outline" size={20} color={Colors.textMuted} style={styles.inputIcon} />
          <TextInput
            style={styles.inputField}
            placeholder="Email address"
            placeholderTextColor={Colors.textMuted}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <View style={styles.inputContainer}>
          <Ionicons name="lock-closed-outline" size={20} color={Colors.textMuted} style={styles.inputIcon} />
          <TextInput
            style={styles.inputField}
            placeholder="Password"
            placeholderTextColor={Colors.textMuted}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        {isSignUp && (
          <View style={{ marginTop: -4, marginBottom: 16, paddingHorizontal: 4 }}>
            <Text style={{ fontSize: 13, color: '#64748B', marginBottom: 6 }}>Password must include:</Text>
            {PASSWORD_REQUIREMENTS.map((r) => {
              const ok = r.test(password);
              return (
                <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <Text style={{ width: 16, textAlign: 'center', color: ok ? '#22c55e' : '#94A3B8' }}>{ok ? '✓' : '○'}</Text>
                  <Text style={{ fontSize: 13, color: ok ? '#22c55e' : '#94A3B8' }}>{r.label}</Text>
                </View>
              );
            })}
          </View>
        )}

        {!isSignUp && (
          <TouchableOpacity style={styles.forgotButton} onPress={() => router.push('/forgot-password')}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        )}

        <Button
          title={isSignUp ? 'Create Account' : 'Sign In'}
          onPress={handleAuth}
          variant="primary"
          loading={loading}
          style={styles.authButton}
        />
      </Card>

      {/* Switch auth mode */}
      <TouchableOpacity
        style={styles.switchButton}
        onPress={() => { setIsSignUp(!isSignUp); setUsername(''); }}
      >
        <Text style={styles.switchText}>
          {isSignUp ? 'Already have an account? ' : "New here? "}
          <Text style={styles.switchTextBold}>{isSignUp ? 'Sign In' : 'Create an account'}</Text>
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.white,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: width * 0.9,
    height: 160,
  },
  tagline: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    marginTop: 12,
    letterSpacing: 0.3,
  },
  card: {
    borderRadius: 20,
    padding: 28,
  },
  title: {
    fontSize: 26,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.textSecondary,
    textAlign: 'center',
    marginBottom: 28,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.bgElevated,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputIcon: {
    paddingLeft: 16,
  },
  inputField: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 12,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: Colors.textPrimary,
  },
  hint: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textMuted,
    marginTop: -10,
    marginBottom: 16,
    marginLeft: 4,
  },
  authButton: {
    marginTop: 8,
  },
  switchButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  switchText: {
    color: Colors.textSecondary,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  switchTextBold: {
    color: Colors.primary,
    fontFamily: 'Inter_600SemiBold',
  },
  forgotButton: {
    alignSelf: 'flex-end',
    marginTop: -8,
    marginBottom: 8,
  },
  forgotText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
  },
});