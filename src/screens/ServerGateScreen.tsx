// What the phone app shows in server mode (src/lib/serverMode.ts) when it can't go straight in: the
// login form after a logout or an expired session, or a "can't reach the server" screen with Retry.
// Both offer going back to standalone, which brings the device's own profiles back untouched.
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ServerConnectForm } from '../components/ServerConnectForm';
import type { ServerGateProps } from '../context/AuthContext';
import { alert } from '../lib/alert';
import { disconnectServer, getServerSession } from '../lib/serverMode';
import { colors } from '../theme/colors';

export function ServerGateScreen({ mode, message, onRetry }: ServerGateProps) {
  const [retrying, setRetrying] = useState(false);
  const server = getServerSession()?.url;

  const useStandalone = () =>
    alert('Use this device on its own?', "The app goes back to the servers saved on this device. You can connect to the WalkerLab server again from Settings.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Use standalone', onPress: () => disconnectServer() },
    ]);

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>WalkerLab</Text>
          {mode === 'login' ? (
            <>
              <Text style={styles.subtitle}>Log in to your WalkerLab server{server ? ` at ${server}` : ''}.</Text>
              <ServerConnectForm submitLabel="Log In" />
            </>
          ) : (
            <>
              <Text style={styles.subtitle}>{message ?? "Couldn't reach your WalkerLab server."}</Text>
              <Text style={styles.hint}>Check this device is on the same network as the server, or use its public address.</Text>
              <TouchableOpacity
                style={styles.button}
                disabled={retrying}
                onPress={async () => {
                  setRetrying(true);
                  await onRetry();
                  setRetrying(false);
                }}
              >
                {retrying ? <ActivityIndicator color={colors.background} /> : <Text style={styles.buttonText}>Retry</Text>}
              </TouchableOpacity>
              <Text style={[styles.subtitle, { marginTop: 24 }]}>Or connect with a different address:</Text>
              <ServerConnectForm />
            </>
          )}
          <TouchableOpacity style={styles.link} onPress={useStandalone}>
            <Text style={styles.linkText}>Use this device standalone instead</Text>
          </TouchableOpacity>
          <View style={{ height: 24 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 8, maxWidth: 460, alignSelf: 'center', width: '100%' },
  title: { color: colors.textPrimary, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 12 },
  hint: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginBottom: 12 },
  button: { backgroundColor: colors.brand, borderRadius: 8, padding: 14, alignItems: 'center' },
  buttonText: { color: colors.background, fontWeight: '700' },
  link: { alignItems: 'center', padding: 14, marginTop: 8 },
  linkText: { color: colors.brand, fontSize: 14, fontWeight: '600' },
});
