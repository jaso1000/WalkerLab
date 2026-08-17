// Root layout - Expo Router's top-level entry point. Wraps the whole app in
// every global provider it needs (gesture handling, safe-area insets, the
// profile/server/section-name/service-enabled contexts, dark navigation
// theme) and mounts `AlertHost` once so the themed alert system works from
// any screen. Provider order matters: `AuthGate` must be outermost (nothing
// profile-scoped should even try to load before a web instance is unlocked -
// it's a pure passthrough on native, see AuthContext.tsx), and within that,
// `ProfilesProvider` must be outermost among the rest since every other
// profile-scoped context reads `activeProfileId` from it.
import { DarkTheme, ThemeProvider } from 'expo-router/react-navigation';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AdaptiveNav } from '../src/components/AdaptiveNav';
import { AlertHost } from '../src/components/AlertHost';
import { AuthGate } from '../src/context/AuthContext';
import { ProfilesProvider, useProfiles } from '../src/context/ProfilesContext';
import { SectionNamesProvider } from '../src/context/SectionNamesContext';
import { ServiceEnabledProvider } from '../src/context/ServiceEnabledContext';
import { ServersProvider } from '../src/context/ServersContext';
import { DEFAULT_STARTUP_SCREEN, getStartupScreen, startupRoute } from '../src/lib/startupScreen';
import { checkForNewContent, registerBackgroundPolling } from '../src/lib/notificationPolling';
import { getPollingPrefs } from '../src/lib/notificationPrefs';
import { colors } from '../src/theme/colors';

// React Navigation's DarkTheme, repointed at this app's own palette so
// native navigation chrome (header/tab backgrounds handled by RN Navigation
// internals) matches the rest of the dark-theme-only UI.
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.background,
    text: colors.textPrimary,
    border: colors.border,
    primary: colors.accent,
  },
};

// Resolves (and, if needed, navigates to) the active profile's configured
// startup screen once profiles have loaded. This has no dependency on
// AdaptiveNav's own nav-chrome state at all - unlike the old combined
// "which navigator to render" decision this used to be entangled with, the
// Stack is always mounted from the very first render regardless of any
// nav-chrome loading, so there's no risk of this `router.replace()` ever
// firing before something it targets exists. Only resolves once per app
// launch (not on every later profile switch); a failed lookup still clears
// the overlay rather than leaving it up forever.
function useStartupRedirect(profilesLoading: boolean, activeProfileId: string) {
  const [ready, setReady] = useState(false);
  const resolvedRef = useRef(false);

  useEffect(() => {
    if (profilesLoading || resolvedRef.current) return;
    resolvedRef.current = true;
    getStartupScreen(activeProfileId)
      .then((id) => {
        if (id !== DEFAULT_STARTUP_SCREEN) router.replace(startupRoute(id));
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, [profilesLoading, activeProfileId]);

  return ready;
}

function RootStack() {
  const { loading: profilesLoading, activeProfileId } = useProfiles();
  const ready = useStartupRedirect(profilesLoading, activeProfileId);

  // Native-only (web keeps real push, delivered independently of app
  // launches - see src/lib/notificationPolling.ts's header comment for the
  // full native-vs-web split). Runs once per launch, independent of
  // whichever profile is currently active - polling has its own saved
  // target profileId (see notificationPrefs.ts, v1 scope is one profile,
  // not "whatever's active"). Re-registering the background task on every
  // launch is idempotent (just updates its interval); the immediate check
  // means opening the app surfaces anything that arrived since the last
  // background run, not just whatever the next scheduled check turns up. A
  // no-op if notifications were never configured (getPollingPrefs()
  // returns null, checkForNewContent() itself no-ops on no prefs).
  useEffect(() => {
    if (Platform.OS === 'web') return;
    (async () => {
      const prefs = await getPollingPrefs();
      if (prefs && Object.values(prefs.services).some(Boolean)) {
        await registerBackgroundPolling(prefs.intervalMinutes).catch(() => {});
      }
      await checkForNewContent().catch(() => {});
    })();
  }, []);

  return (
    <AdaptiveNav>
      <Stack screenOptions={{ headerShown: false }}>
        {/* The primary sections FloatingPill/Sidebar/CompactSidebar navigate
            between (see their own `navigate()` comments) are conceptually
            tab switches, not "drilling into" something - the platform's
            default slide/fade push transition (used everywhere else in the
            app, left as the default below) implies forward motion that
            doesn't really fit sibling-to-sibling switching, and was another
            real contributor to native feeling slower than web (which has no
            equivalent transition at all for a plain route change). Every
            other screen keeps the default native transition. */}
        {(
          ['index', 'discover', 'movies', 'music', 'downloads', 'nzbget', 'torrents', 'overseerr', 'tautulli', 'containers', 'settings'] as const
        ).map((name) => (
          <Stack.Screen key={name} name={name} options={{ animation: 'none' }} />
        ))}
      </Stack>
      {!ready && <View style={styles.loadingOverlay} pointerEvents="none" />}
    </AdaptiveNav>
  );
}

export default function RootLayout() {
  // Expo's web template never sets a background-color on <html>/<body>, so
  // it defaults to white. That's invisible almost everywhere since #root
  // covers the full viewport - except Chrome on Android's overscroll/
  // rubber-band bounce at the top/bottom of the page briefly reveals
  // whatever's behind the app's own content, i.e. that white default.
  // Firefox on Android and desktop browsers don't exhibit the same
  // bounce-reveal (confirmed by the user: white flash only on Chrome
  // mobile, fine on Firefox mobile and desktop), which is why this never
  // showed up until real phone testing. Setting it here keeps the fix in
  // already-`Platform.OS === 'web'`-gated app code rather than fighting
  // Expo's web HTML template mechanism for one CSS property.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.documentElement.style.backgroundColor = colors.background;
    document.body.style.backgroundColor = colors.background;
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthGate>
          <ProfilesProvider>
            <ServersProvider>
              <SectionNamesProvider>
                <ServiceEnabledProvider>
                  <ThemeProvider value={navigationTheme}>
                    <StatusBar style="light" />
                    <RootStack />
                    <AlertHost />
                  </ThemeProvider>
                </ServiceEnabledProvider>
              </SectionNamesProvider>
            </ServersProvider>
          </ProfilesProvider>
        </AuthGate>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.background },
});
