// Re-tapping the nav button of the section you're already in (FloatingPill/
// Sidebar/CompactSidebar) returns that section to its home state - e.g.
// clearing an active search on Discover - the way a mobile tab bar's re-tap
// does. Search lives in each screen's own local state, which the nav
// components can't reach, so they broadcast here and each section screen
// opts in via `useSectionReset`.
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { isSectionActive } from './activeSection';

type Listener = (href: string) => void;

const listeners = new Set<Listener>();

export function useSectionReset(href: string, onReset: () => void) {
  const onResetRef = useRef(onReset);
  useEffect(() => {
    onResetRef.current = onReset;
  });
  useEffect(() => {
    const listener: Listener = (target) => {
      if (target === href) onResetRef.current();
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [href]);
}

export function navigateToSection(pathname: string, href: string, activePrefixes?: string[]) {
  if (isSectionActive(pathname, href, activePrefixes)) listeners.forEach((listener) => listener(href));
  router.navigate(href as never);
}
