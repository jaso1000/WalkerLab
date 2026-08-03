// Hamburger button dropped into each of the 9 top-level screens' native
// headers (via headerLeft) - only actually opens anything at the
// tabletMedium nav tier (640-1024px, see src/lib/navChrome.ts), where the
// sidebar is an off-canvas overlay that needs a way to open it. Invisible at
// phone width (the floating pill is the nav there) and at tabletLarge width
// (the sidebar is already permanently pinned/visible - nothing to toggle),
// but still renders a small same-edge-inset spacer even then, rather than
// `null` - returning `null` collapsed the header's headerLeft slot to zero
// width, which pushed the title flush against the screen edge. Pairs with
// `headerTitleAlign: 'left'` on every caller's Stack.Screen options: without
// that, the header centers the title by balancing headerLeft/headerRight
// widths, so a wider headerLeft (the real button, shown only at
// tabletMedium) would visibly shift the title rightward instead of just
// changing its own left inset - 'left' alignment ties the title's position
// to headerLeft's actual width directly, so it stays put regardless of
// which of these two renders.
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useNavChrome } from '../lib/navChrome';
import { colors } from '../theme/colors';

// Matches the app's general screen-edge inset (e.g. the search bar's own
// paddingHorizontal) - just enough space that the title doesn't sit flush
// against the edge when the hamburger itself isn't showing.
const INACTIVE_INSET = 16;

export function SidebarMenuButton() {
  const { tier, openSidebar } = useNavChrome();
  if (tier !== 'tabletMedium') return <View style={styles.spacer} />;
  return (
    <TouchableOpacity style={styles.button} onPress={openSidebar} hitSlop={{ top: 8, bottom: 8, left: 8, right: 12 }}>
      <Ionicons name="menu" size={24} color={colors.textPrimary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  spacer: { width: INACTIVE_INSET },
  button: { paddingHorizontal: 12, paddingVertical: 4 },
});
