import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, TextInput, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/useAuth';
import { useLeagueContext } from '@/lib/LeagueContext';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';
import { useState, useEffect } from 'react';

const AVATAR_EMOJIS = ['📊', '📈', '📉', '💹', '💰', '💵', '💎', '🏆', '🚀', '🌟', '⭐', '🔥', '💪', '🎯', '🎲', '🃏', '🦁', '🐂', '🐻', '🦅', '🐺', '🦊', '🐲', '🦈', '👤', '👨‍💼', '👩‍💼', '🧑‍💻', '👨‍🚀', '🥷', '🧙', '👑'];

interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  avatar: string | null;
}

export default function ProfileScreen() {
  const { user, signOut } = useAuth();
  const { leagues } = useLeagueContext();

  // Profile state
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [username, setUsername] = useState('');
  const [usernameError, setUsernameError] = useState('');
  const [selectedEmoji, setSelectedEmoji] = useState('📊');
  const [savingProfile, setSavingProfile] = useState(false);

  // Password state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  // Alpaca state
  const [alpacaLinked, setAlpacaLinked] = useState(false);
  const [checkingAlpaca, setCheckingAlpaca] = useState(true);
  const [showAlpacaForm, setShowAlpacaForm] = useState(false);
  const [alpacaKeyId, setAlpacaKeyId] = useState('');
  const [alpacaSecret, setAlpacaSecret] = useState('');
  const [alpacaError, setAlpacaError] = useState('');
  const [alpacaSuccess, setAlpacaSuccess] = useState('');
  const [savingAlpaca, setSavingAlpaca] = useState(false);
  const [testingConnection, setTestingConnection] = useState(false);

  // Modal state
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);

  useEffect(() => {
    if (user) {
      fetchProfile();
      checkAlpacaStatus();
    }
  }, [user]);

  async function fetchProfile() {
    if (!user) return;

    const { data, error } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', user.id)
      .single();

    if (data) {
      setProfile(data);
      setUsername(data.username || '');
      setSelectedEmoji(data.avatar || '📊');
    }
  }

  async function checkAlpacaStatus() {
    if (!user) return;
    setCheckingAlpaca(true);

    try {
      const { data, error } = await supabase
        .from('broker_credentials')
        .select('key_id')
        .eq('user_id', user.id)
        .eq('broker', 'alpaca')
        .single();

      setAlpacaLinked(!!data && !error);
    } catch {
      setAlpacaLinked(false);
    } finally {
      setCheckingAlpaca(false);
    }
  }

  async function handleAlpacaSave() {
    setAlpacaError('');
    setAlpacaSuccess('');

    const trimmedKeyId = alpacaKeyId.trim();
    const trimmedSecret = alpacaSecret.trim();

    if (!trimmedKeyId || !trimmedSecret) {
      setAlpacaError('Both API Key ID and Secret Key are required');
      return;
    }

    if (trimmedKeyId.length < 10) {
      setAlpacaError('API Key ID appears to be invalid');
      return;
    }

    if (trimmedSecret.length < 20) {
      setAlpacaError('Secret Key appears to be invalid');
      return;
    }

    setSavingAlpaca(true);
    setAlpacaSuccess('Verifying credentials with Alpaca...');

    try {
      const { data, error } = await supabase.functions.invoke('save-broker-keys', {
        body: {
          key_id: trimmedKeyId,
          secret: trimmedSecret
        }
      });

      if (error) throw error;

      if (data?.error === 'invalid_credentials') {
        setAlpacaError(data.message || 'Invalid credentials. Please check your API keys.');
        setAlpacaSuccess('');
        return;
      }

      if (data?.error) {
        throw new Error(data.message || data.error);
      }

      setAlpacaSuccess('Alpaca account linked successfully!');
      setAlpacaLinked(true);
      setShowAlpacaForm(false);
      setAlpacaKeyId('');
      setAlpacaSecret('');
    } catch (err: any) {
      setAlpacaError(err.message || 'Failed to save credentials');
      setAlpacaSuccess('');
    } finally {
      setSavingAlpaca(false);
    }
  }

  async function handleAlpacaUnlink() {
    Alert.alert(
      'Unlink Alpaca Account',
      'Are you sure you want to unlink your Alpaca account? You will need to re-enter your credentials to trade.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unlink',
          style: 'destructive',
          onPress: async () => {
            setSavingAlpaca(true);
            setAlpacaError('');

            try {
              const { error } = await supabase
                .from('broker_credentials')
                .delete()
                .eq('user_id', user!.id)
                .eq('broker', 'alpaca');

              if (error) throw error;

              setAlpacaLinked(false);
              setAlpacaSuccess('Alpaca account unlinked');
            } catch (err: any) {
              setAlpacaError(err.message || 'Failed to unlink account');
            } finally {
              setSavingAlpaca(false);
            }
          }
        }
      ]
    );
  }

  async function handleTestConnection() {
    setTestingConnection(true);
    setAlpacaError('');
    setAlpacaSuccess('');

    try {
      const { data, error } = await supabase.functions.invoke('quote', {
        body: { symbol: 'AAPL' }
      });

      if (error) throw error;

      if (data?.error === 'credentials_invalid') {
        setAlpacaError('Your credentials are invalid or expired. Please update your API keys.');
        return;
      }

      if (data?.error === 'no_credentials') {
        setAlpacaError('No credentials found. Please link your Alpaca account.');
        return;
      }

      if (data?.error) {
        setAlpacaError(data.message || 'Connection test failed.');
        return;
      }

      setAlpacaSuccess('Connection successful! Paper trading account is active.');
    } catch (err: any) {
      setAlpacaError(err.message || 'Failed to test connection.');
    } finally {
      setTestingConnection(false);
    }
  }

  async function saveProfile() {
    if (!user) return;
    setUsernameError('');

    const trimmedUsername = username.trim();

    // Validate username
    if (trimmedUsername && trimmedUsername.length < 3) {
      setUsernameError('Username must be at least 3 characters');
      return;
    }

    if (trimmedUsername && trimmedUsername.length > 20) {
      setUsernameError('Username must be 20 characters or less');
      return;
    }

    if (trimmedUsername && !/^[a-zA-Z0-9_]+$/.test(trimmedUsername)) {
      setUsernameError('Username can only contain letters, numbers, and underscores');
      return;
    }

    setSavingProfile(true);

    try {
      const { error } = await supabase
        .from('user_profiles')
        .upsert({
          id: user.id,
          username: trimmedUsername || null,
          avatar: selectedEmoji,
        }, {
          onConflict: 'id'
        });

      if (error) {
        if (error.code === '23505') {
          setUsernameError('This username is already taken');
          return;
        }
        throw error;
      }

      Alert.alert('Success', 'Profile updated successfully');
      fetchProfile();
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update profile');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword() {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Error', 'Please fill in all password fields');
      return;
    }

    if (newPassword !== confirmPassword) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }

    if (newPassword.length < 6) {
      Alert.alert('Error', 'Password must be at least 6 characters');
      return;
    }

    setChangingPassword(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      Alert.alert('Success', 'Password updated successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      Alert.alert('Error', err.message || 'Failed to update password');
    } finally {
      setChangingPassword(false);
    }
  }

  if (!user) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>Sign in to view profile</Text>
      </View>
    );
  }

  const activeLeagues = leagues.filter(l => l.draft_status === 'completed').length;
  const pendingLeagues = leagues.filter(l => l.draft_status !== 'completed').length;

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString: string | undefined) => {
    if (!dateString) return 'Never';
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView style={styles.scrollView}>
        <View style={styles.header}>
          <Text style={styles.title}>Profile</Text>
        </View>

        {/* Avatar Section */}
        <View style={styles.avatarSection}>
          <TouchableOpacity style={styles.avatar} onPress={() => setShowEmojiPicker(true)}>
            <Text style={styles.avatarText}>{selectedEmoji}</Text>
          </TouchableOpacity>
          <Text style={styles.email}>{profile?.username || user.email?.split('@')[0]}</Text>
          <Text style={styles.emailSmall}>{user.email}</Text>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{leagues.length}</Text>
            <Text style={styles.statLabel}>Leagues</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{activeLeagues}</Text>
            <Text style={styles.statLabel}>Active</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{pendingLeagues}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
        </View>

        {/* Account Information */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Account Information</Text>

          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.label}>Email</Text>
              <Text style={styles.value}>{user.email}</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.label}>Account Created</Text>
              <Text style={styles.value}>{formatDate(user.created_at)}</Text>
            </View>

            <View style={styles.divider} />

            <View style={styles.infoRow}>
              <Text style={styles.label}>Last Sign In</Text>
              <Text style={styles.value}>{formatDateTime(user.last_sign_in_at)}</Text>
            </View>
          </View>
        </View>

        {/* Username */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Username</Text>

          <View style={styles.infoCard}>
            <View style={styles.inputRow}>
              <Text style={styles.label}>Username</Text>
              <TextInput
                style={[styles.textInput, usernameError ? styles.textInputError : null]}
                placeholder="Enter username"
                placeholderTextColor={Colors.textMuted}
                value={username}
                onChangeText={(text) => {
                  setUsername(text);
                  setUsernameError('');
                }}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={20}
              />
              <Text style={styles.hint}>3-20 characters, letters, numbers, and underscores only</Text>
            </View>

            {usernameError ? (
              <Text style={styles.errorText}>{usernameError}</Text>
            ) : null}

            <TouchableOpacity
              style={[styles.saveButton, savingProfile && styles.buttonDisabled]}
              onPress={saveProfile}
              disabled={savingProfile}
            >
              <Text style={styles.saveButtonText}>
                {savingProfile ? 'Saving...' : 'Save Profile'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Change Password */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Change Password</Text>

          <View style={styles.infoCard}>
            <View style={styles.inputRow}>
              <Text style={styles.label}>New Password</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Enter new password"
                placeholderTextColor={Colors.textMuted}
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.inputRow}>
              <Text style={styles.label}>Confirm Password</Text>
              <TextInput
                style={styles.textInput}
                placeholder="Confirm new password"
                placeholderTextColor={Colors.textMuted}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry
              />
            </View>

            <TouchableOpacity
              style={[styles.saveButton, changingPassword && styles.buttonDisabled]}
              onPress={handleChangePassword}
              disabled={changingPassword}
            >
              <Text style={styles.saveButtonText}>
                {changingPassword ? 'Updating...' : 'Update Password'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Alpaca Trading Account */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Alpaca Trading Account</Text>

          <View style={styles.infoCard}>
            <View style={styles.alpacaStatus}>
              <View style={[styles.statusDot, alpacaLinked ? styles.statusLinked : styles.statusUnlinked]} />
              <Text style={styles.alpacaStatusText}>
                {checkingAlpaca ? 'Checking...' : alpacaLinked ? 'Account Linked' : 'Not Linked'}
              </Text>
            </View>

            <Text style={styles.alpacaDescription}>
              Link your Alpaca paper trading account to execute trades.
            </Text>

            {alpacaError ? (
              <View style={styles.alpacaErrorBox}>
                <Text style={styles.alpacaErrorText}>{alpacaError}</Text>
              </View>
            ) : null}

            {alpacaSuccess ? (
              <View style={styles.alpacaSuccessBox}>
                <Text style={styles.alpacaSuccessText}>{alpacaSuccess}</Text>
              </View>
            ) : null}

            {checkingAlpaca ? (
              <Text style={styles.alpacaDescription}>Loading...</Text>
            ) : alpacaLinked && !showAlpacaForm ? (
              <View>
                <TouchableOpacity
                  style={[styles.alpacaButtonFull, styles.alpacaButtonPrimary]}
                  onPress={handleTestConnection}
                  disabled={testingConnection || savingAlpaca}
                >
                  <Text style={styles.alpacaButtonText}>
                    {testingConnection ? 'Testing...' : 'Test Connection'}
                  </Text>
                </TouchableOpacity>

                <View style={styles.alpacaButtonRow}>
                  <TouchableOpacity
                    style={[styles.alpacaButton, { flex: 1 }]}
                    onPress={() => setShowAlpacaForm(true)}
                    disabled={savingAlpaca || testingConnection}
                  >
                    <Text style={styles.alpacaButtonTextSecondary}>Update Keys</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.alpacaButton, styles.alpacaButtonDanger, { flex: 1 }]}
                    onPress={handleAlpacaUnlink}
                    disabled={savingAlpaca || testingConnection}
                  >
                    <Text style={styles.alpacaButtonTextDanger}>Unlink</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View>
                <View style={styles.inputRow}>
                  <Text style={styles.label}>API Key ID</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="PK..."
                    placeholderTextColor={Colors.textMuted}
                    value={alpacaKeyId}
                    onChangeText={setAlpacaKeyId}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View style={styles.inputRow}>
                  <Text style={styles.label}>Secret Key</Text>
                  <TextInput
                    style={styles.textInput}
                    placeholder="Your secret key"
                    placeholderTextColor={Colors.textMuted}
                    value={alpacaSecret}
                    onChangeText={setAlpacaSecret}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>

                <View style={styles.alpacaButtonRow}>
                  <TouchableOpacity
                    style={[styles.alpacaButton, styles.alpacaButtonPrimary, { flex: 1 }]}
                    onPress={handleAlpacaSave}
                    disabled={savingAlpaca}
                  >
                    <Text style={styles.alpacaButtonText}>
                      {savingAlpaca ? 'Saving...' : 'Link Account'}
                    </Text>
                  </TouchableOpacity>

                  {alpacaLinked && (
                    <TouchableOpacity
                      style={[styles.alpacaButton, { flex: 1 }]}
                      onPress={() => {
                        setShowAlpacaForm(false);
                        setAlpacaKeyId('');
                        setAlpacaSecret('');
                        setAlpacaError('');
                      }}
                      disabled={savingAlpaca}
                    >
                      <Text style={styles.alpacaButtonTextSecondary}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <TouchableOpacity
                  style={styles.alpacaHelpLink}
                  onPress={() => Linking.openURL('https://alpaca.markets')}
                >
                  <Text style={styles.alpacaHelpText}>How to get API keys →</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>

        {/* App Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App</Text>

          <TouchableOpacity
            style={styles.linkCard}
            onPress={() => Linking.openURL('https://fantasy-stock-app.vercel.app')}
          >
            <Text style={styles.linkText}>Open Web App</Text>
            <Text style={styles.linkArrow}>→</Text>
          </TouchableOpacity>
        </View>

        {/* Sign Out */}
        <TouchableOpacity style={styles.signOutButton} onPress={signOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>Version 1.0.0</Text>
      </ScrollView>

      {/* Emoji Picker Modal */}
      <Modal
        visible={showEmojiPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowEmojiPicker(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowEmojiPicker(false)}
        >
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Choose Avatar</Text>
            <View style={styles.emojiGrid}>
              {AVATAR_EMOJIS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  style={[
                    styles.emojiOption,
                    selectedEmoji === emoji && styles.emojiOptionSelected,
                  ]}
                  onPress={() => {
                    setSelectedEmoji(emoji);
                    setShowEmojiPicker(false);
                  }}
                >
                  <Text style={styles.emojiOptionText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollView: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: Colors.textPrimary,
  },
  avatarSection: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 40,
  },
  email: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  emailSmall: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  statBox: {
    flex: 1,
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 4,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  infoCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoRow: {
    paddingVertical: 8,
  },
  inputRow: {
    paddingVertical: 12,
  },
  label: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 6,
  },
  value: {
    fontSize: 16,
    color: Colors.textPrimary,
  },
  valueSmall: {
    fontSize: 12,
    color: Colors.textPrimary,
    fontFamily: 'monospace',
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 4,
  },
  textInput: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  textInputError: {
    borderColor: Colors.error,
  },
  hint: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 6,
  },
  errorText: {
    fontSize: 14,
    color: Colors.error,
    marginTop: 8,
  },
  saveButton: {
    backgroundColor: Colors.primary,
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  alpacaStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusLinked: {
    backgroundColor: Colors.success,
  },
  statusUnlinked: {
    backgroundColor: Colors.textMuted,
  },
  alpacaStatusText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  alpacaDescription: {
    fontSize: 14,
    color: Colors.textMuted,
    lineHeight: 20,
    marginBottom: 16,
  },
  alpacaErrorBox: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  alpacaErrorText: {
    color: '#DC2626',
    fontSize: 14,
  },
  alpacaSuccessBox: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  alpacaSuccessText: {
    color: '#059669',
    fontSize: 14,
  },
  alpacaButtonRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  alpacaButtonFull: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  alpacaButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alpacaButtonPrimary: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  alpacaButtonDanger: {
    borderColor: Colors.error,
  },
  alpacaButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  alpacaButtonTextSecondary: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  alpacaButtonTextDanger: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  alpacaHelpLink: {
    marginTop: 16,
    alignItems: 'center',
  },
  alpacaHelpText: {
    color: Colors.primary,
    fontSize: 14,
  },
  linkCard: {
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  linkRow: {
    backgroundColor: Colors.background,
    borderRadius: 8,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  linkText: {
    fontSize: 16,
    color: Colors.textPrimary,
  },
  linkArrow: {
    fontSize: 16,
    color: Colors.textMuted,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 100,
  },
  signOutButton: {
    marginHorizontal: 24,
    marginTop: 16,
    padding: 16,
    alignItems: 'center',
    backgroundColor: Colors.cardBg,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  signOutText: {
    color: Colors.error,
    fontSize: 16,
    fontWeight: '600',
  },
  versionText: {
    textAlign: 'center',
    color: Colors.textDark,
    fontSize: 12,
    marginTop: 24,
    marginBottom: 40,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: Colors.cardBg,
    borderRadius: 16,
    padding: 24,
    width: '85%',
    maxWidth: 320,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textPrimary,
    textAlign: 'center',
    marginBottom: 20,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  emojiOption: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  emojiOptionSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary + '20',
  },
  emojiOptionText: {
    fontSize: 28,
  },
});
