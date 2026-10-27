// The TV Shows / Movies / Music section screen - the phone's six tabs for each *arr service: All (the
// library as a poster grid with the phone's search and Sort By), Missing, Upcoming (calendar), Activity (the
// service's queue, refreshed every 5 s; OK opens the item's actions), History, and Server (version,
// library totals, disk space and the phone's library-wide actions). Each section passes its own
// loaders (tv/app/shows, movies, music); the layout and behaviour live here once.
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { formatBytes } from '../../src/lib/format';
import { SectionId } from '../../src/lib/sectionNames';
import { colors } from '../../src/theme/colors';
import { listStyles } from './DownloadClientView';
import { LibraryItem, PosterGrid, SortField } from './LibraryGrid';
import { Shell } from './Shell';
import { Thumb } from './TautulliHistory';
import { ListFrame, ListRow, Loading, Message, NotConfigured, ProgressBar, ScreenHeader, SIDE, SmallButton, StatTiles, TV_LIST, useLoad, usePoll } from './ui';

const TABS = ['All', 'Missing', 'Upcoming', 'Activity', 'History', 'Server'] as const;

export interface ArrItem extends LibraryItem {
  missing: boolean;
}

export interface ArrRow {
  key: string;
  title: string;
  subtitle?: string;
  meta?: string;
  metaColor?: string;
  poster?: string;
  progress?: number;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
}

export interface ArrServer {
  version: string;
  stats: { label: string; value: string }[];
  disks: { path: string; label?: string; freeSpace: number; totalSpace: number }[];
  actions: { label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }[];
}

export function ArrSection<T extends ArrItem>({
  section,
  service,
  tint,
  configured,
  loadLibrary,
  sorts,
  sortScope,
  loadUpcoming,
  loadActivity,
  loadHistory,
  loadServer,
}: {
  section: SectionId;
  service: string;
  tint: string;
  /** undefined while the profile is still loading */
  configured: boolean | undefined;
  loadLibrary: () => Promise<T[]>;
  /** The phone's Sort By fields for this section, and the phone's preference scope for them. */
  sorts: SortField[];
  sortScope: string;
  loadUpcoming: () => Promise<ArrRow[]>;
  /** `refresh` reloads the queue after an action taken from a row. */
  loadActivity: (refresh: () => void) => Promise<ArrRow[]>;
  loadHistory: () => Promise<ArrRow[]>;
  loadServer: (library: T[], refresh: () => void) => Promise<ArrServer>;
}) {
  const { names } = useSectionNames();
  const [tab, setTab] = useState(0);
  const library = useLoad(loadLibrary, [loadLibrary], !!configured);

  if (configured === false) {
    return (
      <Shell active={section}>
        <NotConfigured service={service} />
      </Shell>
    );
  }

  const items = library.data ?? [];
  return (
    <Shell active={section}>
      <ScreenHeader title={names[section]} tint={tint} count={library.data?.length} tabs={TABS} active={tab} onTab={setTab} />
      {library.loading ? (
        <Loading tint={tint} />
      ) : library.error && !library.data ? (
        <Message text={library.error} error />
      ) : tab === 0 ? (
        <PosterGrid tint={tint} items={items} sorts={sorts} scope={sortScope} />
      ) : tab === 1 ? (
        <PosterGrid tint={tint} items={items.filter((i) => i.missing)} sorts={sorts} scope={sortScope} />
      ) : tab === 2 ? (
        <Rows load={loadUpcoming} tint={tint} empty="Nothing coming up in the next 60 days." />
      ) : tab === 3 ? (
        <Activity load={loadActivity} tint={tint} />
      ) : tab === 4 ? (
        <Rows load={loadHistory} tint={tint} empty="No history yet." />
      ) : (
        <Server load={(refresh) => loadServer(items, refresh)} tint={tint} service={service} reloadLibrary={library.reload} />
      )}
    </Shell>
  );
}

function RowList({ rows, tint, empty, error }: { rows: ArrRow[]; tint: string; empty: string; error?: string | null }) {
  return (
    <ListFrame>
      <FlatList
        {...TV_LIST}
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={listStyles.list}
        initialNumToRender={12}
        windowSize={7}
        ListEmptyComponent={<Message text={error ?? empty} error={!!error} />}
        renderItem={({ item: r }) => (
          <ListRow
            title={r.title}
            subtitle={r.subtitle}
            meta={r.meta}
            metaColor={r.metaColor}
            tint={tint}
            icon={r.poster ? undefined : r.icon}
            progress={r.progress}
            thumb={r.poster !== undefined ? <Thumb uri={r.poster} /> : undefined}
            onPress={r.onPress}
          />
        )}
      />
    </ListFrame>
  );
}

function Rows({ load, tint, empty }: { load: () => Promise<ArrRow[]>; tint: string; empty: string }) {
  const rows = useLoad(load, [load]);
  if (rows.loading) return <Loading tint={tint} />;
  return <RowList rows={rows.data ?? []} tint={tint} empty={empty} error={rows.error} />;
}

function Activity({ load, tint }: { load: (refresh: () => void) => Promise<ArrRow[]>; tint: string }) {
  // `refresh` is handed to the rows so an action can reload the queue; it is stable through a ref.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const rows = useLoad(() => load(refresh), [load, refresh, tick]);
  usePoll(rows.reload, 5000);
  if (rows.loading) return <Loading tint={tint} />;
  return <RowList rows={rows.data ?? []} tint={tint} empty="Nothing pending." error={rows.error} />;
}

function Server({ load, tint, service, reloadLibrary }: { load: (refresh: () => void) => Promise<ArrServer>; tint: string; service: string; reloadLibrary: () => void }) {
  const server = useLoad(() => load(reloadLibrary), [load, reloadLibrary]);
  if (server.loading) return <Loading tint={tint} />;
  if (server.error && !server.data) return <Message text={server.error} error />;
  const s = server.data!;
  return (
    <ScrollView {...TV_LIST} contentContainerStyle={styles.server}>
      <Text style={styles.version}>
        {service} {s.version ? `v${s.version}` : ''}
      </Text>
      <StatTiles stats={s.stats} tint={tint} />
      <View style={styles.actions}>
        {s.actions.map((a) => (
          <SmallButton key={a.label} icon={a.icon} label={a.label} tint={tint} onPress={a.onPress} />
        ))}
      </View>
      {s.disks.length > 0 ? <Text style={styles.label}>DISK SPACE</Text> : null}
      {s.disks.map((d) => {
        const used = d.totalSpace > 0 ? 1 - d.freeSpace / d.totalSpace : 0;
        return (
          <View key={d.path} style={styles.disk}>
            <View style={styles.diskHead}>
              <Text style={styles.diskPath}>{d.label || d.path}</Text>
              <Text style={styles.diskFree}>
                {formatBytes(d.freeSpace)} free of {formatBytes(d.totalSpace)}
              </Text>
            </View>
            <ProgressBar value={used} tint={used > 0.9 ? colors.danger : tint} height={8} />
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  server: { paddingHorizontal: SIDE, paddingTop: 10, paddingBottom: 40, gap: 14 },
  version: { color: colors.textSecondary, fontSize: 15 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  label: { color: colors.textMuted, fontSize: 12, letterSpacing: 1.4, marginTop: 8 },
  disk: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, gap: 10 },
  diskHead: { flexDirection: 'row', justifyContent: 'space-between' },
  diskPath: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  diskFree: { color: colors.textSecondary, fontSize: 13 },
});
