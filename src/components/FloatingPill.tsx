// Floating pill bottom bar shown at phone width (< TABLET_BREAKPOINT, see
// AdaptiveNav.tsx) - tablet width gets the persistent Sidebar instead.
//
// A plain component, NOT a real tab navigator - each button is a normal
// `router.push()`, so it renders identically regardless of whether the
// current screen is one of the primary sections or some arbitrary detail
// page underneath it (movie/series detail, settings sub-pages, etc.) - see
// PLAN.md for the full history of why this replaced an earlier
// `<Tabs>`-based version: React Navigation's own tab router doesn't
// reliably push a browser history entry on tab press (expo/expo#38594),
// and being a real navigator meant it could only ever render around the 9
// screens registered inside it, never any of the app's other screens.
import { Ionicons } from '@expo/vector-icons';
import { router, usePathname } from 'expo-router';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import { isSectionActive } from '../lib/activeSection';
import { SECTION_META } from '../lib/sectionMeta';
import { StartupSectionId } from '../lib/startupScreen';
import { colors } from '../theme/colors';

export const FLOATING_PILL_HEIGHT = 64;
export const FLOATING_PILL_BOTTOM = 16;
const FLOATING_PILL_SIDE = 16;

// backdropFilter isn't a typed React Native style property (native platforms
// have no concept of it) - only merged into `inner`'s style on web, below.
const webBlurStyle: any = { backdropFilter: 'blur(20px)' };

export function FloatingPill({ primaryIds, onMorePress }: { primaryIds: StartupSectionId[]; onMorePress: () => void }) {
  const pathname = usePathname();
  return (
    <View style={styles.pill} pointerEvents="box-none">
      <View style={[styles.inner, Platform.OS === 'web' && webBlurStyle]}>
        {primaryIds.map((id) => {
          const meta = SECTION_META[id];
          const active = isSectionActive(pathname, meta.href);
          return (
            <TouchableOpacity key={id} style={styles.item} onPress={() => router.push(meta.href as never)}>
              <Ionicons name={meta.icon} size={24} color={active ? meta.tint : colors.textSecondary} />
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={styles.item} onPress={onMorePress}>
          <Ionicons name="ellipsis-horizontal" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Outer wrapper is `position: 'absolute'` and deliberately doesn't reserve
  // its own layout space, which is what lets content run edge to edge and
  // stay visible in the margins around the pill - `pointerEvents: 'box-none'`
  // so the transparent margin area doesn't swallow touches meant for
  // whatever's rendered underneath it.
  pill: {
    position: 'absolute',
    left: FLOATING_PILL_SIDE,
    right: FLOATING_PILL_SIDE,
    bottom: FLOATING_PILL_BOTTOM,
    height: FLOATING_PILL_HEIGHT,
  },
  inner: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.surfaceGlass,
    borderRadius: FLOATING_PILL_HEIGHT / 2,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
