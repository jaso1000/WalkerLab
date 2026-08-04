// Shared nav-chrome state - which of the 3 responsive nav tiers is active,
// and how much layout width the currently-pinned sidebar actually reserves
// (varies at the tabletMedium tier - see `sidebarWidth` below). Same plain-
// Context pattern as tabBarClearance.ts, provided once by AdaptiveNav.tsx
// and read by anything that needs to know how nav chrome is currently laid
// out (CompactSidebar, Sidebar, useColumns()/useContentWidth()).
//
// Breakpoints match Seerr's (github.com/seerr-team/seerr) own layout -
// confirmed by reading their actual source (Layout/Sidebar/MobileMenu),
// which uses Tailwind's default `sm`/`lg` (640/1024), not this app's older
// 600/900 grid breakpoints - though the tabletMedium tier's own nav treatment
// deliberately diverges from Seerr's (their off-canvas toggle) per the
// user's own request for something persistent instead, see CompactSidebar.tsx:
//   < 640          -> phone floating pill
//   640 - 1024     -> persistent sidebar, icon-only by default with an
//                     expand toggle to the full labeled one (CompactSidebar.tsx/Sidebar.tsx)
//   >= 1024        -> full labeled sidebar, permanently pinned, no toggle
import { createContext, useContext } from 'react';

export type NavTier = 'phone' | 'tabletMedium' | 'tabletLarge';

export const PHONE_BREAKPOINT = 640;
export const DESKTOP_BREAKPOINT = 1024;

export function navTierForWidth(width: number): NavTier {
  if (width < PHONE_BREAKPOINT) return 'phone';
  if (width < DESKTOP_BREAKPOINT) return 'tabletMedium';
  return 'tabletLarge';
}

// Full labeled Sidebar's fixed width (tabletLarge, and tabletMedium when the
// user's expanded it), moved here (rather than defined in Sidebar.tsx) so
// lib-level consumers like useColumns() don't need to import a component
// file - Sidebar.tsx imports it back from here.
export const SIDEBAR_WIDTH = 280;

// Icon-only CompactSidebar's fixed width (tabletMedium's default) - same
// reasoning.
export const COMPACT_SIDEBAR_WIDTH = 72;

export interface NavChrome {
  tier: NavTier;
  // The pinned/compact sidebar's actual current reserved width - 0 at phone
  // width (FloatingPill is absolutely positioned, reserves nothing),
  // SIDEBAR_WIDTH at tabletLarge, and at tabletMedium either
  // COMPACT_SIDEBAR_WIDTH or SIDEBAR_WIDTH depending on whether the user's
  // expanded it (see AdaptiveNav.tsx's `sidebarExpanded` state). Consumers
  // that need to know how much content width is left over (useColumns() et
  // al, via useContentWidth()) should read this rather than re-deriving it
  // from `tier` alone, since tabletMedium alone doesn't say which width is
  // actually in effect right now.
  sidebarWidth: number;
}

const defaultNavChrome: NavChrome = {
  tier: 'tabletLarge',
  sidebarWidth: SIDEBAR_WIDTH,
};

export const NavChromeContext = createContext<NavChrome>(defaultNavChrome);

export function useNavChrome(): NavChrome {
  return useContext(NavChromeContext);
}
