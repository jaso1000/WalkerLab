// Bottom padding a scrollable needs so its last row clears the floating
// pill bar - 0 when the pill isn't showing at all (tablet-width screens get
// the persistent side panel instead, which doesn't overlay content the same
// way, so no clearance is needed there).
//
// The pill is `position: 'absolute'` (see `src/components/AdaptiveNav.tsx`),
// so it deliberately doesn't reserve layout space - that's what lets content
// run edge to edge and stay visible in the margins around it. The cost is
// that content would otherwise scroll underneath it, leaving the last list
// row half-hidden at the bottom of a list.
//
// This used to read React Navigation's own `BottomTabBarHeightContext` from
// a real `<Tabs>` navigator. There is no navigator anymore - `AdaptiveNav` is
// a plain always-mounted component, not a real tab router (see its own
// comments for why) - so this is now a plain Context we own outright,
// provided once from the root layout alongside `AdaptiveNav` itself.
import { createContext, useContext } from 'react';

// Breathing room below the last row, on top of the bar's own measured
// height. Also absorbs the bar's 16px bottom offset in case the measured
// height doesn't already account for it.
export const FLOATING_BAR_GAP = 24;

export const TabBarClearanceContext = createContext(0);

export function useTabBarClearance(): number {
  return useContext(TabBarClearanceContext);
}
