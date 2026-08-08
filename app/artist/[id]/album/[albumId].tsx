import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lidarrApi, LidarrTrack, LidarrTrackFile } from '../../../../src/api/lidarr';
import { FileDetailsCard } from '../../../../src/components/FileDetailsCard';
import { useServers } from '../../../../src/context/ServersContext';
import { alert } from '../../../../src/lib/alert';
import { formatBytes } from '../../../../src/lib/format';
import { useTabBarClearance } from '../../../../src/lib/tabBarClearance';
import { colors } from '../../../../src/theme/colors';

// Album track drill-down: lists one album's tracks with per-row tap-to-
// expand (downloaded tracks show file details + delete) plus multi-select
// long-press for bulk delete. Mirrors `series/[id]/season/[season].tsx`,
// but genuinely simpler in two ways verified against Lidarr's real API:
// - Both `/track` and `/trackfile` support server-side `albumId` filtering,
//   so there's no client-side filter workaround needed (Sonarr's episode
//   endpoint has no season filter).
// - Lidarr's TrackResource has no `monitored` field at all - monitoring
//   only exists at the Album/Artist level, not per-track - and there's no
//   per-track search command (only ArtistSearch/AlbumSearch). So there's no
//   per-row bookmark toggle or per-row Auto/Manual search button here; a
//   single "Search this album" action in the top bar covers it instead.
const BULK_BAR_CLEARANCE = 92;

