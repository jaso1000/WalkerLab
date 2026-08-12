// Web-only push notifications settings - real push delivery (VAPID +
// service worker), since this build *is* server/'s own frontend, already
// hosted and reachable. Native has its own separate screen
// (notifications.tsx) using local polling instead - the two share almost
// nothing now (no server URL/login concept on web at all, no push/webhook
// concept on native), so this is a genuine platform split, not a shared
// file with branches.
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lidarrApi } from '../../src/api/lidarr';
import { overseerrApi } from '../../src/api/overseerr';
import { radarrApi } from '../../src/api/radarr';
import { sonarrApi } from '../../src/api/sonarr';
import { ServiceName } from '../../src/api/types';
import { ThemedSwitch } from '../../src/components/ThemedSwitch';
import { useProfiles } from '../../src/context/ProfilesContext';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import {
  disableNotifications,
  getConnection,
  getPrefs,
  getSessionRole,
  getWebhookCallback,
  isPushSupported,
  NotificationConnection,
  registerForPushNotificationsAsync,
  sendTest,
  setPrefs,
  setWebhookCallback,
  WebhookCallback,
} from '../../src/lib/notificationsApi.web';
import { SERVICE_META } from '../../src/lib/serviceMeta';
import { colors } from '../../src/theme/colors';

const NOTIFIABLE_SERVICES: ServiceName[] = ['sonarr', 'radarr', 'lidarr', 'overseerr'];

// Accepts a bare "host:port" or a full "http(s)://host[:port]" and returns
// the parsed authority, or null if it doesn't look like a usable address.
function parseAddress(input: string): WebhookCallback | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname) return null;
    const scheme: 'http' | 'https' = url.protocol === 'https:' ? 'https' : 'http';
    const port = url.port ? Number(url.port) : scheme === 'https' ? 443 : 80;
    return { scheme, host: url.hostname, port };
  } catch {
    return null;
  }
}

function formatAddress(cb: WebhookCallback): string {
  return `${cb.scheme}://${cb.host}:${cb.port}`;
}

