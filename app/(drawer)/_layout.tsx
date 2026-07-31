// Layout for every screen reachable from the hamburger drawer - registers
// each root section as a `Drawer.Screen` with its own colored icon+title
// header, wires in the custom `DrawerContent`, and opens directly on the
// active profile's configured startup screen.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DrawerContent } from '../../src/components/DrawerContent';
import { useProfiles } from '../../src/context/ProfilesContext';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { DEFAULT_STARTUP_SCREEN, getStartupScreen, startupRoute } from '../../src/lib/startupScreen';
import { colors } from '../../src/theme/colors';

// Colored icon + label combo used as every drawer screen's header title,
// matching that section's accent color instead of a plain text header.
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
  const { loading: profilesLoading, activeProfileId } = useProfiles();
  const [ready, setReady] = useState(false);
  const resolved = useRef(false);

  // Resolve (and, if needed, navigate to) the configured startup screen.
  // The Drawer below must always render unconditionally - a previous
  // version of this effect withheld rendering it (returning a plain
  // `View` instead) until this resolved, so that `router.replace()` could
  // fire before Drawer ever mounted on its file-based default route
  // ("index", TV Shows). That seemed reasonable (mirroring how a cold
  // deep-link to a specific path works) but was wrong in a way that only
  // showed up live: replacing to a path *inside* a Drawer that was never
  // actually mounted forced Expo Router to tear the whole `(drawer)`
  // layout down and recreate it from scratch - which reset this
  // component's own state/refs, re-running this same effect again, ad
  // infinitum (confirmed live: an endless flood of identical
  // `/api/startup-screen/...` requests, crashing the native app and
  // hanging the web build on a blank screen).
  //
  // Fixed by always mounting the Drawer immediately (so `router.replace()`
  // always has a real, stable navigator to act on - the exact
  // `router.replace()`-after-mount approach this file used before this
  // session, which worked fine), and hiding the resulting brief flash of
  // the wrong screen with an opaque overlay instead of ever un-mounting
  // Drawer itself.
  //
  // Only resolves once per app launch (not on every later profile switch,
  // which shouldn't yank the user to a different screen), and a failed
  // lookup (e.g. a network hiccup on the web build's own backend call)
  // still clears the overlay rather than leaving it up forever.
  useEffect(() => {
    if (profilesLoading || resolved.current) return;
    resolved.current = true;
    getStartupScreen(activeProfileId)
      .then((id) => {
        if (id !== DEFAULT_STARTUP_SCREEN) router.replace(startupRoute(id));
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [profilesLoading, activeProfileId]);

  return (
    <View style={styles.root}>
      <Drawer
        drawerContent={(props) => <DrawerContent {...props} />}
        screenOptions={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.textPrimary,
          drawerStyle: { backgroundColor: colors.surface, width: 280 },
        }}
      >
        <Drawer.Screen
          name="discover"
          options={{
            headerTitle: () => <HeaderTitle icon="compass" tint={colors.sectionGreen} title={names.discover} />,
          }}
        />
        <Drawer.Screen
          name="index"
          options={{
            headerTitle: () => <HeaderTitle icon="tv" tint={colors.sonarr} title={names.tvShows} />,
          }}
        />
        <Drawer.Screen
          name="movies"
          options={{
            headerTitle: () => <HeaderTitle icon="film" tint={colors.accent} title={names.movies} />,
          }}
        />
        <Drawer.Screen
          name="downloads"
          options={{
            headerTitle: () => <HeaderTitle icon="download" tint={colors.sabnzbd} title={names.downloads} />,
          }}
        />
        <Drawer.Screen
          name="torrents"
          options={{
            headerTitle: () => <HeaderTitle icon="swap-vertical" tint={colors.qbittorrent} title={names.torrents} />,
          }}
        />
        <Drawer.Screen
          name="overseerr"
          options={{
            headerTitle: () => <HeaderTitle icon="list" tint={colors.overseerr} title={names.requests} />,
          }}
        />
        <Drawer.Screen
          name="tautulli"
          options={{
            headerTitle: () => <HeaderTitle icon="stats-chart" tint={colors.tautulli} title={names.stats} />,
          }}
        />
        <Drawer.Screen
          name="containers"
          options={{
            headerTitle: () => <HeaderTitle icon="cube" tint={colors.portainer} title={names.containers} />,
          }}
        />
        <Drawer.Screen
          name="settings"
          options={{
            headerTitle: () => <HeaderTitle icon="settings-outline" title={names.settings} />,
          }}
        />
      </Drawer>
      {!ready && <View style={styles.loadingOverlay} pointerEvents="none" />}
    </View>
  );
}

const styles = StyleSheet.create({
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitleText: { color: colors.textPrimary, fontWeight: '700', fontSize: 20 },
  root: { flex: 1 },
  loadingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.background },
});
