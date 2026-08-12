// Native-only push notifications settings - polling-based, fully local (see
// src/lib/notificationPolling.ts's header comment for why: no server
// connection, no login, nothing to host). Web has its own separate screen
// (notifications.web.tsx) since the two platforms now share almost nothing
// - web keeps real push/webhook delivery (it's always talking to an
// already-hosted server), native just periodically checks Sonarr/Radarr/
// Lidarr/Overseerr's own APIs directly and fires a local notification.
import { Ionicons } from '@expo/vector-icons';
import { Stack, useFocusEffect } from 'expo-router';
import * as IntentLauncher from 'expo-intent-launcher';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ServiceName } from '../../src/api/types';
import { ThemedSwitch } from '../../src/components/ThemedSwitch';
import { useProfiles } from '../../src/context/ProfilesContext';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import {
  checkForNewContent,
  hasNotificationPermission,
  registerBackgroundPolling,
  requestNotificationPermission,
  unregisterBackgroundPolling,
} from '../../src/lib/notificationPolling';
import { getPollingPrefs, PollIntervalMinutes, setPollingPrefs } from '../../src/lib/notificationPrefs';
import { SERVICE_META } from '../../src/lib/serviceMeta';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { colors } from '../../src/theme/colors';

const NOTIFIABLE_SERVICES: ServiceName[] = ['sonarr', 'radarr', 'lidarr', 'overseerr'];
const INTERVAL_OPTIONS: PollIntervalMinutes[] = [15, 30, 60];

export default function NotificationsSettingsScreen() {
  const { activeProfileId } = useProfiles();
  const { servers } = useServers();
  const tabBarClearance = useTabBarClearance();

  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<Partial<Record<ServiceName, boolean>>>({});
  const [intervalMinutes, setIntervalMinutes] = useState<PollIntervalMinutes>(30);
  const [permissionGranted, setPermissionGranted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [checkingNow, setCheckingNow] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [prefs, permitted] = await Promise.all([getPollingPrefs(), hasNotificationPermission()]);
      if (prefs) {
        setServices(prefs.services);
        setIntervalMinutes(prefs.intervalMinutes);
      }
      setPermissionGranted(permitted);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Any change (a toggle, the interval) saves immediately and re-registers
  // the background task - simpler than a separate "Save" step, and matches
  // how the per-service switches elsewhere in Settings already behave.
  const persist = async (nextServices: Partial<Record<ServiceName, boolean>>, nextInterval: PollIntervalMinutes) => {
    setSaving(true);
    try {
      await setPollingPrefs({ profileId: activeProfileId, intervalMinutes: nextInterval, services: nextServices });
      const anyEnabled = Object.values(nextServices).some(Boolean);
      if (anyEnabled) {
        if (!permissionGranted) {
          const granted = await requestNotificationPermission();
          setPermissionGranted(granted);
          if (!granted) {
            alert('Notifications blocked', 'Enable notification permission in your device Settings to actually receive these.');
          }
        }
        await registerBackgroundPolling(nextInterval);
      } else {
        await unregisterBackgroundPolling();
      }
    } catch (e) {
      alert('Failed to save', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  const toggleService = (service: ServiceName, value: boolean) => {
    const next = { ...services, [service]: value };
    setServices(next);
    persist(next, intervalMinutes);
  };

  const changeInterval = (minutes: PollIntervalMinutes) => {
    setIntervalMinutes(minutes);
    persist(services, minutes);
  };

  const handleCheckNow = async () => {
    setCheckingNow(true);
    try {
      await checkForNewContent();
      alert('Checked', 'Checked Sonarr/Radarr/Lidarr/Overseerr for anything new.');
    } catch (e) {
      alert('Check failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setCheckingNow(false);
    }
  };

  const handleBatteryOptimization = () => {
    IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS).catch(() => {
      alert('Couldn’t open settings', 'Your device doesn’t support opening this screen directly - look for WalkerLab under Settings > Apps > Battery.');
    });
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
        <Text style={styles.intro}>
          WalkerLab checks Sonarr, Radarr, Lidarr and Overseerr directly on the interval below and notifies you when
          something&apos;s new - nothing is hosted or relayed anywhere to make this work.
        </Text>

        <Text style={styles.groupLabel}>CHECK EVERY</Text>
        <View style={styles.intervalRow}>
          {INTERVAL_OPTIONS.map((minutes) => (
            <TouchableOpacity
              key={minutes}
              style={[styles.intervalButton, intervalMinutes === minutes && styles.intervalButtonActive]}
              onPress={() => changeInterval(minutes)}
            >
              <Text style={[styles.intervalButtonText, intervalMinutes === minutes && styles.intervalButtonTextActive]}>{minutes} min</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.webhookHint}>
          A minimum, not a guarantee - Android can delay background checks under battery optimization regardless of
          what&apos;s picked here.
        </Text>

        <TouchableOpacity style={styles.batteryRow} onPress={handleBatteryOptimization}>
          <Ionicons name="battery-charging-outline" size={18} color={colors.brand} />
          <Text style={styles.batteryRowText}>To improve the reliability of notifications, tap here to disable battery optimisations for WalkerLab</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </TouchableOpacity>

        <Text style={styles.groupLabel}>SERVICES</Text>
        <View style={styles.card}>
          {NOTIFIABLE_SERVICES.map((service, i) => {
            const meta = SERVICE_META.find((s) => s.name === service);
            if (!meta) return null;
            const enabled = !!services[service];
            const configured = !!servers[service];
            return (
              <View key={service} style={[styles.serviceRow, i > 0 && styles.serviceRowDivider]}>
                <Ionicons name={meta.icon} size={18} color={meta.tint} style={styles.serviceIcon} />
                <View style={styles.serviceLabelWrap}>
                  <Text style={styles.serviceLabel}>{meta.label}</Text>
                  {!configured ? <Text style={styles.serviceHint}>Configure {meta.label} in Settings first</Text> : null}
                </View>
                <ThemedSwitch
                  value={enabled}
                  onValueChange={(v) => toggleService(service, v)}
                  disabled={!configured || saving}
                  activeColor={meta.tint}
                  inactiveColor={colors.textMuted}
                  trackColor={{ false: colors.surfaceAlt, true: `${meta.tint}55` }}
                />
              </View>
            );
          })}
        </View>

        <TouchableOpacity style={[styles.button, checkingNow && styles.buttonDisabled]} onPress={handleCheckNow} disabled={checkingNow}>
          <Text style={styles.buttonText}>{checkingNow ? 'Checking…' : 'Check Now'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  container: { padding: 16, gap: 14 },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  groupLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginTop: 6 },
  intervalRow: { flexDirection: 'row', gap: 8 },
  intervalButton: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  intervalButtonActive: { backgroundColor: colors.brand },
  intervalButtonText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  intervalButtonTextActive: { color: colors.background },
  webhookHint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  batteryRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 12, padding: 14 },
  batteryRowText: { flex: 1, color: colors.textPrimary, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderRadius: 14, overflow: 'hidden' },
  serviceRow: { flexDirection: 'row', alignItems: 'center', padding: 16 },
  serviceRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  serviceIcon: { marginRight: 10 },
  serviceLabelWrap: { flex: 1 },
  serviceLabel: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  serviceHint: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  button: { backgroundColor: colors.brand, borderRadius: 10, padding: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.background, fontWeight: '800', fontSize: 16 },
});
