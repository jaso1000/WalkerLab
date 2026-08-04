import { useWindowDimensions } from 'react-native';
import { useNavChrome } from './navChrome';

// Actual available content width - full window width, minus whichever nav
// rail is currently pinned and reserving real layout space (NavChrome's own
// `sidebarWidth` - see navChrome.ts for exactly what that resolves to per
// tier, including the tabletMedium tier's own compact-vs-expanded toggle).
// Phone width's FloatingPill is absolutely positioned and reserves nothing,
// so sidebarWidth is 0 there and content width equals the full window.
//
// Every screen with a swipeable tab pager (movies.tsx, index.tsx,
// downloads.tsx, torrents.tsx, overseerr.tsx, tautulli.tsx, containers.tsx,
// discover.tsx) MUST size its pages off this, not raw `useWindowDimensions()`
// width - the pager is a horizontal ScrollView, so a page sized to the full
// window width (wider than the actual visible content area next to a pinned
// sidebar) doesn't get clipped, it becomes a real scrollable overflow: the
// grid inside renders correctly proportioned for that oversized page, but
// the page itself needs a horizontal scroll to see all of it. Confirmed
// live as the actual bug behind "3-column grid needs scrolling to see the
// third column" - `useColumns()`'s own content-width reduction was already
// correct, but callers using raw window width for the page container itself
// were still wrong regardless of how many columns were chosen to fill it.
export function useContentWidth(): number {
  const { width } = useWindowDimensions();
  const { sidebarWidth } = useNavChrome();
  return width - sidebarWidth;
}

// Discover's grids (numColumns on a plain FlatList) already scale well across
// screen sizes - these list screens use SectionList/FlatList with rich,
// full-width row cards instead, which don't have a numColumns equivalent.
// Chunking each section's/list's data into rows of N items (see `chunk`
// below) gets the same multi-column benefit on wide/unfolded screens while
// keeping the existing card design, rather than switching to a sparser
// poster-only tile.
// Hook: returns how many columns a responsive list should render as, based
// on actual available content width rather than raw window width.
// Breakpoints (900/600px) are the thing to tune if a future device reports
// the layout feeling off.
export function useColumns(): number {
  const contentWidth = useContentWidth();
  if (contentWidth >= 900) return 3;
  if (contentWidth >= 600) return 2;
  return 1;
}

// Splits a flat array into an array of arrays of at most `size` items each -
// used to turn a single-column data source into rows of N cards for a
// SectionList/FlatList to render side by side. `size <= 1` is a no-op
// (each item stays in its own row).
export function chunk<T>(items: T[], size: number): T[][] {
  if (size <= 1) return items.map((item) => [item]);
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}
