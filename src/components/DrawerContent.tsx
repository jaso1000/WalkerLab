// Custom content for the hamburger drawer (registered as the drawer's
// `drawerContent` in `app/(drawer)/_layout.tsx`) - renders the nav item
// list, Settings, and the profile switcher footer. `SafeAreaView` insets
// are used deliberately (not a guessed paddingTop) since the header/footer
// otherwise collide with the status bar/notch on real devices.
import { DrawerContentComponentProps } from '@react-navigation/drawer';
import { Image } from 'expo-image';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ProfileSwitcher } from './ProfileSwitcher';
import { useAuth } from '../context/AuthContext';
import { useProfiles } from '../context/ProfilesContext';
import { useSectionNames } from '../context/SectionNamesContext';
import { SECTION_META } from '../lib/sectionMeta';
import { StartupSectionId } from '../lib/startupScreen';
import { colors } from '../theme/colors';

// Renders the drawer's item list, Settings row, and the profile switcher
// footer (name + tap-to-open switcher sheet). `order` is the caller's
// already-resolved (per-profile, already enabled-service-filtered) list of
// non-Settings sections to show, in the user's chosen order - see
// `src/lib/tabOrder.ts` and `app/(drawer)/_layout.tsx`, which is the only
// place this component is ever rendered from.
export function DrawerContent(props: DrawerContentComponentProps & { order: StartupSectionId[] }) {
  const pathname = usePathname();
  const { names } = useSectionNames();
  const { activeProfile } = useProfiles();
  const { logout } = useAuth();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  // Navigates and closes the drawer in one step, since the drawer doesn't
  // auto-close on navigation the way a bottom tab bar would.
  const go = (href: string) => {
    router.push(href as never);
    props.navigation.closeDrawer();
  };

  const visibleItems = props.order.map((sectionId) => ({ sectionId, ...SECTION_META[sectionId] }));

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
            <Ionicons name={SECTION_META.settings.icon} size={18} color={colors.textSecondary} />
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

      <ProfileSwitcher visible={profileMenuOpen} onClose={() => setProfileMenuOpen(false)} />
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
