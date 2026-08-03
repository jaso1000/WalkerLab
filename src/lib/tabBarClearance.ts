// Bottom padding a scrollable needs so its last row clears the floating
// bottom tab bar.
//
// In Tabs mode the bar is `position: 'absolute'` (see
// `app/(drawer)/_layout.tsx`), so it deliberately doesn't reserve layout
// space - that's what lets content run edge to edge and stay visible in the
// margins around the pill. The cost is that content would otherwise scroll
// underneath it, leaving the last list row half-hidden at the bottom of a
// list. React Navigation's own docs point at exactly this: an absolutely
// positioned tab bar means "you'd also need to use `useBottomTabBarHeight()`
// to add a bottom padding to your content".
//
// `useBottomTabBarHeight()` itself is unusable here because it *throws*
// outside a Bottom Tab Navigator, and every one of these screens is also
// rendered under the Drawer when that navigation style is chosen. Reading
// the underlying context directly gives `undefined` there instead, which
// maps cleanly to "no floating bar, no clearance needed" - so Drawer mode
// gets zero extra dead space at the end of its lists.
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useContext } from 'react';

// Breathing room below the last row, on top of the bar's own measured
// height. Also absorbs the bar's 16px bottom offset in case the measured
// height doesn't already account for it.
const FLOATING_BAR_GAP = 24;

export function useTabBarClearance(): number {
  const height = useContext(BottomTabBarHeightContext);
  return height === undefined ? 0 : height + FLOATING_BAR_GAP;
}
