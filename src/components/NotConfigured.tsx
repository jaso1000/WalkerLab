// Full-screen placeholder shown instead of a service's real content when
// that service has no saved credentials yet - every service screen renders
// this rather than attempting API calls with a blank config.
import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export function NotConfigured({ service, tint = colors.accent }: { service: string; tint?: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>{service} isn&apos;t connected yet.</Text>
      <Link href="/settings" style={[styles.link, { color: tint }]}>
        Go to Settings
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12, backgroundColor: colors.background },
  text: { fontSize: 16, color: colors.textSecondary, textAlign: 'center' },
  link: { fontWeight: '700' },
});
