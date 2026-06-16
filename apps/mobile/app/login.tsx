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
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { validateUsername } from '@/lib/contentModeration';

const { width } = Dimensions.get('window');

function getUserFriendlyError(error: any): string {
  const message = error?.message?.toLowerCase() || '';
  if (message.includes('invalid login credentials')) return 'Invalid email or password. Please try again.';
  if (message.includes('email not confirmed')) return 'Please verify your email before signing in.';
  if (message.includes('user already registered')) return 'An account with this email already exists.';
  if (message.includes('password should be at least')) return 'Password must be at least 6 characters long.';
  if (message.includes('invalid email')) return 'Please enter a valid email address.';
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
      <View style={[styles.card, cardShadow]}>
        <Text style={styles.title}>{isSignUp ? 'Create Account' : 'Welcome back'}</Text>
        <Text style={styles.subtitle}>{isSignUp ? 'Join the competition' : 'Sign in to your league'}</Text>

        {isSignUp && (
          <>
            <View style={styles.inputContainer}>
              <Ionicons name="person-outline" size={20} color="#94A3B8" style={styles.inputIcon} />
              <TextInput
                style={styles.inputField}
                placeholder="Username"
                placeholderTextColor="#94A3B8"
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
          <Ionicons name="mail-outline" size={20} color="#94A3B8" style={styles.inputIcon} />
          <TextInput
            style={styles.inputField}
            placeholder="Email address"
            placeholderTextColor="#94A3B8"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />
        </View>

        <View style={styles.inputContainer}>
          <Ionicons name="lock-closed-outline" size={20} color="#94A3B8" style={styles.inputIcon} />
          <TextInput
            style={styles.inputField}
            placeholder="Password"
            placeholderTextColor="#94A3B8"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        </View>

        {!isSignUp && (
          <TouchableOpacity style={styles.forgotButton} onPress={() => router.push('/forgot-password')}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleAuth}
          disabled={loading}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>
            {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
          </Text>
        </TouchableOpacity>
      </View>

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

const cardShadow = Platform.select({
  ios: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
  },
  android: {
    elevation: 4,
  },
  default: {},
}) as object;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
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
    color: '#64748B',
    marginTop: 12,
    letterSpacing: 0.3,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 28,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  title: {
    fontSize: 26,
    fontWeight: '600',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 28,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  inputIcon: {
    paddingLeft: 16,
  },
  inputField: {
    flex: 1,
    paddingVertical: 16,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#0F172A',
  },
  hint: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: -10,
    marginBottom: 16,
    marginLeft: 4,
  },
  button: {
    marginTop: 8,
    borderRadius: 12,
    backgroundColor: '#0891B2',
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  switchButton: {
    marginTop: 24,
    alignItems: 'center',
  },
  switchText: {
    color: '#64748B',
    fontSize: 15,
  },
  switchTextBold: {
    color: '#0891B2',
    fontWeight: '600',
  },
  forgotButton: {
    alignSelf: 'flex-end',
    marginTop: -8,
    marginBottom: 8,
  },
  forgotText: {
    color: '#64748B',
    fontSize: 14,
  },
});
