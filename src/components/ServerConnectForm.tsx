// The phone app's "connect to a WalkerLab server" form (server address, username, password) - used by
// Settings > WalkerLab Server to switch into server mode, and by AuthGate's login screen when a
// server-mode session has expired or the user logged out. See src/lib/serverMode.ts.
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { alert } from '../lib/alert';
import { connectServer, getLastServer, getServerSession } from '../lib/serverMode';
import { colors } from '../theme/colors';

export function ServerConnectForm({ submitLabel = 'Connect' }: { submitLabel?: string }) {
  const [url, setUrl] = useState(getServerSession()?.url ?? '');
  const [username, setUsername] = useState(getServerSession()?.username ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (getServerSession()) return;
    getLastServer().then((last) => {
      if (!last) return;
      setUrl((u) => u || last.url);
      setUsername((n) => n || last.username);
    });
  }, []);

  const submit = async () => {
    if (!url.trim() || !username.trim() || !password) {
      alert('Missing info', 'Enter the server address, your username and your password.');
      return;
    }
    setSubmitting(true);
    try {
      // On success serverMode notifies AuthGate, which reloads the whole app from the server -
      // this form unmounts with it, so there's nothing more to do here.
      await connectServer(url, username, password);
    } catch (e) {
      alert("Couldn't connect", e instanceof Error ? e.message : 'Unknown error');
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.label}>SERVER ADDRESS</Text>
      <TextInput
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="http://192.168.1.10:3000 or https://walkerlab.example.com"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />
      <Text style={styles.label}>USERNAME</Text>
      <TextInput
        style={styles.input}
        value={username}
        onChangeText={setUsername}
        placeholder="Your WalkerLab username"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Text style={styles.label}>PASSWORD</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor={colors.textMuted}
        secureTextEntry
        autoCapitalize="none"
        onSubmitEditing={submit}
      />
      <TouchableOpacity style={[styles.button, submitting && styles.buttonDisabled]} onPress={submit} disabled={submitting}>
        {submitting ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>{submitLabel}</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 8 },
  label: { color: colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 4 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    backgroundColor: colors.surfaceAlt,
    color: colors.textPrimary,
    fontSize: 16,
  },
  button: { backgroundColor: colors.brand, borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: colors.background, fontWeight: '700' },
});
