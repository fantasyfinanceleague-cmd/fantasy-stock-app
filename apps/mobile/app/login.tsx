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
import { validateUsername } from '@/lib/contentModeration';

function getUserFriendlyError(error: any): string {
  const message = error?.message?.toLowerCase() || '';

  if (message.includes('invalid login credentials')) {
    return 'Invalid email or password. Please try again.';
  }
  if (message.includes('email not confirmed')) {
    return 'Please verify your email before signing in. Check your inbox for a confirmation link.';
  }
  if (message.includes('user already registered')) {
    return 'An account with this email already exists. Try signing in instead.';
  }
  if (message.includes('password should be at least')) {
    return 'Password must be at least 6 characters long.';
  }
  if (message.includes('invalid email')) {
    return 'Please enter a valid email address.';
  }

  return error?.message || 'An error occurred. Please try again.';
}

export default function LoginScreen() {
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

    // Validate username during sign up
    if (isSignUp) {
      const trimmedUsername = username.trim();
      if (!trimmedUsername) {
        Alert.alert('Error', 'Please enter a username');
        return;
      }
      if (trimmedUsername.length < 3) {
        Alert.alert('Error', 'Username must be at least 3 characters');
        return;
      }
      if (trimmedUsername.length > 20) {
        Alert.alert('Error', 'Username must be 20 characters or less');
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
        Alert.alert('Error', 'Username can only contain letters, numbers, and underscores');
        return;
      }

      // Content moderation check
      const contentCheck = validateUsername(trimmedUsername);
      if (!contentCheck.isValid) {
        Alert.alert('Error', contentCheck.reason || 'Username is not allowed');
        return;
      }
    }

    setLoading(true);

    if (isSignUp) {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) {
        Alert.alert('Error', getUserFriendlyError(error));
        setLoading(false);
        return;
      }

      // Create user profile with username
      if (data?.user) {
        const { error: profileError } = await supabase
          .from('user_profiles')
          .upsert({
            id: data.user.id,
            username: username.trim()
          }, {
            onConflict: 'id'
          });

        if (profileError) {
          // If username is taken, show error
          if (profileError.code === '23505') {
            Alert.alert('Error', 'This username is already taken. Please choose another.');
            setLoading(false);
            return;
          }
          console.error('Failed to create profile:', profileError);
        }
      }

      Alert.alert('Success', 'Account created! Please check your email to verify your account.');
      setIsSignUp(false);
      setUsername('');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        Alert.alert('Error', getUserFriendlyError(error));
      } else {
        router.replace('/');
      }
    }

    setLoading(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backText}>Cancel</Text>
        </TouchableOpacity>

        <View style={styles.content}>
          <Text style={styles.title}>Fantasy Stock</Text>
          <Text style={styles.subtitle}>
            {isSignUp ? 'Create your account' : 'Sign in to continue'}
          </Text>

          {isSignUp && (
            <>
              <TextInput
                style={styles.input}
                placeholder="Username"
                placeholderTextColor="#666"
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Text style={styles.hint}>
                This will be displayed on leaderboards
              </Text>
            </>
          )}

          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor="#666"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <TextInput
            style={styles.input}
            placeholder="Password"
            placeholderTextColor="#666"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleAuth}
            disabled={loading}
          >
            <Text style={styles.buttonText}>
              {loading ? 'Loading...' : isSignUp ? 'Sign Up' : 'Sign In'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.switchButton}
            onPress={() => {
              setIsSignUp(!isSignUp);
              setUsername('');
            }}
          >
            <Text style={styles.switchText}>
              {isSignUp
                ? 'Already have an account? Sign In'
                : "Don't have an account? Sign Up"}
            </Text>
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
  backText: {
    color: '#22c55e',
    fontSize: 16,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    marginTop: -60,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
    textAlign: 'center',
    marginBottom: 32,
  },
  hint: {
    fontSize: 12,
    color: '#666',
    marginTop: -8,
    marginBottom: 16,
    marginLeft: 4,
  },
  input: {
    backgroundColor: Colors.cardBg,
    borderRadius: 8,
    padding: 16,
    fontSize: 16,
    color: '#fff',
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
    color: '#22c55e',
    fontSize: 14,
  },
});
