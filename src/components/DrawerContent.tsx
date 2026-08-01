// Custom content for the hamburger drawer (registered as the drawer's
// `drawerContent` in `app/(drawer)/_layout.tsx`) - renders the nav item
// list, Settings, and the profile switcher footer. `SafeAreaView` insets
// are used deliberately (not a guessed paddingTop) since the header/footer
// otherwise collide with the status bar/notch on real devices.
import { Ionicons } from '@expo/vector-icons';
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import { Image } from 'expo-image';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { PromptModal } from './PromptModal';
import { useAuth } from '../context/AuthContext';
import { useProfiles } from '../context/ProfilesContext';
import { useSectionNames } from '../context/SectionNamesContext';
import { useServiceEnabled } from '../context/ServiceEnabledContext';
import { serviceForSection } from '../lib/serviceMeta';
import { StartupSectionId } from '../lib/startupScreen';
import { colors } from '../theme/colors';

// One row's static config (which nav section it opens, its icon/color).
// Display label comes from `SectionNamesContext` at render time, not here,
// since that's per-profile and user-renameable.
interface DrawerItem {
  sectionId: StartupSectionId;
  href: '/discover' | '/' | '/movies' | '/downloads' | '/torrents' | '/overseerr' | '/tautulli' | '/containers';
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
}

const ITEMS: DrawerItem[] = [
  { sectionId: 'discover', href: '/discover', icon: 'compass', tint: colors.sectionGreen },
  { sectionId: 'tvShows', href: '/', icon: 'tv', tint: colors.sonarr },
  { sectionId: 'movies', href: '/movies', icon: 'film', tint: colors.accent },
  { sectionId: 'downloads', href: '/downloads', icon: 'download', tint: colors.sabnzbd },
  { sectionId: 'torrents', href: '/torrents', icon: 'swap-vertical', tint: colors.qbittorrent },
  { sectionId: 'requests', href: '/overseerr', icon: 'list', tint: colors.overseerr },
  { sectionId: 'stats', href: '/tautulli', icon: 'stats-chart', tint: colors.tautulli },
  { sectionId: 'containers', href: '/containers', icon: 'cube', tint: colors.portainer },
];

// Renders the drawer's item list, Settings row, and the profile switcher
// footer (name + tap-to-open switcher sheet).
export function DrawerContent(props: DrawerContentComponentProps) {
  const pathname = usePathname();
  const { names } = useSectionNames();
  const { isEnabled } = useServiceEnabled();
  const { profiles, activeProfile, switchProfile, addProfile } = useProfiles();
  const { logout } = useAuth();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [addProfileOpen, setAddProfileOpen] = useState(false);

  // Navigates and closes the drawer in one step, since the drawer doesn't
  // auto-close on navigation the way a bottom tab bar would.
  const go = (href: string) => {
    router.push(href as never);
    props.navigation.closeDrawer();
  };

  // Hides a nav item entirely when its owning service has been disabled in
  // Settings (items with no owning service, i.e. none currently, are always
  // shown).
  const visibleItems = ITEMS.filter((item) => {
    const service = serviceForSection(item.sectionId);
    return !service || isEnabled(service);
  });

  // Checkmarks the currently-active profile in the switcher sheet, plus
  // fixed "Add"/"Manage" actions at the bottom.
  const profileMenuOptions: ActionSheetOption[] = [
    ...profiles.map((profile) => ({
      label: profile.id === activeProfile.id ? `✓  ${profile.name}` : profile.name,
      onPress: () => switchProfile(profile.id),
    })),
    { label: 'Add New Profile…', onPress: () => setAddProfileOpen(true) },
    { label: 'Manage Profiles…', onPress: () => go('/profiles') },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Image source={require('../../assets/walkerlab-icon.png')} style={styles.logoIcon} />
        <Text style={styles.logo}>
          <Text style={styles.logoWhite}>Walker</Text>
          <Text style={styles.logoAccent}>Lab</Text>
        </Text>
      </View>
      <View style={styles.divider} />

      <ScrollView contentContainerStyle={styles.list}>
        {visibleItems.map((item) => {
          const active = pathname === item.href;
          return (
            <TouchableOpacity
              key={item.href}
              style={[styles.row, active && { backgroundColor: `${item.tint}26` }]}
              onPress={() => go(item.href)}
            >
              <View style={[styles.iconCircle, { backgroundColor: `${item.tint}26` }]}>
                <Ionicons name={item.icon} size={18} color={item.tint} />
              </View>
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                {names[item.sectionId]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={() => go('/settings')}>
          <View style={styles.iconCircle}>
            <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
          </View>
          <Text style={styles.label}>{names.settings}</Text>
        </TouchableOpacity>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.row} onPress={() => setProfileMenuOpen(true)}>
          <View style={styles.iconCircle}>
            <Ionicons name="server-outline" size={18} color={colors.textSecondary} />
          </View>
          <Text style={[styles.label, styles.profileLabel]} numberOfLines={1}>
            {activeProfile.name}
          </Text>
          <Ionicons name="chevron-expand" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
        {Platform.OS === 'web' ? (
          <TouchableOpacity style={styles.row} onPress={logout}>
            <View style={styles.iconCircle}>
              <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            </View>
            <Text style={[styles.label, { color: colors.danger }]}>Log Out</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <ActionSheet
        visible={profileMenuOpen}
        title="Switch Profile"
        options={profileMenuOptions}
        onClose={() => setProfileMenuOpen(false)}
      />
      <PromptModal
        visible={addProfileOpen}
        title="New Profile"
        placeholder="e.g. Uncle Paul"
        confirmLabel="Create"
        onCancel={() => setAddProfileOpen(false)}
        onConfirm={(name) => {
          setAddProfileOpen(false);
          if (name.trim()) addProfile(name.trim());
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
  logoIcon: { width: 34, height: 34, borderRadius: 9 },
  logo: { fontSize: 22, fontWeight: '800' },
  logoWhite: { color: colors.textPrimary },
  logoAccent: { color: colors.brand },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  list: { paddingHorizontal: 12, paddingTop: 12, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 10 },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Defense-in-depth: a user can type an arbitrarily long custom section
  // name in Settings' "Rename in drawer & header" field (no maxLength
  // enforced there) - flexShrink/minWidth let numberOfLines={1}'s ellipsis
  // actually take effect within this fixed-width row instead of the label
  // just pushing past it uncapped.
  label: { color: colors.textSecondary, fontSize: 15, fontWeight: '600', flexShrink: 1, minWidth: 0 },
  labelActive: { color: colors.textPrimary, fontWeight: '700' },
  profileLabel: { flex: 1 },
  footer: { paddingBottom: 8, paddingHorizontal: 12 },
});
