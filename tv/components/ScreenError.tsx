// The TV's version of src/components/SectionErrorBoundary.tsx: shown in place of a section that threw
// while rendering, inside the normal Shell so the side navigation still works, with a focused Try Again.
// A route wires it up through Expo Router's `ErrorBoundary` export:
//
//   export const ErrorBoundary = screenErrorBoundary('stats', 'Stats', colors.tautulli);
import type { ErrorBoundaryProps } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SectionId } from '../../src/lib/sectionNames';
import { colors } from '../../src/theme/colors';
import { FocusCard } from './FocusCard';
import { Shell } from './Shell';

export function screenErrorBoundary(active: SectionId, section: string, tint: string = colors.accent) {
  return function ScreenErrorBoundary({ error, retry }: ErrorBoundaryProps) {
    return (
      <Shell active={active}>
        <View style={styles.center}>
          <Text style={styles.title}>{section} couldn&apos;t be shown</Text>
          <Text style={styles.text}>
            Something in the data it received was unexpected. Check that the service is running and connected, then try again.
          </Text>
          {error?.message ? (
            <Text style={styles.detail} numberOfLines={3}>
              {error.message}
            </Text>
          ) : null}
          <FocusCard radius={10} scale={1.05} style={[styles.button, { backgroundColor: tint }]} onPress={() => retry()} preferredFocus>
            <Text style={styles.buttonText}>Try Again</Text>
          </FocusCard>
        </View>
      </Shell>
    );
  };
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '700' },
  text: { color: colors.textSecondary, fontSize: 15, marginTop: 8, textAlign: 'center', maxWidth: 520 },
  detail: { color: colors.textMuted, fontSize: 13, marginTop: 8, textAlign: 'center', maxWidth: 520 },
  button: { marginTop: 18, paddingHorizontal: 18, paddingVertical: 9 },
  buttonText: { color: colors.background, fontSize: 15, fontWeight: '700' },
});
