// react-native-web has no real implementation of `RefreshControl` - there's
// no browser equivalent of a touch pull-to-refresh gesture, so every screen
// using the pull-to-refresh pattern silently has no way to manually reload
// on web. Renders nothing on native (where the real pull gesture already
// works) - callers pass whichever load function the currently-active tab
// needs refreshed.
import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, TouchableOpacity } from 'react-native';

export function WebRefreshButton({ onPress, tint }: { onPress: () => void; tint: string }) {
  if (Platform.OS !== 'web') return null;
  return (
    <TouchableOpacity style={styles.button} onPress={onPress} accessibilityLabel="Refresh">
      <Ionicons name="refresh" size={20} color={tint} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: { padding: 8 },
});
