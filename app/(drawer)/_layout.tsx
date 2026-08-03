// Layout for every screen reachable from the app's root navigation - renders
// either the hamburger side Drawer or a bottom Tabs bar (user's choice, see
// Settings > Navigation), registers each section with its own colored
// icon+title header, and opens directly on the active profile's configured
// startup screen.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { Tabs } from 'expo-router/tabs';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { ActionSheet, ActionSheetOption } from '../../src/components/ActionSheet';
import { DrawerContent } from '../../src/components/DrawerContent';
import { ProfileSwitcher } from '../../src/components/ProfileSwitcher';
import { useAuth } from '../../src/context/AuthContext';
import { useProfiles } from '../../src/context/ProfilesContext';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { useServiceEnabled } from '../../src/context/ServiceEnabledContext';
import { DEFAULT_NAVIGATION_STYLE, getNavigationStyle, NavigationStyle } from '../../src/lib/navigationStyle';
import { SECTION_META, SECTION_ORDER } from '../../src/lib/sectionMeta';
import { serviceForSection } from '../../src/lib/serviceMeta';
import { DEFAULT_STARTUP_SCREEN, getStartupScreen, startupRoute, StartupSectionId } from '../../src/lib/startupScreen';
import { DEFAULT_TAB_ORDER, getTabOrder, splitTabOrder } from '../../src/lib/tabOrder';
import { colors } from '../../src/theme/colors';

// Colored icon + label combo used as every screen's header title, matching
// that section's accent color instead of a plain text header.
function HeaderTitle({ icon, tint, title }: { icon: keyof typeof Ionicons.glyphMap; tint?: string; title: string }) {
  return (
    <View style={styles.headerTitle}>
      <Ionicons name={icon} size={20} color={tint ?? colors.textPrimary} />
      <Text style={styles.headerTitleText}>{title}</Text>
    </View>
  );
}

