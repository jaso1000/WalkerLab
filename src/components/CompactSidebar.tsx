// Persistent icon-only nav rail - narrower than the full labeled Sidebar,
// this is the tabletMedium tier's own default (640-1024px, see
// src/lib/navChrome.ts) and something either tablet tier's Sidebar can be
// collapsed into via its own collapse button (AdaptiveNav.tsx owns which of
// the two is actually showing at either tier). Unlike the off-canvas
// overlay this originally replaced, it's always visible and reserves its
// own layout width rather than needing an open/close toggle - only which of
// the two WIDTHS is showing is toggleable. The user specifically asked for
// this to replace the expandable/off-canvas version with something
// persistent, matching a reference screenshot of a slim always-on icon rail
// - adapted to this app's own dark theme and section colors (SECTION_META)
// rather than copying the reference's own palette.
//
// Nav items use `router.navigate()`, not `push` - see FloatingPill.tsx's
// comment for the full reasoning (same fix, same reason: these are flat
// sibling sections under one root Stack, so `push` grows it by one
// fully-mounted screen per tap instead of reusing the existing instance).
import { Image } from 'expo-image';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ProfileSwitcher } from './ProfileSwitcher';
import { useAuth } from '../context/AuthContext';
import { isSectionActive } from '../lib/activeSection';
import { COMPACT_SIDEBAR_WIDTH } from '../lib/navChrome';
import { SECTION_META } from '../lib/sectionMeta';
import { StartupSectionId } from '../lib/startupScreen';
import { colors } from '../theme/colors';

// `order` is the caller's already-resolved (per-profile, already
// enabled-service-filtered) list of non-Settings sections to show, in the
// user's chosen order - see `src/lib/tabOrder.ts`, same as the full Sidebar.
// `onExpand` swaps this out for the full labeled Sidebar (AdaptiveNav.tsx
// owns the actual expanded/collapsed state).
export function CompactSidebar({ order, onExpand }: { order: StartupSectionId[]; onExpand: () => void }) {
  const pathname = usePathname();
  const { logout } = useAuth();
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const visibleItems = order.map((sectionId) => ({ sectionId, ...SECTION_META[sectionId] }));

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Image source={require('../../assets/walkerlab-icon.png')} style={styles.logoIcon} />
      </View>
      <TouchableOpacity style={styles.expandButton} onPress={onExpand} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
      <View style={styles.divider} />

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {visibleItems.map((item) => {
          const active = isSectionActive(pathname, item.href, item.activePrefixes);
          return (
            <TouchableOpacity key={item.href} style={styles.iconButton} onPress={() => router.navigate(item.href as never)}>
              <View style={[styles.iconCircle, active ? { backgroundColor: `${item.tint}26` } : null]}>
                <Ionicons name={item.icon} size={20} color={active ? item.tint : colors.textSecondary} />
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.divider} />
        <TouchableOpacity style={styles.iconButton} onPress={() => router.navigate('/settings')}>
          <View style={styles.iconCircle}>
            <Ionicons name={SECTION_META.settings.icon} size={20} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={styles.iconButton} onPress={() => setProfileMenuOpen(true)}>
          <View style={styles.iconCircle}>
            <Ionicons name="server-outline" size={20} color={colors.textSecondary} />
          </View>
        </TouchableOpacity>
        {Platform.OS === 'web' ? (
          <TouchableOpacity style={styles.iconButton} onPress={logout}>
            <View style={styles.iconCircle}>
              <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            </View>
          </TouchableOpacity>
        ) : null}
      </View>

      <ProfileSwitcher visible={profileMenuOpen} onClose={() => setProfileMenuOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    width: COMPACT_SIDEBAR_WIDTH,
    height: '100%',
    backgroundColor: colors.surface,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.border,
    alignItems: 'center',
  },
  header: { paddingTop: 12, paddingBottom: 12 },
  logoIcon: { width: 32, height: 32, borderRadius: 8 },
  expandButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, width: '100%' },
  list: { paddingTop: 12, paddingBottom: 12, gap: 8, alignItems: 'center' },
  iconButton: { padding: 2 },
  // `overflow: 'hidden'` is a defensive Android-specific fix: without it,
  // the active-tint background rendered as a square instead of a circle on
  // the APK (never reproduced on web) - a known react-native-on-Android
  // quirk where a conditionally-merged style array's `borderRadius` doesn't
  // reliably clip a later-merged `backgroundColor` without an explicit
  // clip boundary, even though the same borderRadius/backgroundColor combo
  // already renders fine elsewhere in this app when applied unconditionally
  // in one flat object (e.g. discover.tsx's quickAddButton).
  iconCircle: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  footer: { paddingTop: 12, paddingBottom: 8, gap: 8, alignItems: 'center' },
});
