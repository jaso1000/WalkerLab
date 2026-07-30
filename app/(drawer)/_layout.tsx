// Layout for every screen reachable from the hamburger drawer - registers
// each root section as a `Drawer.Screen` with its own colored icon+title
// header, wires in the custom `DrawerContent`, and redirects to the active
// profile's configured startup screen once on launch.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { useEffect, useRef } from 'react';
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
  const redirected = useRef(false);

  // Wait for the active profile to finish loading before deciding where to
  // redirect - this must reflect whichever profile the app actually boots
  // into, and must only ever fire once per app launch (not on every later
  // profile switch, which shouldn't yank the user to a different screen).
  useEffect(() => {
    if (redirected.current || profilesLoading) return;
    redirected.current = true;
    getStartupScreen(activeProfileId).then((id) => {
      if (id !== DEFAULT_STARTUP_SCREEN) router.replace(startupRoute(id));
    });
  }, [profilesLoading, activeProfileId]);

  return (
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
  );
}

const styles = StyleSheet.create({
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitleText: { color: colors.textPrimary, fontWeight: '700', fontSize: 20 },
});