export default function DrawerLayout() {
  const { names } = useSectionNames();
  const { loading: profilesLoading, activeProfileId, activeProfile } = useProfiles();
  const { isEnabled } = useServiceEnabled();
  const { logout } = useAuth();
  const [navPrefs, setNavPrefs] = useState<{ style: NavigationStyle; order: StartupSectionId[] } | null>(null);
  const navResolvedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const startupResolvedRef = useRef(false);
  const [moreSheetOpen, setMoreSheetOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  // Step 1: resolve which navigator to render (and the section order),
  // once, before either Drawer or Tabs ever mounts for the first time -
  // see the safety note below for why this is fine even though a very
  // similar-looking "wait before rendering the navigator" pattern caused a
  // real production bug earlier this session.
  useEffect(() => {
    if (profilesLoading || navResolvedRef.current) return;
    navResolvedRef.current = true;
    Promise.all([getNavigationStyle(activeProfileId), getTabOrder(activeProfileId)])
      .then(([style, order]) => setNavPrefs({ style, order }))
      .catch(() => setNavPrefs({ style: DEFAULT_NAVIGATION_STYLE, order: DEFAULT_TAB_ORDER }));
  }, [profilesLoading, activeProfileId]);

  // Step 2: resolve (and, if needed, navigate to) the configured startup
  // screen - unchanged logic from before this session's Drawer/Tabs choice
  // was added, EXCEPT now gated on `navPrefs` instead of `profilesLoading`.
  // That change is what keeps this safe: it guarantees `router.replace()`
  // below can only ever fire after step 1 has already produced a render
  // with a real, mounted navigator (Drawer or Tabs) - never while one is
  // still being decided.
  //
  // The bug this avoids repeating: an earlier version of this file withheld
  // rendering the Drawer entirely until the startup screen resolved, so
  // `router.replace()` could fire before Drawer ever mounted. That's
  // different from what's happening here - here, NEITHER navigator has
  // ever mounted while `navPrefs` is null, and no `router.replace()` call
  // is involved in *choosing which one to render* at all. Once `navPrefs`
  // resolves, the render commits to one specific navigator and never
  // reverts to null again for this component instance, so from that point
  // on it's identical to the "always mounted" invariant that was the
  // actual fix last time. Only resolves once per app launch (not on every
  // later profile switch), and a failed lookup still clears the overlay
  // rather than leaving it up forever.
  useEffect(() => {
    if (!navPrefs || startupResolvedRef.current) return;
    startupResolvedRef.current = true;
    getStartupScreen(activeProfileId)
      .then((id) => {
        if (id !== DEFAULT_STARTUP_SCREEN) router.replace(startupRoute(id));
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [navPrefs, activeProfileId]);

  if (!navPrefs) {
    return <View style={[styles.root, styles.loadingOverlay]} />;
  }

  // Sections whose owning service is disabled drop out entirely (not just
  // hidden) - same "not configured, don't show it anywhere" reasoning the
  // old Drawer-only code already applied via DrawerContent's own filtering.
  const enabledOrder = navPrefs.order.filter((id) => {
    const service = serviceForSection(id);
    return !service || isEnabled(service);
  });
  const { primary: primaryIds, overflow: overflowIds } = splitTabOrder(enabledOrder);

  // Bottom Tabs has no persistent footer the way the Drawer does, so the
  // profile switcher and (web) log-out - normally always-visible footer
  // rows in DrawerContent - live in the More sheet instead, alongside the
  // overflow sections and Settings.
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

  return (
    <View style={styles.root}>
      {navPrefs.style === 'tabs' ? (
        <Tabs
          // React Navigation's default is `backBehavior: 'firstRoute'`,
          // which makes a GO_BACK action return to the first registered tab
          // (whatever sits at index 0 of the user's chosen order) rather
          // than the tab you actually came from - see the router's own
          // `getRouteHistory`, which unshifts `routes[0].key` whenever
          // `index !== 0`. 'history' returns to the last visited tab
          // instead, which is what Android's hardware back should do.
          //
          // This also measurably improves browser-back on web (confirmed by
          // the user in real use - back walks back through tabs in the
          // common cases instead of jumping to the startup screen). Likely
          // because this router's own `history` array is part of the
          // navigator state expo-router serializes into browser history, so
          // it feeds the push/replace decisions there too - i.e. don't
          // assume this is Android-hardware-back-only just because web back
          // arrives as a popstate rather than a GO_BACK.
          //
          // It does not eliminate the problem: a residual overshoot to the
          // startup screen still reproduces after enough back-and-forth
          // cycles (expo/expo#38594 - tab presses don't always push a
          // history entry). See PLAN.md's top "Current status" entry.
          backBehavior="history"
          screenOptions={{
            headerShown: true,
            headerStyle: { backgroundColor: colors.background },
            headerShadowVisible: false,
            headerTintColor: colors.textPrimary,
            tabBarActiveTintColor: colors.textPrimary,
            tabBarInactiveTintColor: colors.textSecondary,
            // Icons only - labels got cramped/cut off at this width, and the
            // active tint color alone is enough to show which one's selected.
            tabBarLabelVisibilityMode: 'unlabeled',
            // No default background renderer (a translucent/blur layer some
            // platforms render behind the bar by default) - it's fully owned
            // by tabBarStyle.backgroundColor below.
            tabBarBackground: () => null,
            // Deliberately NO `sceneStyle` bottom padding here. An earlier
            // version reserved a 96px-tall strip so
            // content couldn't sit under the absolutely-positioned bar, and
            // painted it opaque to stop inactive tab screens (React
            // Navigation keeps them mounted behind the active one at
            // `z-index: -1`) bleeding through it. Both were wrong: the
            // reserved strip sat *outside* the screen's own painted area,
            // which is the only reason anything could leak there in the
            // first place, and painting it opaque boxed the pill into a
            // solid slab instead of letting it float over the content.
            // Letting the scene fill the full height fixes both - every
            // screen's root style is `flex: 1` + an opaque
            // `colors.background` (verified across all 9), so the active
            // screen covers the whole area and nothing behind it shows,
            // while content now runs edge to edge under the floating pill.
            // Truly floating pill: `position: 'absolute'` detaches the bar
            // from document/layout flow entirely, which is also what stops
            // React Navigation from applying its own default safe-area-driven
            // margin/sizing to the bar (that default logic only kicks in when
            // the bar is *not* absolutely positioned) - without this, the bar
            // rendered inside a reserved, slightly differently-sized box that
            // read as "a bar behind the pill" and didn't match other Settings
            // rows' width.
            tabBarStyle: {
              position: 'absolute',
              left: 16,
              right: 16,
              bottom: 16,
              backgroundColor: colors.surface,
              borderTopWidth: 0,
              borderRadius: 32,
              height: 64,
              elevation: 8,
              shadowColor: '#000',
              shadowOpacity: 0.3,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 4 },
            },
          }}
        >
          {primaryIds.map((id) => (
            <Tabs.Screen
              key={id}
              name={SECTION_META[id].screenName}
              options={{
                headerTitle: () => <HeaderTitle icon={SECTION_META[id].icon} tint={SECTION_META[id].tint} title={names[id]} />,
                tabBarLabel: names[id],
                // Color-coordinated per section (matching the Drawer's own
                // per-service accent colors) rather than one flat "active"
                // color for every tab - overrides screenOptions' default
                // just for this screen's active state.
                tabBarActiveTintColor: SECTION_META[id].tint,
                // Nudged down via `tabIconCenter` - confirmed live that the
                // tab item's icon slot is top-aligned and auto-sized (still
                // reserving space as if a label were below it, even in
                // unlabeled mode), and isn't reachable via `tabBarItemStyle`
                // or a `flex: 1` wrapper (its immediate parent doesn't pass
                // height through). See the style's own comment for the
                // measured offset this cancels out.
                tabBarIcon: ({ color, size }) => (
                  <View style={styles.tabIconCenter}>
                    <Ionicons name={SECTION_META[id].icon} size={size} color={color} />
                  </View>
                ),
              }}
            />
          ))}
          {overflowIds.map((id) => (
            <Tabs.Screen
              key={id}
              name={SECTION_META[id].screenName}
              options={{
                href: null,
                headerTitle: () => <HeaderTitle icon={SECTION_META[id].icon} tint={SECTION_META[id].tint} title={names[id]} />,
              }}
            />
          ))}
          {/* Settings' own screen doubles as the always-present "More" tab
              slot, whichever/however many primary tabs are showing - its
              tabPress is intercepted so it opens the sheet instead of ever
              actually navigating there directly. */}
          <Tabs.Screen
            name="settings"
            options={{
              tabBarLabel: 'More',
              tabBarIcon: ({ color, size }) => (
                <View style={styles.tabIconCenter}>
                  <Ionicons name="ellipsis-horizontal" size={size} color={color} />
                </View>
              ),
              headerTitle: () => <HeaderTitle icon={SECTION_META.settings.icon} title={names.settings} />,
            }}
            listeners={{
              tabPress: (e) => {
                e.preventDefault();
                setMoreSheetOpen(true);
              },
            }}
          />
        </Tabs>
      ) : (
        <Drawer
          drawerContent={(props) => <DrawerContent {...props} order={enabledOrder} />}
          screenOptions={{
            headerShown: true,
            headerStyle: { backgroundColor: colors.background },
            headerShadowVisible: false,
            headerTintColor: colors.textPrimary,
            drawerStyle: { backgroundColor: colors.surface, width: 280 },
          }}
        >
          {/* Registration order here has no visual effect - `drawerContent`
              above fully replaces the default drawer list, so this is only
              route registration + each screen's header options. Always all
              9 sections regardless of enabled state, matching the same
              "still technically reachable, just not listed" behavior the
              custom DrawerContent's own filtering already provides. */}
          {SECTION_ORDER.map((id) => (
            <Drawer.Screen
              key={id}
              name={SECTION_META[id].screenName}
              options={{
                headerTitle: () => <HeaderTitle icon={SECTION_META[id].icon} tint={SECTION_META[id].tint} title={names[id]} />,
              }}
            />
          ))}
        </Drawer>
      )}
      <ActionSheet visible={moreSheetOpen} title="More" options={moreSheetOptions} onClose={() => setMoreSheetOpen(false)} />
      <ProfileSwitcher visible={profileMenuOpen} onClose={() => setProfileMenuOpen(false)} />
      {!ready && <View style={styles.loadingOverlay} pointerEvents="none" />}
    </View>
  );
}

const styles = StyleSheet.create({
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitleText: { color: colors.textPrimary, fontWeight: '700', fontSize: 20 },
  root: { flex: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.background },
  // The tab bar's icon slot is top-aligned and sized as if a label were
  // still rendered below it, even with tabBarLabelVisibilityMode:
  // 'unlabeled' - measured live (web) at a consistent 5px gap above the
  // icon vs. 31px below it, in every tab, every render. 13 is half that
  // 26px asymmetry, so this centers the icon within the bar (18px/18px).
  // `transform` rather than `marginTop`: confirmed live that marginTop only
  // partially applied (shifted 7px of the 13 requested), almost certainly
  // margin collapsing through the icon slot's mixed flex/block ancestor
  // chain - a transform shifts the rendered element directly without
  // going through box-model/margin-collapse rules at all.
  tabIconCenter: { transform: [{ translateY: 13 }] },
});
