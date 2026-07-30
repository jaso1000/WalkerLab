// Settings' top-level "SERVICES" list - one row per `SERVICE_META` entry,
// each tappable through to its own config page (`app/settings/[service].tsx`)
// and carrying its own enable/disable switch + a "Startup screen" badge on
// whichever service currently owns that role. Settings itself has no
// service card, so it can't be renamed or disabled the way other sections can.
import { Ionicons } from '@expo/vector-icons';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { BackHandler, Platform, ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { ChangePasswordModal } from '../../src/components/ChangePasswordModal';
import { useProfiles } from '../../src/context/ProfilesContext';
import { useServiceEnabled } from '../../src/context/ServiceEnabledContext';
import { SERVICE_META } from '../../src/lib/serviceMeta';
import { DEFAULT_STARTUP_SCREEN, getStartupScreen, StartupSectionId } from '../../src/lib/startupScreen';
import { colors } from '../../src/theme/colors';

export default function SettingsScreen() {
  const navigation = useNavigation();
  const { activeProfileId } = useProfiles();
  const { isEnabled, setEnabled } = useServiceEnabled();
  const [startupId, setStartupId] = useState<StartupSectionId>(DEFAULT_STARTUP_SCREEN);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);

  // Re-reads on every focus (not just once) since navigating back from a
  // service's config page after changing the startup screen there should
  // immediately reflect on this list's badge.
  useFocusEffect(
    useCallback(() => {
      getStartupScreen(activeProfileId).then(setStartupId);
    }, [activeProfileId])
  );

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        navigation.dispatch(DrawerActions.openDrawer());
        return true;
      });
      return () => sub.remove();
    }, [navigation])
  );

  return (
    <>
    <ScrollView style={styles.screen} contentContainerStyle={styles.container}>
      <Text style={styles.groupLabel}>SERVICES</Text>
      <View style={styles.list}>
        {SERVICE_META.map((service, i) => {
          const enabled = isEnabled(service.name);
          const isStartup = !!service.sectionId && service.sectionId === startupId;
          return (
            <View key={service.name} style={[styles.row, i < SERVICE_META.length - 1 && styles.rowDivider]}>
              <TouchableOpacity style={styles.rowMain} onPress={() => router.push(`/settings/${service.name}`)}>
                <View
                  style={[styles.iconCircle, { backgroundColor: `${service.tint}26` }, !enabled && styles.iconCircleDisabled]}
                >
                  <Ionicons name={service.icon} size={18} color={enabled ? service.tint : colors.textMuted} />
                </View>
                <View style={styles.rowTextGroup}>
                  <Text style={[styles.rowLabel, !enabled && styles.rowLabelDisabled]}>{service.label}</Text>
                  {isStartup ? (
                    <View style={styles.startupBadge}>
                      <Ionicons name="home" size={11} color={colors.brand} />
                      <Text style={styles.startupBadgeText}>Startup screen</Text>
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>
              <Switch
                style={styles.rowSwitch}
                value={enabled}
                onValueChange={(v) => setEnabled(service.name, v)}
                trackColor={{ false: colors.surfaceAlt, true: `${service.tint}55` }}
                thumbColor={enabled ? service.tint : colors.textMuted}
              />
            </View>
          );
        })}
      </View>
      <Text style={styles.hint}>Turning a service off hides its section from the hamburger menu.</Text>

      {Platform.OS === 'web' ? (
        <>
          <Text style={styles.groupLabel}>ACCOUNT</Text>
          <View style={styles.list}>
            <TouchableOpacity style={styles.rowMain} onPress={() => setChangePasswordOpen(true)}>
              <View style={[styles.iconCircle, { backgroundColor: `${colors.brand}26` }]}>
                <Ionicons name="key-outline" size={18} color={colors.brand} />
              </View>
              <View style={styles.rowTextGroup}>
                <Text style={styles.rowLabel}>Change Password</Text>
              </View>
            </TouchableOpacity>
          </View>
        </>
      ) : null}
    </ScrollView>
    {Platform.OS === 'web' ? (
      <ChangePasswordModal visible={changePasswordOpen} onClose={() => setChangePasswordOpen(false)} />
    ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  container: { padding: 16, gap: 14 },
  groupLabel: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: -2,
  },
  list: { backgroundColor: colors.surface, borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingLeft: 16 },
  rowSwitch: { marginRight: 16 },
  iconCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  iconCircleDisabled: { opacity: 0.5 },
  rowTextGroup: { flex: 1, gap: 2 },
  rowLabel: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  rowLabelDisabled: { color: colors.textMuted },
  startupBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  startupBadgeText: { color: colors.brand, fontSize: 11, fontWeight: '700' },
  hint: { color: colors.textSecondary, fontSize: 12, textAlign: 'center' },
});
