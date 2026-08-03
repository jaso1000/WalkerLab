// Colored icon + label combo used as every top-level section's header title,
// matching that section's accent color instead of a plain text header.
// Extracted from the old app/(drawer)/_layout.tsx (a real Tabs/Drawer
// navigator supplied this via its own headerTitle option) so each screen can
// now declare it directly via its own <Stack.Screen options={{headerTitle}}>.
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export function HeaderTitle({ icon, tint, title }: { icon: keyof typeof Ionicons.glyphMap; tint?: string; title: string }) {
  return (
    <View style={styles.headerTitle}>
      <Ionicons name={icon} size={20} color={tint ?? colors.textPrimary} />
      <Text style={styles.headerTitleText}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerTitleText: { color: colors.textPrimary, fontWeight: '700', fontSize: 20 },
});
