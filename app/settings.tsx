// Settings' top-level "SERVICES" list - one row per `SERVICE_META` entry,
// each tappable through to its own config page (`app/settings/[service].tsx`)
// and carrying its own enable/disable switch + a "Startup screen" badge on
// whichever service currently owns that role. Settings itself has no
// service card, so it can't be renamed or disabled the way other sections can.
import { Ionicons } from '@expo/vector-icons';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ChangePasswordModal } from '../src/components/ChangePasswordModal';
import { HeaderTitle } from '../src/components/HeaderTitle';
import { SelectRow } from '../src/components/SelectRow';
import { ThemedSwitch } from '../src/components/ThemedSwitch';
import { useAuth } from '../src/context/AuthContext';
import { useProfiles } from '../src/context/ProfilesContext';
import { useSectionNames } from '../src/context/SectionNamesContext';
import { useServiceEnabled } from '../src/context/ServiceEnabledContext';
import { SECTION_META } from '../src/lib/sectionMeta';
import { SERVICE_META } from '../src/lib/serviceMeta';
import { DEFAULT_STARTUP_SCREEN, getStartupScreen, StartupSectionId } from '../src/lib/startupScreen';
import { useTabBarClearance } from '../src/lib/tabBarClearance';
import { colors } from '../src/theme/colors';

export default function SettingsScreen() {
  const { names } = useSectionNames();
  const { activeProfileId } = useProfiles();
  const { role } = useAuth();
  const { isEnabled, setEnabled } = useServiceEnabled();
  const [startupId, setStartupId] = useState<StartupSectionId>(DEFAULT_STARTUP_SCREEN);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const tabBarClearance = useTabBarClearance();

  // Re-reads on every focus (not just once) since navigating back from a
  // service's config page after changing the startup screen there should
  // immediately reflect on this list's badge.
  useFocusEffect(
    useCallback(() => {
      getStartupScreen(activeProfileId).then(setStartupId);
    }, [activeProfileId])
  );

  return (
    <>
    <Stack.Screen
      options={{
        headerShown: true,
        headerBackVisible: false,
        headerLeft: () => null,
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTintColor: colors.textPrimary,
        headerTitleAlign: 'left',
        headerTitle: () => <HeaderTitle icon={SECTION_META.settings.icon} title={names.settings} />,
      }}
    />
    <ScrollView style={styles.screen} contentContainerStyle={[styles.container, { paddingBottom: tabBarClearance }]}>
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
              <ThemedSwitch
                style={styles.rowSwitch}
                value={enabled}
                onValueChange={(v) => setEnabled(service.name, v)}
                trackColor={{ false: colors.surfaceAlt, true: `${service.tint}55` }}
                activeColor={service.tint}
                inactiveColor={colors.textMuted}
              />
            </View>
          );
        })}
      </View>
      <Text style={styles.hint}>Turning a service off hides its section from navigation.</Text>

      <Text style={styles.groupLabel}>NAVIGATION</Text>
      <View style={styles.navCard}>
        <SelectRow label="Section Order" value="" onPress={() => router.push('/settings/navigation')} />
      </View>

      {Platform.OS === 'web' ? (
        <>
          <Text style={styles.groupLabel}>ACCOUNT</Text>
          <View style={styles.list}>
            <View style={[styles.row, role === 'admin' && styles.rowDivider]}>
              <TouchableOpacity style={styles.rowMain} onPress={() => setChangePasswordOpen(true)}>
                <View style={[styles.iconCircle, { backgroundColor: `${colors.brand}26` }]}>
                  <Ionicons name="key-outline" size={18} color={colors.brand} />
                </View>
                <View style={styles.rowTextGroup}>
                  <Text style={styles.rowLabel}>Change Password</Text>
                </View>
              </TouchableOpacity>
            </View>
            {role === 'admin' ? (
              <View style={styles.row}>
                <TouchableOpacity style={styles.rowMain} onPress={() => router.push('/settings/users')}>
                  <View style={[styles.iconCircle, { backgroundColor: `${colors.brand}26` }]}>
                    <Ionicons name="people-outline" size={18} color={colors.brand} />
                  </View>
                  <View style={styles.rowTextGroup}>
                    <Text style={styles.rowLabel}>Manage Users</Text>
                  </View>
                </TouchableOpacity>
              </View>
            ) : null}
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
  // Unlike `list` above (whose SERVICES rows manage their own edge padding
  // so the full-width divider border isn't cut short), SelectRow expects
  // its container to supply horizontal padding - see movie/add.tsx's
  // `card` style for the same convention.
  navCard: { backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 16 },
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
