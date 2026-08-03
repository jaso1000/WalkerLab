// Always-visible left navigation panel shown at tablet width and up (see
// src/components/AdaptiveNav.tsx) - phone width gets the floating pill bar
// instead (src/components/FloatingPill.tsx). Unlike the old hamburger
// Drawer this replaced, there's no open/close state at all: it's a plain,
// permanently-mounted column, so navigating just does a normal
// `router.push()` with no "close" step.
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
import { isSectionActive } from '../lib/activeSection';
import { SIDEBAR_WIDTH } from '../lib/navChrome';
import { SECTION_META } from '../lib/sectionMeta';
import { StartupSectionId } from '../lib/startupScreen';
import { colors } from '../theme/colors';

// `order` is the caller's already-resolved (per-profile, already
// enabled-service-filtered) list of non-Settings sections to show, in the
// user's chosen order - see `src/lib/tabOrder.ts`. `onNavigate`/`onClose`/
// `fullWidth` are only used by the off-canvas overlay variant
// (SidebarOverlay.tsx, tabletMedium nav tier) - all left undefined by the
// pinned/tabletLarge caller, which has nothing to close and always renders
// at the fixed `SIDEBAR_WIDTH`. `onNavigate` closes the overlay after a real
// navigation; `onClose` (when provided) renders an explicit close button in
// the header, since the overlay covers the full screen at `fullWidth` -
// there's no backdrop area left to tap to dismiss it.
export function Sidebar({
  order,
  onNavigate,
  onClose,
  fullWidth,
}: {
  order: StartupSectionId[];
  onNavigate?: () => void;
  onClose?: () => void;
  fullWidth?: boolean;
}) {
  const pathname = usePathname();
  const { names } = useSectionNames();
  const { activeProfile } = useProfiles();
  const { logout } = useAuth();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const visibleItems = order.map((sectionId) => ({ sectionId, ...SECTION_META[sectionId] }));

  return (
    <SafeAreaView style={[styles.container, fullWidth && styles.containerFullWidth]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <View style={styles.headerBrand}>
          <Image source={require('../../assets/walkerlab-icon.png')} style={styles.logoIcon} />
          <Text style={styles.logo}>
            <Text style={styles.logoWhite}>Walker</Text>
            <Text style={styles.logoAccent}>Lab</Text>
          </Text>
        </View>
        {onClose ? (
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={26} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.divider} />

      <ScrollView contentContainerStyle={styles.list}>
        {visibleItems.map((item) => {
          const active = isSectionActive(pathname, item.href);
          return (
            <TouchableOpacity
              key={item.href}
              style={[styles.row, active && { backgroundColor: `${item.tint}26` }]}
              onPress={() => {
                router.push(item.href as never);
                onNavigate?.();
              }}
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
        <TouchableOpacity
          style={styles.row}
          onPress={() => {
            router.push('/settings');
            onNavigate?.();
          }}
        >
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
  // `height: '100%'` matters for the off-canvas overlay case
  // (SidebarOverlay.tsx): that panel is a column-flex absolutely-positioned
  // box, where a child only auto-stretches along the CROSS axis (width),
  // not the main axis (height) - so without an explicit height, Sidebar
  // sized itself to its own content and left a gap below it instead of
  // reaching the bottom of the screen. The pinned/tabletLarge case doesn't
  // need this (it's a row-flex child, where cross-axis stretch already
  // gives it full height for free) but doesn't regress from it either.
  container: {
    width: SIDEBAR_WIDTH,
    height: '100%',
    backgroundColor: colors.surface,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
  },
  containerFullWidth: { width: '100%', borderRightWidth: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerBrand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
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
