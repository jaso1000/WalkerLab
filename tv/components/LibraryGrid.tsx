// A library as a poster grid (TV Shows, Movies, Music), under a bar styled like the section's tabs with
// the phone's controls: a title search and "Sort" - the phone's Sort By fields for that section, where
// choosing the field already in use flips its direction, as the phone's SortMenu does. The sort is
// remembered per section under the phone's own preference scopes (sonarr / radarr / lidarr).
// A FlatList with a generous window: 150-odd posters is too many to keep mounted on this hardware, and
// the window keeps the row D-pad focus moves into rendered, so the remote never stops at an unmounted
// edge. Lives inside a section's "All" / "Missing" tab (tv/components/ArrSection).
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { alert } from '../../src/lib/alert';
import { getSortPreference, setSortPreference } from '../../src/lib/preferences';
import { colors } from '../../src/theme/colors';
import { Badge, POSTER_W, PosterTile } from './Cards';
import { Chip, ListFrame, SIDE, SNAP_CELL, TV_GRID, TvTextField } from './ui';

export interface LibraryItem {
  key: string;
  title: string;
  poster?: string;
  subtitle?: React.ReactNode;
  badge?: Badge;
  href: string;
  /** This item's value for each of the section's sort fields, keyed by field key. */
  sort: Record<string, string | number>;
}

export interface SortField {
  key: string;
  label: string;
  /** The phone sorts Size largest first by default; everything else ascending. */
  defaultAsc?: boolean;
}

const GAP = 18;
const COLUMNS = 5;

export function PosterGrid<T extends LibraryItem>({ tint, items, sorts, scope }: { tint: string; items: T[]; sorts: SortField[]; scope: string }) {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState(sorts[0]?.key ?? 'title');
  const [asc, setAsc] = useState(true);

  useEffect(() => {
    getSortPreference(scope)
      .then((p) => {
        if (p && sorts.some((s) => s.key === p.sortKey)) {
          setSortKey(p.sortKey);
          setAsc(p.sortAsc);
        }
      })
      .catch(() => {});
  }, [scope, sorts]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? items.filter((i) => i.title.toLowerCase().includes(q)) : [...items];
    return list.sort((a, b) => {
      const av = a.sort[sortKey] ?? '';
      const bv = b.sort[sortKey] ?? '';
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      return asc ? cmp : -cmp;
    });
  }, [items, query, sortKey, asc]);

  const choose = (field: SortField) => {
    const nextAsc = field.key === sortKey ? !asc : (field.defaultAsc ?? true);
    setSortKey(field.key);
    setAsc(nextAsc);
    setSortPreference(scope, { sortKey: field.key, sortAsc: nextAsc }).catch(() => {});
  };

  const current = sorts.find((s) => s.key === sortKey) ?? sorts[0];
  const openSort = () =>
    alert(
      'Sort By',
      'Choosing the current field flips its direction.',
      [
        ...sorts.map((s) => ({ text: s.key === sortKey ? `${s.label}  ${asc ? '↑' : '↓'}` : s.label, onPress: () => choose(s) })),
        { text: 'Cancel', style: 'cancel' as const },
      ]
    );

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.bar}>
        <TvTextField value={query} onChangeText={setQuery} placeholder="Search titles…" style={styles.search} />
        <Chip icon={asc ? 'arrow-up' : 'arrow-down'} label={`Sort: ${current?.label ?? ''}`} tint={tint} onPress={openSort} />
        <Text style={[styles.count, { color: tint }]}>{shown.length}</Text>
      </View>
      <ListFrame>
        <FlatList
          {...TV_GRID}
          key={`${sortKey}-${asc}`}
          data={shown}
          numColumns={COLUMNS}
          keyExtractor={(i) => i.key}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={{ gap: GAP }}
          initialNumToRender={COLUMNS * 4}
          maxToRenderPerBatch={COLUMNS * 2}
          windowSize={7}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<Text style={styles.message}>{query.trim() ? `No titles match "${query.trim()}".` : 'Nothing here.'}</Text>}
          renderItem={({ item, index }) => (
            <View style={styles.cell} {...SNAP_CELL}>
              <PosterTile
                title={item.title}
                poster={item.poster}
                recyclingKey={item.key}
                subtitle={item.subtitle}
                badge={item.badge}
                onPress={() => router.push(item.href as never)}
              />
            </View>
          )}
        />
      </ListFrame>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: SIDE, marginTop: 4 },
  search: { width: 300, borderRadius: 16, paddingVertical: 6, fontSize: 14 },
  count: { fontSize: 15, fontWeight: '700', marginLeft: 6 },
  grid: { paddingHorizontal: SIDE, paddingTop: 10, paddingBottom: 40, gap: 12 },
  cell: { width: POSTER_W, paddingTop: 6 },
  message: { color: colors.textMuted, fontSize: 15, marginTop: 30 },
});
