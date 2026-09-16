// Manual-import screen for a Sonarr queue item Sonarr couldn't auto-import
// (e.g. "Found matching series via grab history, but release was matched to
// series by ID. Automatic import is not possible.") - shows Sonarr's own
// best-guess file/episode/quality match per file (`getManualImportItems`),
// lets the user fix the episode/quality if needed, then confirms via
// `importManually`. Reached from the TV Shows Activity tab's "…" menu on a
// blocked/errored queue item.
//
// Deliberately doesn't support reassigning the matched *series* - the
// failure mode this screen exists for only happens once Sonarr has already
// resolved the download back to a specific series via grab history, so the
// series match itself is reliable; only the episode/quality occasionally
// need a nudge. A file with no series/episode match at all (a genuinely
// unknown download) is flagged as unresolved rather than given a full
// search-and-pick flow here - same "fast common case over exhaustive
// options" tradeoff as Discover's quick-add (see PLAN.md).
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SonarrEpisode, SonarrManualImportItem, SonarrQualityDefinition, sonarrApi } from '../../../src/api/sonarr';
import { ActionSheet, ActionSheetOption } from '../../../src/components/ActionSheet';
import { SelectRow } from '../../../src/components/SelectRow';
import { useServers } from '../../../src/context/ServersContext';
import { alert } from '../../../src/lib/alert';
import { formatBytes } from '../../../src/lib/format';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

interface FileOverride {
  episodeId?: number;
  qualityId?: number;
}

