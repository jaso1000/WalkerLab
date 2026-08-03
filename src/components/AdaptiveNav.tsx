// Persistent app navigation, rendered once in the root layout around every
// screen (see app/_layout.tsx) - so unlike the Drawer/Tabs navigator this
// replaced, it's mounted for the whole app's lifetime, not just for the 9
// top-level sections. Screen width alone decides the layout, matching
// Seerr's own web app (checked their actual source for this - Layout/
// Sidebar/MobileMenu - which uses Tailwind's default 640/1024 breakpoints,
// see src/lib/navChrome.ts): phone width gets the floating pill bar
// overlaying content; medium tablet width gets an off-canvas sidebar toggled
// from each top-level screen's header (SidebarMenuButton); large tablet
// width and up gets an always-visible side panel with content pushed over to
// make room. There is no user-facing choice between these anymore - see
// PLAN.md's "Current status" for why the old per-profile Drawer/Tabs
// preference was removed rather than kept alongside this.
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { FloatingPill, FLOATING_PILL_BOTTOM, FLOATING_PILL_HEIGHT } from './FloatingPill';
import { ProfileSwitcher } from './ProfileSwitcher';
import { Sidebar } from './Sidebar';
import { SidebarOverlay } from './SidebarOverlay';
import { useAuth } from '../context/AuthContext';
import { useProfiles } from '../context/ProfilesContext';
import { useSectionNames } from '../context/SectionNamesContext';
import { useServiceEnabled } from '../context/ServiceEnabledContext';
import { NavChrome, NavChromeContext, navTierForWidth } from '../lib/navChrome';
import { SECTION_META } from '../lib/sectionMeta';
import { serviceForSection } from '../lib/serviceMeta';
import { StartupSectionId } from '../lib/startupScreen';
import { FLOATING_BAR_GAP, TabBarClearanceContext } from '../lib/tabBarClearance';
import { DEFAULT_TAB_ORDER, getTabOrder, splitTabOrder } from '../lib/tabOrder';
import { colors } from '../theme/colors';

export function AdaptiveNav({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const { loading: profilesLoading, activeProfileId, activeProfile } = useProfiles();
  const { isEnabled } = useServiceEnabled();
  const { names } = useSectionNames();
  const { logout } = useAuth();
  const [order, setOrder] = useState<StartupSectionId[] | null>(null);
  const orderResolvedRef = useRef(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const tier = navTierForWidth(width);

  // A live resize (web) crossing a breakpoint away from tabletMedium
  // shouldn't leave the overlay stuck "open" for next time that tier is
  // re-entered.
  useEffect(() => {
    setSidebarOpen(false);
  }, [tier]);

  // Resolves once per app launch (not on every later profile switch) - a
  // failed lookup still falls back to the default order rather than
  // leaving the nav chrome permanently unresolved. This has no bearing on
  // routing/the startup screen at all anymore (that's handled independently
  // in app/_layout.tsx) - it only affects which sections this component
  // shows and in what order, so there's no risk of it blocking or racing
  // with navigation the way the old combined navPrefs load once did.
  useEffect(() => {
    if (profilesLoading || orderResolvedRef.current) return;
    orderResolvedRef.current = true;
    getTabOrder(activeProfileId)
      .then(setOrder)
      .catch(() => setOrder(DEFAULT_TAB_ORDER));
  }, [profilesLoading, activeProfileId]);

  const resolvedOrder = order ?? DEFAULT_TAB_ORDER;

  // Sections whose owning service is disabled drop out entirely (not just
  // hidden) - same "not configured, don't show it anywhere" reasoning this
  // always used, back when it lived in DrawerContent's own filtering.
  const enabledOrder = resolvedOrder.filter((id) => {
    const service = serviceForSection(id);
    return !service || isEnabled(service);
  });
  const { primary: primaryIds, overflow: overflowIds } = splitTabOrder(enabledOrder);

  // The persistent sidebar has room to just list every enabled section, so
  // it has no "More" overflow concept at all - only the width-constrained
  // pill needs one.
  const moreSheetOptions: ActionSheetOption[] = [
    ...overflowIds.map((id) => ({
      label: names[id],
      icon: SECTION_META[id].icon,
      tint: SECTION_META[id].tint,
      onPress: () => router.push(SECTION_META[id].href as never),
    })),
    {
      label: names.settings,
      icon: SECTION_META.settings.icon,
      onPress: () => router.push('/settings'),
    },
    {
      label: `Switch Profile (${activeProfile.name})`,
      icon: 'server-outline' as const,
      onPress: () => setProfileMenuOpen(true),
    },
    ...(Platform.OS === 'web'
      ? [{ label: 'Log Out', icon: 'log-out-outline' as const, tint: colors.danger, onPress: logout }]
      : []),
  ];

  // Only reserve clearance once the pill is both showing (phone tier) and
  // actually resolved (order !== null) - it renders nothing until then, so
  // there's nothing yet to clear.
  const clearance = tier === 'phone' && order ? FLOATING_PILL_HEIGHT + FLOATING_PILL_BOTTOM + FLOATING_BAR_GAP : 0;

  const navChrome: NavChrome = {
    tier,
    sidebarOpen,
    openSidebar: () => setSidebarOpen(true),
    closeSidebar: () => setSidebarOpen(false),
  };

  return (
    <NavChromeContext.Provider value={navChrome}>
      <TabBarClearanceContext.Provider value={clearance}>
        <View style={styles.root}>
          {tier === 'tabletLarge' ? <Sidebar order={enabledOrder} /> : null}
          <View style={styles.content}>
            {children}
            {tier === 'phone' && order ? <FloatingPill primaryIds={primaryIds} onMorePress={() => setMoreSheetOpen(true)} /> : null}
          </View>
          {tier === 'tabletMedium' ? (
            <SidebarOverlay visible={sidebarOpen} order={enabledOrder} onClose={() => setSidebarOpen(false)} />
          ) : null}
        </View>
        <ActionSheet visible={moreSheetOpen} title="More" options={moreSheetOptions} onClose={() => setMoreSheetOpen(false)} />
        <ProfileSwitcher visible={profileMenuOpen} onClose={() => setProfileMenuOpen(false)} />
      </TabBarClearanceContext.Provider>
    </NavChromeContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row' },
  // `minWidth: 0` is the actual fix for cards getting cut off at wide
  // (tabletLarge) widths - without it, this flex:1 sibling of the
  // fixed-width pinned Sidebar defaults to `min-width: auto` on web, which
  // means it takes on whatever width its OWN content (children) wants
  // rather than being constrained to the real leftover space next to the
  // sidebar. A roomy 3-column grid "wants" to be wide, so `content` (and the
  // whole page) grew past the actual viewport instead of the grid shrinking
  // to fit it - the individual cards' own `minWidth: 0` fixes weren't wrong,
  // just insufficient on their own, since the container one level up was
  // never actually constrained in the first place.
  content: { flex: 1, minWidth: 0 },
});
