// Shown in place of a screen that threw while rendering, instead of the whole
// app crashing (native) or going blank (web). Wired up per route through
// Expo Router's `ErrorBoundary` export - a route re-exports one of these:
//
//   export const ErrorBoundary = sectionErrorBoundary('Stats', colors.tautulli);
//
// First added for Stats, which crashed on every platform when Tautulli lost
// its Plex token and started answering with partial data. The API layer now
// normalizes that data (src/api/tautulli.ts), so this is the backstop for
// whatever shape a service surprises us with next, not the primary fix.
import { Ionicons } from '@expo/vector-icons';
import type { ErrorBoundaryProps } from 'expo-router';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '../theme/colors';

export function sectionErrorBoundary(section: string, tint: string = colors.accent) {
  return function SectionErrorBoundary({ error, retry }: ErrorBoundaryProps) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.body}>
          <Ionicons name="warning-outline" size={36} color={tint} />
          <Text style={styles.title}>{section} couldn&apos;t be shown</Text>
          <Text style={styles.text}>
            Something in the data it received was unexpected. Check that the service is running and connected, then try again.
          </Text>
          {error?.message ? (
            <Text style={styles.detail} numberOfLines={4}>
              {error.message}
            </Text>
          ) : null}
          <TouchableOpacity style={[styles.button, { backgroundColor: tint }]} onPress={() => retry()}>
            <Text style={styles.buttonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  title: { color: colors.textPrimary, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  text: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 420 },
  detail: { color: colors.textMuted, fontSize: 12, textAlign: 'center', maxWidth: 420 },
  button: { marginTop: 8, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
  buttonText: { color: colors.background, fontWeight: '800', fontSize: 15 },
});
