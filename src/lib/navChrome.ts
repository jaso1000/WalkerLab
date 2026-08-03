// Shared nav-chrome state - which of the 3 responsive nav tiers is active,
// and (for the middle tier's off-canvas sidebar) whether it's open. Same
// plain-Context pattern as tabBarClearance.ts, provided once by
// AdaptiveNav.tsx and read by anything that needs to know how nav chrome is
// currently laid out (SidebarMenuButton, useColumns()).
//
// Breakpoints match Seerr's (github.com/seerr-team/seerr) own layout -
// confirmed by reading their actual source (Layout/Sidebar/MobileMenu),
// which uses Tailwind's default `sm`/`lg` (640/1024), not this app's older
// 600/900 grid breakpoints:
//   < 640          -> phone floating pill
//   640 - 1024     -> off-canvas slide-out sidebar (toggled via a header button)
//   >= 1024        -> sidebar permanently pinned, part of the layout
import { createContext, useContext } from 'react';

export type NavTier = 'phone' | 'tabletMedium' | 'tabletLarge';

export const PHONE_BREAKPOINT = 640;
export const DESKTOP_BREAKPOINT = 1024;

export function navTierForWidth(width: number): NavTier {
  if (width < PHONE_BREAKPOINT) return 'phone';
  if (width < DESKTOP_BREAKPOINT) return 'tabletMedium';
  return 'tabletLarge';
}

// Sidebar's own fixed width, moved here (rather than defined in
// Sidebar.tsx) so lib-level consumers like useColumns() don't need to
// import a component file - Sidebar.tsx imports it back from here.
export const SIDEBAR_WIDTH = 280;

export interface NavChrome {
  tier: NavTier;
  // Only meaningful at the tabletMedium tier - always false at the other
  // two, which have no off-canvas overlay concept.
  sidebarOpen: boolean;
  openSidebar: () => void;
  closeSidebar: () => void;
}

const defaultNavChrome: NavChrome = {
  tier: 'tabletLarge',
  sidebarOpen: false,
  openSidebar: () => {},
  closeSidebar: () => {},
};

export const NavChromeContext = createContext<NavChrome>(defaultNavChrome);

export function useNavChrome(): NavChrome {
  return useContext(NavChromeContext);
}
