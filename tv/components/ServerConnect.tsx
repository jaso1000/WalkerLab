// The TV's "connect to your WalkerLab server" form and the screen shown in server mode when the TV
// can't go straight in (logged out / session expired, or the server can't be reached). Same flow as
// the phone's (src/components/ServerConnectForm.tsx, src/screens/ServerGateScreen.tsx); see
// src/lib/serverMode.ts. Errors show inline - fields are pasted from the Google TV phone app's keyboard.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ServerGateProps } from '../../src/context/AuthContext';
import { alert } from '../../src/lib/alert';
import { connectServer, disconnectServer, getLastServer, getServerSession } from '../../src/lib/serverMode';
import { colors } from '../../src/theme/colors';
import { FocusCard } from './FocusCard';
import { TV_LIST, TvTextField } from './ui';

export function TvServerConnectForm({ preferredFocus, submitLabel = 'Connect' }: { preferredFocus?: boolean; submitLabel?: string }) {
  const [url, setUrl] = useState(getServerSession()?.url ?? '');
  const [username, setUsername] = useState(getServerSession()?.username ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    if (!getServerSession()) {
      getLastServer().then((last) => {
        if (!last || !mounted.current) return;
        setUrl((u) => u || last.url);
        setUsername((n) => n || last.username);
      });
    }
    return () => {
      mounted.current = false;
    };
  }, []);

  const submit = async () => {
    if (!url.trim() || !username.trim() || !password) {
      setError('Enter the server address, your username and your password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // On success the gate reloads the whole app from the server and this form unmounts with it.
      await connectServer(url, username, password);
    } catch (e) {
      if (!mounted.current) return;
      setError(e instanceof Error ? e.message : 'Could not connect');
      setBusy(false);
    }
  };

  return (
    <View>
      <Text style={styles.label}>SERVER ADDRESS</Text>
      <TvTextField value={url} onChangeText={setUrl} placeholder="http://192.168.1.10:3000" preferredFocus={preferredFocus} style={styles.field} />
      <Text style={styles.label}>USERNAME</Text>
      <TvTextField value={username} onChangeText={setUsername} placeholder="Your WalkerLab username" style={styles.field} />
      <Text style={styles.label}>PASSWORD</Text>
      <TvTextField value={password} onChangeText={setPassword} placeholder="Password" secure onSubmit={submit} style={styles.field} />
      {error && <Text style={styles.error}>{error}</Text>}
      <View style={styles.buttons}>
        <FocusCard style={styles.primary} radius={10} scale={1.04} onPress={busy ? undefined : submit}>
          {busy ? <ActivityIndicator color={colors.background} /> : <Text style={styles.primaryText}>{submitLabel}</Text>}
        </FocusCard>
      </View>
    </View>
  );
}

export function confirmUseStandalone() {
  alert('Use this TV standalone?', 'Logs the TV out of the server and goes back to the profiles saved on this TV. Nothing on the server changes.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Use standalone', style: 'destructive', onPress: () => disconnectServer() },
  ]);
}

export function TvServerGateScreen({ mode, message, onRetry }: ServerGateProps) {
  const [retrying, setRetrying] = useState(false);
  const server = getServerSession()?.url;
  return (
    <ScrollView {...TV_LIST} style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{mode === 'login' ? 'Log in to your WalkerLab server' : "Can't reach your WalkerLab server"}</Text>
      <Text style={styles.hint}>
        {mode === 'login'
          ? `Your session on ${server ?? 'the server'} has ended. Log in again to carry on.`
          : `${message ?? ''} Check the TV is on the same network as the server, or use its public address.`}
      </Text>
      {mode === 'unreachable' && (
        <View style={[styles.buttons, { marginBottom: 26 }]}>
          <FocusCard
            style={styles.primary}
            radius={10}
            scale={1.04}
            preferredFocus
            onPress={
              retrying
                ? undefined
                : async () => {
                    setRetrying(true);
                    await onRetry();
                    setRetrying(false);
                  }
            }
          >
            {retrying ? <ActivityIndicator color={colors.background} /> : <Text style={styles.primaryText}>Retry</Text>}
          </FocusCard>
        </View>
      )}
      <TvServerConnectForm preferredFocus={mode === 'login'} submitLabel={mode === 'login' ? 'Log in' : 'Connect'} />
      <View style={[styles.buttons, { marginTop: 18 }]}>
        <FocusCard style={styles.secondary} radius={10} scale={1.04} onPress={confirmUseStandalone}>
          <Text style={styles.secondaryText}>Use this TV standalone instead</Text>
        </FocusCard>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: 120, paddingVertical: 48 },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '700' },
  hint: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 10, marginBottom: 26, maxWidth: 680 },
  label: { color: colors.textMuted, fontSize: 12, letterSpacing: 1.5, marginBottom: 8, marginTop: 6 },
  field: { maxWidth: 680, marginBottom: 14 },
  error: { color: colors.danger, fontSize: 14, marginBottom: 12, maxWidth: 680 },
  buttons: { flexDirection: 'row', gap: 16, marginTop: 6 },
  primary: { backgroundColor: colors.accent, paddingHorizontal: 28, paddingVertical: 11, minWidth: 140, alignItems: 'center' },
  primaryText: { color: colors.background, fontSize: 16, fontWeight: '700' },
  secondary: { backgroundColor: colors.surfaceAlt, paddingHorizontal: 24, paddingVertical: 11 },
  secondaryText: { color: colors.textPrimary, fontSize: 16, fontWeight: '500' },
});
