// First-run "create your admin account" screen - shown by `AuthGate`
// (web-only) instead of the login screen when the backend reports no admin
// account exists yet. Styled like app/profiles.tsx's card/colors.* pattern
// so it looks native to the rest of the app.
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { alert } from '../../lib/alert';
import { colors } from '../../theme/colors';

export function SetupWizardScreen({ onComplete }: { onComplete: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!username.trim() || password.length < 8) {
      alert('Missing info', 'Enter a username and a password of at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      alert("Passwords don't match", 'Re-enter the password to confirm it.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Setup failed.');
      }
      onComplete();
    } catch (e) {
      alert('Setup failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.container}>
        <Text style={styles.title}>Welcome to WalkerLab</Text>
        <Text style={styles.subtitle}>Create an admin account to secure this instance.</Text>
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={setPassword}
            placeholder="Password (min. 8 characters)"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            onSubmitEditing={submit}
          />
          <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={submit} disabled={submitting}>
            {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Create Admin Account</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flex: 1, justifyContent: 'center', padding: 24, gap: 8, maxWidth: 420, alignSelf: 'center', width: '100%' },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 12 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: colors.surfaceAlt,
    color: colors.textPrimary,
    // 16px avoids iOS Safari's auto-zoom-on-focus for small inputs - see movies.tsx.
    fontSize: 16,
  },
  button: { backgroundColor: colors.brand, borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.background, fontWeight: '700' },
});
