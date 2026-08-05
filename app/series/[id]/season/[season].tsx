import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sonarrApi, SonarrEpisode, SonarrEpisodeFile } from '../../../../src/api/sonarr';
import { FileDetailsCard } from '../../../../src/components/FileDetailsCard';
import { useServers } from '../../../../src/context/ServersContext';
import { alert } from '../../../../src/lib/alert';
import { formatBytes, formatDate } from '../../../../src/lib/format';
import { useTabBarClearance } from '../../../../src/lib/tabBarClearance';
import { colors } from '../../../../src/theme/colors';

// Season episode drill-down: lists one season's episodes with per-row tap-
// to-expand (missing and downloaded episodes both expand inline the same
// way, showing file details + auto/manual search actions) plus multi-select
// long-press for bulk monitor/search/delete across several episodes at once.
export default function SeasonEpisodesScreen() {
  const tabBarClearance = useTabBarClearance();
  const { id, season, seriesTitle } = useLocalSearchParams<{ id: string; season: string; seriesTitle?: string }>();
  const seriesId = Number(id);
  const seasonNumber = Number(season);
  const { servers } = useServers();
  const config = servers.sonarr;

  const [episodes, setEpisodes] = useState<SonarrEpisode[]>([]);
  const [files, setFiles] = useState<Record<number, SonarrEpisodeFile>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  // Sonarr has no "episodes for one season" endpoint, so this fetches the
  // whole series' episode list and filters client-side, then fetches full
  // file details (tech specs) only for the episodes that actually have one.
  const load = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    try {
      const all = await sonarrApi.getEpisodes(config, seriesId);
      const seasonEpisodes = all.filter((e) => e.seasonNumber === seasonNumber);
      setEpisodes(seasonEpisodes);
      const withFiles = seasonEpisodes.filter((e) => e.hasFile);
      const fileEntries = await Promise.all(
        withFiles.map(async (e) => [e.episodeFileId, await sonarrApi.getEpisodeFile(config, e.episodeFileId)] as const)
      );
      setFiles(Object.fromEntries(fileEntries));
    } catch (e) {
      alert('Failed to load episodes', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, seriesId, seasonNumber]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Sorted by episode number, then client-side filtered by the search box
  // (matches title text or a plain episode-number substring).
  const visible = useMemo(() => {
    const sorted = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
    if (!query.trim()) return sorted;
    const q = query.toLowerCase();
    return sorted.filter((e) => e.title.toLowerCase().includes(q) || String(e.episodeNumber).includes(q));
  }, [episodes, query]);

  // Toggles one episode's presence in the multi-select set (triggered by
  // long-press or tapping its checkbox).
  const toggleSelected = (episodeId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(episodeId)) next.delete(episodeId);
      else next.add(episodeId);
      return next;
    });
  };

  // Selects every currently-visible (post-search-filter) episode, or clears
  // the selection entirely if everything visible is already selected.
  const selectAll = () => {
    setSelected((prev) => (prev.size === visible.length ? new Set() : new Set(visible.map((e) => e.id))));
  };

  // Triggers an automatic-grab search for one or more episodes (used by
  // both the per-episode expanded "Auto" button and the bulk-select bar).
  const searchEpisodes = async (episodeIds: number[], label: string) => {
    if (!config) return;
    setBusy(true);
    try {
      await sonarrApi.searchEpisodeRelease(config, episodeIds);
      alert('Search started', `Searching for ${label}.`);
      setSelected(new Set());
    } catch (e) {
      alert('Search failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  // Bulk monitor/unmonitor toggle for the bulk-select bar's two bookmark
  // buttons.
  const setMonitoredBulk = async (episodeIds: number[], monitored: boolean) => {
    if (!config) return;
    setBusy(true);
    try {
      await sonarrApi.updateEpisodesMonitored(config, episodeIds, monitored);
      await load();
      setSelected(new Set());
    } catch (e) {
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  // Bulk-deletes downloaded files for the given episodes (used by both a
  // single expanded episode's delete button and the bulk-select bar's
  // trash button) - silently ignores any selected episodes with no file.
  const deleteFilesBulk = (eps: SonarrEpisode[]) => {
    const fileIds = eps.filter((e) => e.hasFile).map((e) => e.episodeFileId);
    if (fileIds.length === 0) {
      alert('No files', 'None of the selected episodes have downloaded files.');
      return;
    }
    alert('Delete Files', `Delete ${fileIds.length} episode file(s)? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!config) return;
          setBusy(true);
          try {
            await sonarrApi.deleteEpisodeFilesBulk(config, fileIds);
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
  // episodes both expand the same way); only one episode can be expanded
  // at a time.
  const rowPress = (episode: SonarrEpisode) => {
    setExpandedId((prev) => (prev === episode.id ? null : episode.id));
  };

  const selectedEpisodes = episodes.filter((e) => selected.has(e.id));

  if (!config) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyText}>Sonarr isn&apos;t connected.</Text>
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
          {seriesTitle ?? 'Series'}
        </Text>
        <TouchableOpacity style={styles.iconButton} onPress={load}>
          <Ionicons name="refresh" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.headerRow}>
        <Text style={styles.seasonTitle}>{seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`}</Text>
        <TouchableOpacity onPress={() => setSearchOpen((v) => !v)}>
          <Ionicons name="search" size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={selectAll}>
        <Text style={styles.selectAllHint}>Tap to select all</Text>
      </TouchableOpacity>

      {searchOpen ? (
        <TextInput
          style={styles.searchInput}
          placeholder="Search episodes"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
          autoFocus
        />
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.sonarr} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarClearance }]}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.id);
            const airDate = formatDate(item.airDateUtc);
            const isUnaired = item.airDateUtc ? new Date(item.airDateUtc) > new Date() : false;
            const file = item.hasFile ? files[item.episodeFileId] : undefined;
            const isExpanded = expandedId === item.id;
            return (
              <View>
                <Pressable style={styles.row} onPress={() => rowPress(item)} onLongPress={() => toggleSelected(item.id)}>
                  <TouchableOpacity style={styles.checkbox} onPress={() => toggleSelected(item.id)}>
                    <Ionicons
                      name={isSelected ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={isSelected ? colors.sonarr : colors.textSecondary}
                    />
                  </TouchableOpacity>
                  <View style={styles.rowInfo}>
                    <Text style={styles.rowTitle}>
                      E{item.episodeNumber} · {item.title}
                    </Text>
                    {isUnaired ? (
                      <Text style={styles.rowStatusUnaired}>Unaired</Text>
                    ) : item.hasFile ? (
                      <Text style={styles.rowStatusOk}>
                        {file ? `${file.quality.quality.name} - ${formatBytes(file.size)}` : 'Downloaded'}
                      </Text>
                    ) : (
                      <Text style={styles.rowStatusMissing}>Missing</Text>
                    )}
                  </View>
                  {airDate ? <Text style={styles.rowDate}>{airDate}</Text> : null}
                </Pressable>

                {isExpanded ? (
                  <>
                    <View style={[styles.expandActionRow, !file && styles.expandActionRowNoFile]}>
                      <TouchableOpacity
                        style={styles.expandAction}
                        onPress={() => setMonitoredBulk([item.id], !item.monitored)}
                      >
                        <Ionicons name={item.monitored ? 'bookmark' : 'bookmark-outline'} size={16} color={colors.sonarr} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.expandAction, styles.expandActionWide]}
                        onPress={() => searchEpisodes([item.id], `E${item.episodeNumber} · ${item.title}`)}
                        disabled={busy}
                      >
                        <Ionicons name="search" size={14} color={colors.textPrimary} />
                        <Text style={styles.expandActionText}>Auto</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.expandAction, styles.expandActionWide]}
                        onPress={() => {
                          const episodeLabel = `S${seasonNumber}E${item.episodeNumber} · ${item.title}`;
                          const searchTitle = seriesTitle ? `${seriesTitle} · ${episodeLabel}` : episodeLabel;
                          router.push(
                            `/series/${seriesId}/releases?episodeId=${item.id}&seasonNumber=${seasonNumber}&title=${encodeURIComponent(
                              searchTitle
                            )}`
                          );
                        }}
                      >
                        <Ionicons name="document-text-outline" size={14} color={colors.textPrimary} />
                        <Text style={styles.expandActionText}>Manual</Text>
                      </TouchableOpacity>
                    </View>
                    {file ? (
                      <FileDetailsCard
                        fileName={`${seriesTitle ?? 'Series'} - S${String(seasonNumber).padStart(2, '0')}E${String(
                          item.episodeNumber
                        ).padStart(2, '0')} - ${item.title}`}
                        size={file.size}
                        qualityName={file.quality.quality.name}
                        dateAdded={file.dateAdded}
                        mediaInfo={file.mediaInfo}
                        expanded
                        onToggleExpand={() => setExpandedId(null)}
                        onDelete={() => deleteFilesBulk([item])}
                        deleting={busy}
                        tint={colors.sonarr}
                        badgeTone="sonarr"
                      />
                    ) : null}
                  </>
                ) : null}
              </View>
            );
          }}
          ListEmptyComponent={<Text style={styles.emptyText}>No episodes found.</Text>}
        />
      )}

      {selected.size > 0 ? (
        <View style={styles.bulkBar}>
          <TouchableOpacity
            style={styles.bulkButton}
            disabled={busy}
            onPress={() => searchEpisodes([...selected], `${selected.size} episode(s)`)}
          >
            <Ionicons name="search" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.bulkButton} disabled={busy} onPress={() => setMonitoredBulk([...selected], true)}>
            <Ionicons name="bookmark" size={18} color={colors.sonarr} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.bulkButton} disabled={busy} onPress={() => setMonitoredBulk([...selected], false)}>
            <Ionicons name="bookmark-outline" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.bulkButton, styles.bulkButtonDanger]}
            disabled={busy}
            onPress={() => deleteFilesBulk(selectedEpisodes)}
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
  seasonTitle: { color: colors.textPrimary, fontSize: 26, fontWeight: '800' },
  selectAllHint: { color: colors.textSecondary, paddingHorizontal: 16, marginTop: 6, marginBottom: 10 },
  searchInput: {
    marginHorizontal: 16,
    marginBottom: 10,
    backgroundColor: colors.surface,
    borderRadius: 8,
    padding: 10,
    color: colors.textPrimary,
    // 16px avoids iOS Safari's auto-zoom-on-focus for small inputs - see movies.tsx.
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
  rowStatusUnaired: { color: colors.sonarr, fontSize: 13, fontWeight: '600', marginTop: 2 },
  rowStatusOk: { color: colors.success, fontSize: 13, fontWeight: '600', marginTop: 2 },
  rowStatusMissing: { color: colors.danger, fontSize: 13, fontWeight: '600', marginTop: 2 },
  rowDate: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  expandActionRow: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 8 },
  expandActionRowNoFile: { marginBottom: 16 },
  expandAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: 8,
    height: 36,
    minWidth: 36,
    paddingHorizontal: 10,
  },
  expandActionWide: { flex: 1 },
  expandActionText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
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
