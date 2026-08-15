// Persistent app navigation, rendered once in the root layout around every
// screen (see app/_layout.tsx) - so unlike the Drawer/Tabs navigator this
// replaced, it's mounted for the whole app's lifetime, not just for the 9
// top-level sections. Screen width alone decides the layout (see
// src/lib/navChrome.ts for the exact breakpoints): phone width gets the
// floating pill bar overlaying content; both tablet tiers get a persistent
// sidebar that toggles between the full labeled Sidebar and the narrower
// icon-only CompactSidebar via each component's own expand/collapse button
// - defaulting to compact at tabletMedium (there's less room to spare) and
// expanded at tabletLarge (there's plenty), but the user can flip either one
// at will. Nothing is ever fully hidden/off-canvas at either tier (an
// earlier version used an off-canvas sidebar at medium width, matching
// Seerr's own web app, but the user asked for something persistent there
// instead, closer to a reference "compact icon rail" screenshot they
// shared). There is no OTHER user-facing choice between tiers - see
// PLAN.md's "Current status" for why the old per-profile Drawer/Tabs
// preference was removed rather than kept alongside this.
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { BlurTargetView } from 'expo-blur';
import { router, usePathname } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { CompactSidebar } from './CompactSidebar';
import { FloatingPill, FLOATING_PILL_BOTTOM, FLOATING_PILL_HEIGHT } from './FloatingPill';
import { ProfileSwitcher } from './ProfileSwitcher';
import { Sidebar } from './Sidebar';
import { useAuth } from '../context/AuthContext';
import { useProfiles } from '../context/ProfilesContext';
import { useSectionNames } from '../context/SectionNamesContext';
import { useServiceEnabled } from '../context/ServiceEnabledContext';
import { COMPACT_SIDEBAR_WIDTH, NavChrome, NavChromeContext, navTierForWidth, SIDEBAR_WIDTH } from '../lib/navChrome';
import { SECTION_META } from '../lib/sectionMeta';
import { sectionEnabled } from '../lib/serviceMeta';
import { StartupSectionId } from '../lib/startupScreen';
import { FLOATING_BAR_GAP, TabBarClearanceContext } from '../lib/tabBarClearance';
import { DEFAULT_TAB_ORDER, getTabOrder, splitTabOrder } from '../lib/tabOrder';
import { colors } from '../theme/colors';

export function AdaptiveNav({ children }: { children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { loading: profilesLoading, activeProfileId, activeProfile } = useProfiles();
  const { isEnabled } = useServiceEnabled();
  const { names } = useSectionNames();
  const { logout } = useAuth();
  const [order, setOrder] = useState<StartupSectionId[] | null>(null);
  const orderResolvedRef = useRef(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const tier = navTierForWidth(width);
  // The gallery is a real route (see app/gallery.tsx's own comment for
  // why) presented as a `transparentModal` over whatever screen opened
  // it - unlike the `<Modal>` it replaced (a genuine separate native
  // window, so it covered this persistent chrome for free), a routed
  // screen renders inside this same `content` View alongside the sidebar/
  // pill, so it needs an explicit opt-out to actually look full-screen.
  const pathname = usePathname();
  const hideNavChrome = pathname === '/gallery';
  // Only meaningful at the two tablet tiers (phone never renders either
  // Sidebar variant) - lets the user toggle between the full labeled
  // Sidebar and the narrower icon-only CompactSidebar via each component's
  // own button. Defaults differ per tier: compact at tabletMedium (less
  // room to spare), expanded at tabletLarge (plenty of room) - the lazy
  // initializer reads `tier` directly so the very first render already
  // picks the right default instead of a wrong one flashing before an
  // effect corrects it. Resets to that tier's own default whenever the
  // tier itself changes (a live resize crossing 640/1024), so resizing
  // away and back always starts fresh rather than an odd remembered state
  // from a completely different width.
  const [sidebarExpanded, setSidebarExpanded] = useState(() => tier === 'tabletLarge');
  useEffect(() => {
    setSidebarExpanded(tier === 'tabletLarge');
  }, [tier]);
  // Real Android blur (expo-blur's BlurView) needs an explicit ref to the
  // content sitting behind it to blur - see FloatingPill.tsx, the only
  // consumer. iOS/web don't need this (their blur just reads whatever's
  // compositing behind the view directly), but wrapping unconditionally
  // keeps this simple rather than only mounting BlurTargetView on the
  // phone tier where the pill actually renders.
  const contentBlurTarget = useRef<View>(null);

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
  const enabledOrder = resolvedOrder.filter((id) => sectionEnabled(id, isEnabled));
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
  // there's nothing yet to clear. `insets.bottom` has to be included because
  // the pill itself is offset by it (see FloatingPill.tsx) - on 3-button
  // navigation that's ~48dp, and omitting it here would leave the last list
  // row hidden behind the pill even though the pill itself now sits clear of
  // the system bar.
  const clearance =
    tier === 'phone' && order ? insets.bottom + FLOATING_PILL_HEIGHT + FLOATING_PILL_BOTTOM + FLOATING_BAR_GAP : 0;

  const sidebarWidth = hideNavChrome || tier === 'phone' ? 0 : sidebarExpanded ? SIDEBAR_WIDTH : COMPACT_SIDEBAR_WIDTH;
  const navChrome: NavChrome = { tier, sidebarWidth };

  return (
    <NavChromeContext.Provider value={navChrome}>
      <TabBarClearanceContext.Provider value={clearance}>
        <View style={styles.root}>
          {tier !== 'phone' && !hideNavChrome ? (
            sidebarExpanded ? (
              <Sidebar order={enabledOrder} onCollapse={() => setSidebarExpanded(false)} />
            ) : (
              <CompactSidebar order={enabledOrder} onExpand={() => setSidebarExpanded(true)} />
            )
          ) : null}
          <View style={styles.content}>
            <BlurTargetView ref={contentBlurTarget} style={styles.contentInner}>
              {children}
            </BlurTargetView>
            {tier === 'phone' && order && !hideNavChrome ? (
              <FloatingPill primaryIds={primaryIds} onMorePress={() => setMoreSheetOpen(true)} blurTargetRef={contentBlurTarget} />
            ) : null}
          </View>
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
  contentInner: { flex: 1 },
});