export default function AlbumTracksScreen() {
  const tabBarClearance = useTabBarClearance();
  const { id, albumId, artistName } = useLocalSearchParams<{ id: string; albumId: string; artistName?: string }>();
  const artistId = Number(id);
  const albumIdNum = Number(albumId);
  const { servers } = useServers();
  const config = servers.lidarr;

  const [tracks, setTracks] = useState<LidarrTrack[]>([]);
  const [files, setFiles] = useState<Record<number, LidarrTrackFile>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    try {
      const [trackList, fileList] = await Promise.all([
        lidarrApi.getTracks(config, albumIdNum),
        lidarrApi.getTrackFiles(config, albumIdNum),
      ]);
      setTracks(trackList);
      setFiles(Object.fromEntries(fileList.map((f) => [f.id, f])));
    } catch (e) {
      alert('Failed to load tracks', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, albumIdNum]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Sorted by absolute track number, then client-side filtered by the
  // search box (matches title text or a plain track-number substring).
  const visible = useMemo(() => {
    const sorted = [...tracks].sort((a, b) => a.absoluteTrackNumber - b.absoluteTrackNumber);
    if (!query.trim()) return sorted;
    const q = query.toLowerCase();
    return sorted.filter((t) => t.title.toLowerCase().includes(q) || String(t.absoluteTrackNumber).includes(q));
  }, [tracks, query]);

  const toggleSelected = (trackId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const selectAll = () => {
    setSelected((prev) => (prev.size === visible.length ? new Set() : new Set(visible.map((t) => t.id))));
  };

  // The only search granularity Lidarr actually supports is the whole
  // album - used by both the top bar's search button and the bulk-select
  // bar's search button (selection just determines what gets deleted, not
  // what gets searched).
  const searchAlbum = async () => {
    if (!config) return;
    setBusy(true);
    try {
      await lidarrApi.searchAlbumRelease(config, albumIdNum);
      alert('Search started', 'Searching for this album.');
      setSelected(new Set());
    } catch (e) {
      alert('Search failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  // Bulk-deletes downloaded files for the given tracks (used by both a
  // single expanded track's delete button and the bulk-select bar's trash
  // button) - silently ignores any selected tracks with no file.
  const deleteFilesBulk = (trks: LidarrTrack[]) => {
    const fileIds = trks.filter((t) => t.hasFile).map((t) => t.trackFileId);
    if (fileIds.length === 0) {
      alert('No files', 'None of the selected tracks have downloaded files.');
      return;
    }
    alert('Delete Files', `Delete ${fileIds.length} track file(s)? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!config) return;
          setBusy(true);
          try {
            await lidarrApi.deleteTrackFilesBulk(config, fileIds);
            await load();
            setSelected(new Set());
          } catch (e) {
            alert('Delete failed', e instanceof Error ? e.message : 'Unknown error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  // Tapping a row toggles its inline expansion (missing and downloaded
  // tracks both expand the same way); only one track can be expanded at a
  // time.
  const rowPress = (track: LidarrTrack) => {
    setExpandedId((prev) => (prev === track.id ? null : track.id));
  };

  const selectedTracks = tracks.filter((t) => selected.has(t.id));

  if (!config) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyText}>Lidarr isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {artistName ?? 'Artist'}
        </Text>
        <TouchableOpacity style={styles.iconButton} onPress={load}>
          <Ionicons name="refresh" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.headerRow}>
        <Text style={styles.albumTitle}>Tracks</Text>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={searchAlbum} disabled={busy} style={styles.headerActionButton}>
            <Ionicons name="search" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSearchOpen((v) => !v)} style={styles.headerActionButton}>
            <Ionicons name="filter" size={20} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>
      <TouchableOpacity onPress={selectAll}>
        <Text style={styles.selectAllHint}>Tap to select all</Text>
      </TouchableOpacity>

      {searchOpen ? (
        <TextInput
          style={styles.searchInput}
          placeholder="Filter tracks"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoFocus
        />
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.lidarr} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: tabBarClearance + (selected.size > 0 ? BULK_BAR_CLEARANCE : 0) },
          ]}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.id);
            const file = item.hasFile ? files[item.trackFileId] : undefined;
            const isExpanded = expandedId === item.id;
            return (
              <View>
                <Pressable style={styles.row} onPress={() => rowPress(item)} onLongPress={() => toggleSelected(item.id)}>
                  <TouchableOpacity style={styles.checkbox} onPress={() => toggleSelected(item.id)}>
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={isSelected ? colors.lidarr : colors.textSecondary}
                    />
                  </TouchableOpacity>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle}>
                      {item.absoluteTrackNumber}. {item.title}
                    </Text>
                    {item.hasFile ? (
                      <Text style={styles.rowStatusOk}>{file ? `${file.quality.quality.name} - ${formatBytes(file.size)}` : 'Downloaded'}</Text>
                    ) : (
                      <Text style={styles.rowStatusMissing}>Missing</Text>
                    )}
                  </View>
                </Pressable>

                {isExpanded && file ? (
                  <FileDetailsCard
                    fileName={`${artistName ?? 'Artist'} - ${item.absoluteTrackNumber}. ${item.title}`}
                    size={file.size}
                    qualityName={file.quality.quality.name}
                    dateAdded={file.dateAdded}
                    mediaInfo={file.mediaInfo}
                    expanded
                    onToggleExpand={() => setExpandedId(null)}
                    onDelete={() => deleteFilesBulk([item])}
                    deleting={busy}
                    tint={colors.lidarr}
                    badgeTone="lidarr"
                  />
                ) : null}
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.emptyText}>No tracks found.</Text>}
        />
      )}

      {selected.size > 0 ? (
        <View style={[styles.bulkBar, { bottom: 16 + tabBarClearance }]}>
          <TouchableOpacity style={styles.bulkButton} disabled={busy} onPress={searchAlbum}>
            <Ionicons name="search" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.bulkButton, styles.bulkButtonDanger]}
            disabled={busy}
            onPress={() => deleteFilesBulk(selectedTracks)}
          >
            <Ionicons name="trash" size={18} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.bulkCount}>{selected.size} selected</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 24 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 8 },
  iconButton: { padding: 8 },
  topBarTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 17, flex: 1, textAlign: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 8 },
  headerActions: { flexDirection: 'row', gap: 4 },
  headerActionButton: { padding: 4 },
  albumTitle: { color: colors.textPrimary, fontSize: 26, fontWeight: '800' },
  selectAllHint: { color: colors.textSecondary, paddingHorizontal: 16, marginTop: 6, marginBottom: 10 },
  searchInput: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 10,
    color: colors.textPrimary,
    fontSize: 16,
  },
  list: { paddingBottom: 100 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  checkbox: { padding: 2 },
  rowInfo: { flex: 1 },
  rowTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700' },
  rowStatusOk: { color: colors.success, fontSize: 13, fontWeight: '600', marginTop: 2 },
  rowStatusMissing: { color: colors.danger, fontSize: 13, fontWeight: '600', marginTop: 2 },
  bulkBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 16,
    backgroundColor: colors.surface,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
  },
  bulkButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulkButtonDanger: { backgroundColor: colors.danger },
  bulkCount: { color: colors.textSecondary, marginLeft: 'auto', fontSize: 13, fontWeight: '600' },
});
