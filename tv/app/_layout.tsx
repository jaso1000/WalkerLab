// Root of the Android TV build (EXPO_TV=1 points Expo Router here, see app.config.js). Same profile
// and server providers as the phone app, so a restored profile behaves exactly as it does there; no
// AdaptiveNav (phone/tablet chrome), notifications or background polling.
import { DarkTheme, ThemeProvider } from 'expo-router/react-navigation';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ProfilesProvider } from '../../src/context/ProfilesContext';
import { SectionNamesProvider } from '../../src/context/SectionNamesContext';
import { ServersProvider } from '../../src/context/ServersContext';
import { ServiceEnabledProvider } from '../../src/context/ServiceEnabledContext';
import { colors } from '../../src/theme/colors';
import { TvAlertHost } from '../components/TvAlertHost';

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

export default function TvRootLayout() {
  return (
    <SafeAreaProvider>
      <ProfilesProvider>
        <ServersProvider>
          <SectionNamesProvider>
            <ServiceEnabledProvider>
              <ThemeProvider value={navigationTheme}>
                <StatusBar hidden />
                <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: colors.background } }} />
                <TvAlertHost />
              </ThemeProvider>
            </ServiceEnabledProvider>
          </SectionNamesProvider>
        </ServersProvider>
      </ProfilesProvider>
    </SafeAreaProvider>
  );
}