export default function NotificationsSettingsScreen() {
  const { activeProfileId } = useProfiles();
  const tabBarClearance = useTabBarClearance();
  const { servers } = useServers();

  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState<'admin' | 'user' | undefined>();
  const isAdmin = role === 'admin';

  const [webhookCallback, setWebhookCallbackState] = useState<WebhookCallback | null>(null);
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressInput, setAddressInput] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);

  const [connection, setConnection] = useState<NotificationConnection | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [prefs, setPrefsState] = useState<Partial<Record<ServiceName, boolean>>>({});
  const [webhookUrls, setWebhookUrls] = useState<Partial<Record<ServiceName, string>>>({});
  const [loadingPrefs, setLoadingPrefs] = useState(false);
  const [busyService, setBusyService] = useState<ServiceName | null>(null);
  const [autoSetupBusy, setAutoSetupBusy] = useState<ServiceName | null>(null);
  const [testing, setTesting] = useState(false);

  const loadPrefs = useCallback(async () => {
    setLoadingPrefs(true);
    try {
      const res = await getPrefs(activeProfileId);
      setPrefsState(res.prefs);
      setWebhookUrls(res.webhookUrls);
    } catch (e) {
      alert('Failed to load notification settings', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoadingPrefs(false);
    }
  }, [activeProfileId]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      Promise.all([getSessionRole(), getWebhookCallback().catch(() => null), getConnection()]).then(([r, cb, c]) => {
        setRole(r);
        setWebhookCallbackState(cb);
        setConnection(c);
        setLoading(false);
        if (cb && c) loadPrefs();
      });
    }, [loadPrefs])
  );

  const handleSaveAddress = async () => {
    const parsed = parseAddress(addressInput);
    if (!parsed) {
      alert('Invalid address', 'Enter a valid address, e.g. 192.168.1.50:3300 or https://your-domain.com');
      return;
    }
    setSavingAddress(true);
    try {
      const saved = await setWebhookCallback(parsed);
      setWebhookCallbackState(saved);
      setEditingAddress(false);
      if (connection) loadPrefs();
    } catch (e) {
      alert('Failed to save', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSavingAddress(false);
    }
  };

  const startEditingAddress = () => {
    setAddressInput(webhookCallback ? formatAddress(webhookCallback) : '');
    setEditingAddress(true);
  };

  const handleEnable = async () => {
    setConnecting(true);
    try {
      const result = await registerForPushNotificationsAsync(activeProfileId);
      if (result === 'permission-denied') {
        alert('Notifications blocked', 'Notification permission was denied - enable it in your browser’s site settings to receive pushes.');
        return;
      }
      if (result === 'not-connected') {
        alert('Not supported', 'This browser doesn’t support push notifications.');
        return;
      }
      const c = await getConnection();
      setConnection(c);
      loadPrefs();
    } catch (e) {
      alert('Failed to enable notifications', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisable = () => {
    alert('Disable', 'Stop receiving push notifications in this browser?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Disable',
        style: 'destructive',
        onPress: async () => {
          await disableNotifications();
          setConnection(null);
          setPrefsState({});
          setWebhookUrls({});
        },
      },
    ]);
  };

  const toggleService = async (service: ServiceName, value: boolean) => {
    setBusyService(service);
    try {
      const res = await setPrefs(activeProfileId, { ...prefs, [service]: value });
      setPrefsState(res.prefs);
      setWebhookUrls(res.webhookUrls);
    } catch (e) {
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusyService(null);
    }
  };

  const handleAutoSetup = async (service: ServiceName, url: string) => {
    const config = servers[service];
    if (!config) return;
    const label = SERVICE_META.find((s) => s.name === service)?.label ?? service;
    setAutoSetupBusy(service);
    try {
      if (service === 'overseerr') {
        const conflict = await overseerrApi.hasConflictingWebhook(config, url);
        if (conflict) {
          const proceed = await new Promise<boolean>((resolve) => {
            alert('Replace existing webhook?', 'Overseerr already has a webhook notification configured pointing somewhere else. Replace it with WalkerLab’s?', [
              { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
              { text: 'Replace', style: 'destructive', onPress: () => resolve(true) },
            ]);
          });
          if (!proceed) return;
        }
        await overseerrApi.setupWebhookNotification(config, url);
      } else if (service === 'sonarr') {
        await sonarrApi.setupWebhookNotification(config, url);
      } else if (service === 'radarr') {
        await radarrApi.setupWebhookNotification(config, url);
      } else if (service === 'lidarr') {
        await lidarrApi.setupWebhookNotification(config, url);
      }
      alert('Done', `${label} is now configured to send WalkerLab notifications.`);
    } catch (e) {
      alert('Auto setup failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAutoSetupBusy(null);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await sendTest(activeProfileId);
      alert('Sent', 'Test notification sent - it should arrive shortly.');
    } catch (e) {
      alert('Failed to send test', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.brand} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Stack.Screen options={{ title: 'Push Notifications' }} />
      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: tabBarClearance }]}>
        {!webhookCallback || editingAddress ? (
          isAdmin ? (
            <>
              <Text style={styles.intro}>
                Sonarr, Radarr, Lidarr and Overseerr need to know the address of this WalkerLab server to send it
                notifications directly - not the address your browser uses. Enter the IP or domain and port this
                server is reachable at (its LAN address if those services are on the same network, or a public
                domain if you&apos;re using a tunnel).
              </Text>
              <View style={styles.card}>
                <TextInput
                  style={styles.input}
                  placeholder="192.168.1.50:3300 or https://your-domain.com"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={addressInput}
                  onChangeText={setAddressInput}
                />
              </View>
              <TouchableOpacity
                style={[styles.button, (savingAddress || !addressInput.trim()) && styles.buttonDisabled]}
                onPress={handleSaveAddress}
                disabled={savingAddress || !addressInput.trim()}
              >
                <Text style={styles.buttonText}>{savingAddress ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
              {webhookCallback && editingAddress ? (
                <TouchableOpacity onPress={() => setEditingAddress(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <Text style={styles.intro}>
              Push notifications aren&apos;t set up yet for this server - ask your admin to enter this server&apos;s
              address in Settings &gt; Push Notifications.
            </Text>
          )
        ) : (
          <>
            <View style={styles.addressRow}>
              <Ionicons name="server-outline" size={16} color={colors.textMuted} />
              <View style={styles.addressTextWrap}>
                <Text style={styles.addressLabel}>WalkerLab server address (what Sonarr/Radarr/Lidarr/Overseerr use to reach this server)</Text>
                <Text style={styles.addressText}>{formatAddress(webhookCallback)}</Text>
              </View>
              {isAdmin ? (
                <TouchableOpacity onPress={startEditingAddress}>
                  <Text style={styles.editText}>Edit</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {!connection ? (
              <>
                <Text style={styles.intro}>
                  Get notified in this browser when something new shows up - a Sonarr episode, Radarr movie, Lidarr
                  album, or Overseerr request. Your browser will ask to confirm.
                </Text>
                <TouchableOpacity style={[styles.button, connecting && styles.buttonDisabled]} onPress={handleEnable} disabled={connecting}>
                  <Text style={styles.buttonText}>{connecting ? 'Enabling…' : 'Enable Notifications'}</Text>
                </TouchableOpacity>
                {!isPushSupported() ? <Text style={styles.webhookHint}>This browser doesn&apos;t support push notifications.</Text> : null}
              </>
            ) : (
              <>
                <View style={styles.connectedRow}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.success} />
                  <Text style={styles.connectedText}>Notifications enabled in this browser</Text>
                  <TouchableOpacity onPress={handleDisable}>
                    <Text style={styles.disconnectText}>Disable</Text>
                  </TouchableOpacity>
                </View>

                {loadingPrefs ? (
                  <ActivityIndicator color={colors.brand} style={{ marginTop: 24 }} />
                ) : (
                  <View style={styles.card}>
                    {NOTIFIABLE_SERVICES.map((service, i) => {
                      const meta = SERVICE_META.find((s) => s.name === service);
                      if (!meta) return null;
                      const enabled = !!prefs[service];
                      const url = webhookUrls[service];
                      return (
                        <View key={service} style={[styles.serviceBlock, i > 0 && styles.serviceBlockDivider]}>
                          <View style={styles.serviceRow}>
                            <Ionicons name={meta.icon} size={18} color={meta.tint} style={styles.serviceIcon} />
                            <Text style={styles.serviceLabel}>{meta.label}</Text>
                            {busyService === service ? (
                              <ActivityIndicator size="small" color={meta.tint} />
                            ) : (
                              <ThemedSwitch
                                value={enabled}
                                onValueChange={(v) => toggleService(service, v)}
                                activeColor={meta.tint}
                                inactiveColor={colors.textMuted}
                                trackColor={{ false: colors.surfaceAlt, true: `${meta.tint}55` }}
                              />
                            )}
                          </View>
                          {enabled && url ? (
                            <View style={styles.webhookBox}>
                              <TouchableOpacity
                                style={[styles.autoSetupButton, { backgroundColor: meta.tint }, (autoSetupBusy === service || !servers[service]) && styles.buttonDisabled]}
                                onPress={() => handleAutoSetup(service, url)}
                                disabled={autoSetupBusy === service || !servers[service]}
                              >
                                {autoSetupBusy === service ? (
                                  <ActivityIndicator size="small" color={colors.background} />
                                ) : (
                                  <Text style={styles.autoSetupButtonText}>
                                    {servers[service] ? `Auto Setup in ${meta.label}` : `Configure ${meta.label} in Settings first`}
                                  </Text>
                                )}
                              </TouchableOpacity>
                              <Text style={styles.webhookHint}>
                                Or paste this into {meta.label}&apos;s own webhook/notification settings by hand
                                (long-press the URL below to copy):
                              </Text>
                              <Text style={styles.webhookUrl} selectable>
                                {url}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                )}

                <TouchableOpacity style={[styles.button, testing && styles.buttonDisabled]} onPress={handleTest} disabled={testing}>
                  <Text style={styles.buttonText}>{testing ? 'Sending…' : 'Send Test Notification'}</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 16, gap: 14 },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderRadius: 14, overflow: 'hidden' },
  input: { color: colors.textPrimary, fontSize: 15, paddingHorizontal: 16, paddingVertical: 14 },
  button: { backgroundColor: colors.brand, borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.background, fontWeight: '800', fontSize: 16 },
  cancelText: { color: colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 4 },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: 10, padding: 12 },
  addressTextWrap: { flex: 1, gap: 2 },
  addressLabel: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  addressText: { color: colors.textPrimary, fontSize: 13, fontFamily: 'monospace' },
  editText: { color: colors.brand, fontSize: 13, fontWeight: '700' },
  connectedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  connectedText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', flex: 1 },
  disconnectText: { color: colors.danger, fontSize: 13, fontWeight: '700' },
  serviceBlock: { padding: 16, gap: 10 },
  serviceBlockDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  serviceRow: { flexDirection: 'row', alignItems: 'center' },
  serviceIcon: { marginRight: 10 },
  serviceLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600', flex: 1 },
  webhookBox: { backgroundColor: colors.surfaceAlt, borderRadius: 10, padding: 12, gap: 6 },
  autoSetupButton: { borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginBottom: 2 },
  autoSetupButtonText: { color: colors.background, fontWeight: '700', fontSize: 13 },
  webhookHint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  webhookUrl: { color: colors.textPrimary, fontSize: 12, fontFamily: 'monospace' },
});
