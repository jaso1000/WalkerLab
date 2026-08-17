// Floating pill bottom bar shown at phone width (< TABLET_BREAKPOINT, see
// AdaptiveNav.tsx) - tablet width gets the persistent Sidebar instead.
//
// A plain component, NOT a real tab navigator - each button is a normal
// `router.navigate()`, so it renders identically regardless of whether the
// current screen is one of the primary sections or some arbitrary detail
// page underneath it (movie/series detail, settings sub-pages, etc.) - see
// PLAN.md for the full history of why this replaced an earlier
// `<Tabs>`-based version: React Navigation's own tab router doesn't
// reliably push a browser history entry on tab press (expo/expo#38594),
// and being a real navigator meant it could only ever render around the 9
// screens registered inside it, never any of the app's other screens.
//
// `navigate`, not `push`: these primary sections are flat siblings under
// the same root Stack (app/_layout.tsx), so `push` was adding a brand new
// stack entry - and keeping every previously-visited section fully mounted
// in memory - on every single tap, growing unboundedly the longer the app
// stayed open. `navigate` shares the exact same underlying plumbing
// (expo-router's `linkTo`, confirmed by reading its source - both `push`
// and `navigate` route through it with only the action `type` differing),
// so it doesn't regress the web-history fix above; the difference is that
// React Navigation's `NAVIGATE` action jumps to an existing instance of a
// route already in the stack instead of always pushing a duplicate.
// Reported by a tester as native-only navigation feeling sluggish
// (unfelt on web, where there's no comparable persistent native stack).
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { router, usePathname } from 'expo-router';
import { RefObject } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isSectionActive } from '../lib/activeSection';
import { SECTION_META } from '../lib/sectionMeta';
import { StartupSectionId } from '../lib/startupScreen';
import { colors } from '../theme/colors';

export const FLOATING_PILL_HEIGHT = 64;
export const FLOATING_PILL_BOTTOM = 16;
const FLOATING_PILL_SIDE = 16;

export function FloatingPill({
  primaryIds,
  onMorePress,
  blurTargetRef,
}: {
  primaryIds: StartupSectionId[];
  onMorePress: () => void;
  // Only actually consumed on Android (BlurView's `blurTarget` prop) - real
  // blur there requires an explicit ref to the content sitting behind it
  // (see AdaptiveNav.tsx's BlurTargetView, the only thing this ref ever
  // points at). iOS/web blur whatever's compositing behind the view
  // directly and just ignore this prop.
  blurTargetRef: RefObject<View | null>;
}) {
  const pathname = usePathname();
  // Sit above the system navigation bar rather than under it. This is only
  // ~0 on gesture navigation (where the gesture handle is drawn over content
  // anyway), but is a full ~48dp on 3-button navigation - without it the
  // pill renders underneath the Back/Home/Recents bar and its buttons become
  // unreachable. Reported by a tester on button navigation; see
  // AdaptiveNav.tsx, which adds the same inset to the scroll clearance so
  // list content still clears the pill's new resting position.
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.pill, { bottom: insets.bottom + FLOATING_PILL_BOTTOM }]} pointerEvents="box-none">
      <BlurView
        blurTarget={blurTargetRef}
        blurMethod="dimezisBlurView"
        intensity={60}
        tint="dark"
        style={styles.inner}
      >
        {/* BlurView's own `tint` is a generic light/dark enum, not our exact
            brand color - this overlay guarantees the same rgba look on top
            of the blur (or as a plain translucent fallback if real blur
            isn't available) across every platform. */}
        <View style={styles.tintOverlay} pointerEvents="none" />
        {primaryIds.map((id) => {
          const meta = SECTION_META[id];
          const active = isSectionActive(pathname, meta.href, meta.activePrefixes);
          return (
            <TouchableOpacity key={id} style={styles.item} onPress={() => router.navigate(meta.href as never)}>
              <Ionicons name={meta.icon} size={24} color={active ? meta.tint : colors.textSecondary} />
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={styles.item} onPress={onMorePress}>
          <Ionicons name="ellipsis-horizontal" size={24} color={colors.textSecondary} />
        </TouchableOpacity>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  // Outer wrapper is `position: 'absolute'` and deliberately doesn't reserve
  // its own layout space, which is what lets content run edge to edge and
  // stay visible in the margins around the pill - `pointerEvents: 'box-none'`
  // so the transparent margin area doesn't swallow touches meant for
  // whatever's rendered underneath it. Shadow lives here (not on `inner`)
  // since `inner` needs `overflow: 'hidden'` to clip the blur to its own
  // rounded corners, which would otherwise clip the shadow too.
  // `bottom` is applied inline (not here) since it depends on the runtime
  // safe-area inset - see the component body.
  pill: {
    position: 'absolute',
    left: FLOATING_PILL_SIDE,
    right: FLOATING_PILL_SIDE,
    height: FLOATING_PILL_HEIGHT,
    borderRadius: FLOATING_PILL_HEIGHT / 2,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  inner: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: FLOATING_PILL_HEIGHT / 2,
    overflow: 'hidden',
  },
  tintOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.surfaceGlass,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