export default function SeriesManualImportScreen() {
  const { downloadId } = useLocalSearchParams<{ downloadId: string }>();
  const { servers } = useServers();
  const config = servers.sonarr;
  const tabBarClearance = useTabBarClearance();

  const [items, setItems] = useState<SonarrManualImportItem[]>([]);
  const [qualities, setQualities] = useState<SonarrQualityDefinition[]>([]);
  const [episodesBySeries, setEpisodesBySeries] = useState<Record<number, SonarrEpisode[]>>({});
  const [overrides, setOverrides] = useState<Record<number, FileOverride>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);

  const load = useCallback(async () => {
    if (!config || !downloadId) return;
    setLoading(true);
    try {
      const [candidates, qualityDefs] = await Promise.all([
        sonarrApi.getManualImportItems(config, downloadId),
        sonarrApi.getQualityDefinitions(config),
      ]);
      setItems(candidates);
      setQualities(qualityDefs);
      // Pre-select every file Sonarr already fully matched (series +
      // episode), matching Sonarr's own manual-import dialog's default of
      // every resolvable row checked.
      setSelected(new Set(candidates.filter((c) => c.series && c.episodes?.length).map((c) => c.id)));
      const seriesIds = [...new Set(candidates.map((c) => c.series?.id).filter((id): id is number => !!id))];
      const episodeLists = await Promise.all(seriesIds.map((id) => sonarrApi.getEpisodes(config, id)));
      setEpisodesBySeries(Object.fromEntries(seriesIds.map((id, i) => [id, episodeLists[i]])));
    } catch (e) {
      alert('Failed to load', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, downloadId]);

  useEffect(() => {
    load();
  }, [load]);

  // Resolves one file's effective episode/quality, folding in any local
  // override over Sonarr's own suggestion.
  const resolve = useCallback(
    (item: SonarrManualImportItem) => {
      const override = overrides[item.id];
      const seasonEpisodes = item.series ? episodesBySeries[item.series.id]?.filter((e) => e.seasonNumber === item.seasonNumber) ?? [] : [];
      const episodeId = override?.episodeId ?? item.episodes?.[0]?.id;
      const episode = seasonEpisodes.find((e) => e.id === episodeId) ?? item.episodes?.find((e) => e.id === episodeId);
      const qualityDef = override?.qualityId ? qualities.find((q) => q.id === override.qualityId) : undefined;
      return {
        seasonEpisodes,
        episodeId,
        episode,
        qualityName: qualityDef?.quality.name ?? item.quality?.quality.name ?? 'Unknown',
        quality: qualityDef ? { quality: qualityDef.quality, revision: item.quality?.revision } : item.quality,
      };
    },
    [overrides, episodesBySeries, qualities]
  );

  const toggleSelected = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openEpisodePicker = (item: SonarrManualImportItem) => {
    const { seasonEpisodes } = resolve(item);
    if (!seasonEpisodes.length) {
      alert('No episodes found', 'Could not load this season’s episode list.');
      return;
    }
    setMenu({
      title: 'Choose Episode',
      options: seasonEpisodes.map((ep) => ({
        label: `E${ep.episodeNumber} · ${ep.title}`,
        onPress: () => setOverrides((prev) => ({ ...prev, [item.id]: { ...prev[item.id], episodeId: ep.id } })),
      })),
    });
  };

  const openQualityPicker = (item: SonarrManualImportItem) => {
    setMenu({
      title: 'Choose Quality',
      options: qualities.map((q) => ({
        label: q.title,
        onPress: () => setOverrides((prev) => ({ ...prev, [item.id]: { ...prev[item.id], qualityId: q.id } })),
      })),
    });
  };

  const selectedCount = selected.size;

  const submit = async () => {
    if (!config) return;
    const toImport = items.filter((item) => selected.has(item.id));
    const unresolved = toImport.filter((item) => !item.series);
    if (unresolved.length > 0) {
      alert('Can’t import everything selected', 'One or more selected files have no matched series - deselect them or resolve this download from Sonarr’s own web UI instead.');
      return;
    }
    setImporting(true);
    try {
      await sonarrApi.importManually(
        config,
        toImport.map((item) => {
          const { episodeId, quality } = resolve(item);
          return {
            path: item.path,
            folderName: item.folderName,
            seriesId: item.series!.id,
            episodeIds: episodeId ? [episodeId] : [],
            seasonNumber: item.seasonNumber,
            quality,
            languages: item.languages,
            releaseGroup: item.releaseGroup,
            downloadId: item.downloadId,
          };
        })
      );
      alert('Import Started', 'Sonarr is importing the selected file(s) now.');
      router.back();
    } catch (e) {
      alert('Import failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setImporting(false);
    }
  };

  if (!config) {
    return (
      <SafeAreaView style={styles.centered} edges={['top']}>
        <Text style={{ color: colors.textSecondary }}>Sonarr isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={() => router.back()}>
          <Ionicons name="close" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Manual Import</Text>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.sonarr} style={{ marginTop: 24 }} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>No importable files found for this download.</Text>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: tabBarClearance + 90 }]}>
          {items.map((item) => {
            const { episode, qualityName } = resolve(item);
            const isSelected = selected.has(item.id);
            return (
              <View key={item.id} style={styles.card}>
                <TouchableOpacity style={styles.cardHeader} onPress={() => toggleSelected(item.id)}>
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={isSelected ? colors.sonarr : colors.textSecondary}
                  />
                  <Text style={styles.fileName} numberOfLines={2}>
                    {item.name ?? item.relativePath ?? item.path}
                  </Text>
                </TouchableOpacity>

                <Text style={styles.seriesLine} numberOfLines={1}>
                  {item.series ? `${item.series.title} · Season ${item.seasonNumber}` : 'No series matched'}
                </Text>

                <SelectRow
                  label="Episode"
                  value={episode ? `E${episode.episodeNumber} · ${episode.title}` : 'Select'}
                  onPress={() => openEpisodePicker(item)}
                />
                <SelectRow label="Quality" value={qualityName} onPress={() => openQualityPicker(item)} />

                <Text style={styles.metaLine}>
                  {formatBytes(item.size)}
                  {item.releaseGroup ? ` · ${item.releaseGroup}` : ''}
                </Text>

                {item.rejections?.length ? (
                  <View style={styles.rejections}>
                    {item.rejections.map((r, i) => (
                      <Text key={i} style={styles.rejectionText}>
                        • {r.reason}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      {items.length > 0 ? (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.importButton, (importing || selectedCount === 0) && styles.importButtonDisabled]}
            onPress={submit}
            disabled={importing || selectedCount === 0}
          >
            <Text style={styles.importButtonText}>
              {importing ? 'Importing…' : `Import Selected (${selectedCount})`}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <ActionSheet visible={!!menu} title={menu?.title ?? ''} options={menu?.options ?? []} onClose={() => setMenu(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centered: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 24 },
  list: { padding: 16, gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, gap: 4 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fileName: { flex: 1, color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  seriesLine: { color: colors.sonarr, fontSize: 13, fontWeight: '600', marginTop: 4 },
  metaLine: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  rejections: { marginTop: 6, gap: 2 },
  rejectionText: { color: colors.danger, fontSize: 12, lineHeight: 16 },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  importButton: { backgroundColor: colors.sonarr, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  importButtonDisabled: { opacity: 0.5 },
  importButtonText: { color: colors.background, fontWeight: '800', fontSize: 15 },
});
