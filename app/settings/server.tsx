// Settings > WalkerLab Server (native only): switches the app between standalone (the default -
// service URLs and keys saved on this device, services called directly) and server mode (log into
// the user's own WalkerLab Docker server; everything comes from it and every service call goes
// through its proxy, so API keys never reach the device). See src/lib/serverMode.ts.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ServerConnectForm } from '../../src/components/ServerConnectForm';
import { useAuth } from '../../src/context/AuthContext';
import { alert } from '../../src/lib/alert';
import { disconnectServer, getServerSession, logoutServer } from '../../src/lib/serverMode';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { colors } from '../../src/theme/colors';

export default function ServerSettingsScreen() {
  const tabBarClearance = useTabBarClearance();
  const { username } = useAuth();
  const server = getServerSession();

  const useStandalone = () =>
    alert(
      'Use this device standalone?',
      'Logs this device out of the server and goes back to the servers saved on this device. Nothing on the server changes.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Use standalone', style: 'destructive', onPress: () => disconnectServer() },
      ]
    );

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topBarTitleRow}>
          <Ionicons name="cloud-outline" size={18} color={colors.brand} />
          <Text style={styles.topBarTitle}>WalkerLab Server</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.container, { paddingBottom: tabBarClearance }]} keyboardShouldPersistTaps="handled">
          {server ? (
            <>
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>CONNECTED</Text>
                <Text style={styles.value}>{server.url}</Text>
                <Text style={styles.hint}>Logged in as {username ?? server.username}. Profiles, services and settings come from the server, and API keys stay there.</Text>
              </View>
              <View style={styles.card}>
                <TouchableOpacity style={styles.actionRow} onPress={() => logoutServer()}>
                  <Ionicons name="log-out-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.actionText}>Log Out</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionRow, styles.actionDivider]} onPress={useStandalone}>
                  <Ionicons name="phone-portrait-outline" size={18} color={colors.danger} />
                  <Text style={[styles.actionText, { color: colors.danger }]}>Use this device standalone</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={styles.card}>
                <Text style={styles.sectionLabel}>STANDALONE</Text>
                <Text style={styles.hint}>
                  This device keeps its own service addresses and API keys and talks to each service directly. Connect to your WalkerLab
                  Docker server instead to use the profiles and services set up there; API keys then never leave the server. The
                  servers saved on this device stay as they are and come back if you switch to standalone again.
                </Text>
                <Text style={styles.hint}>
                  Use the server's LAN address at home, or its public (tunnel) address to use the app from anywhere.
                </Text>
              </View>
              <ServerConnectForm />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topBarTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  container: { padding: 16, gap: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 4 },
  sectionLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  value: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 6 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  actionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actionText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
});
