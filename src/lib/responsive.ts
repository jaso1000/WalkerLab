import { useWindowDimensions } from 'react-native';

// Discover's grids (numColumns on a plain FlatList) already scale well across
// screen sizes - these list screens use SectionList/FlatList with rich,
// full-width row cards instead, which don't have a numColumns equivalent.
// Chunking each section's/list's data into rows of N items (see `chunk`
// below) gets the same multi-column benefit on wide/unfolded screens while
// keeping the existing card design, rather than switching to a sparser
// poster-only tile.
// Hook: returns how many columns a responsive list should render as, based
// on the current window width. Breakpoints (900/600px) are the thing to
// tune if a future device reports the layout feeling off.
export function useColumns(): number {
  const { width } = useWindowDimensions();
  if (width >= 900) return 3;
  if (width >= 600) return 2;
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
