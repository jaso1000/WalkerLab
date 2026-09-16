// Manual-import screen for a Radarr queue item Radarr couldn't auto-import
// (e.g. "matched to movie by ID, automatic import is not possible") - shows
// Radarr's own best-guess file/quality match per file
// (`getManualImportItems`), lets the user fix the quality if needed, then
// confirms via `importManually`. Reached from the Movies Activity tab's "…"
// menu on a blocked/errored queue item. See series/manual-import's identical
// screen for the full "why no movie-reassignment" rationale - same reasoning
// applies here (Radarr already resolved the download to a specific movie via
// grab history, so that match itself is reliable).
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RadarrManualImportItem, RadarrQualityDefinition, radarrApi } from '../../../src/api/radarr';
import { ActionSheet, ActionSheetOption } from '../../../src/components/ActionSheet';
import { SelectRow } from '../../../src/components/SelectRow';
import { useServers } from '../../../src/context/ServersContext';
import { alert } from '../../../src/lib/alert';
import { formatBytes } from '../../../src/lib/format';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

export default function MovieManualImportScreen() {
  const { downloadId } = useLocalSearchParams<{ downloadId: string }>();
  const { servers } = useServers();
  const config = servers.radarr;
  const tabBarClearance = useTabBarClearance();

  const [items, setItems] = useState<RadarrManualImportItem[]>([]);
  const [qualities, setQualities] = useState<RadarrQualityDefinition[]>([]);
  const [overrides, setOverrides] = useState<Record<number, number | undefined>>({});
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);

  const load = useCallback(async () => {
    if (!config || !downloadId) return;
    setLoading(true);
    try {
      const [candidates, qualityDefs] = await Promise.all([
        radarrApi.getManualImportItems(config, downloadId),
        radarrApi.getQualityDefinitions(config),
      ]);
      setItems(candidates);
      setQualities(qualityDefs);
      // Pre-select every file Radarr already matched to a movie, matching
      // Radarr's own manual-import dialog's default of every resolvable row
      // checked.
      setSelected(new Set(candidates.filter((c) => c.movie).map((c) => c.id)));
    } catch (e) {
      alert('Failed to load', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, downloadId]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = useCallback(
    (item: RadarrManualImportItem) => {
      const qualityId = overrides[item.id];
      const qualityDef = qualityId ? qualities.find((q) => q.id === qualityId) : undefined;
      return {
        qualityName: qualityDef?.quality.name ?? item.quality?.quality.name ?? 'Unknown',
        quality: qualityDef ? { quality: qualityDef.quality, revision: item.quality?.revision } : item.quality,
      };
    },
    [overrides, qualities]
  );

  const toggleSelected = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openQualityPicker = (item: RadarrManualImportItem) => {
    setMenu({
      title: 'Choose Quality',
      options: qualities.map((q) => ({
        label: q.title,
        onPress: () => setOverrides((prev) => ({ ...prev, [item.id]: q.id })),
      })),
    });
  };

  const selectedCount = selected.size;

  const submit = async () => {
    if (!config) return;
    const toImport = items.filter((item) => selected.has(item.id));
    const unresolved = toImport.filter((item) => !item.movie);
    if (unresolved.length > 0) {
      alert('Can’t import everything selected', 'One or more selected files have no matched movie - deselect them or resolve this download from Radarr’s own web UI instead.');
      return;
    }
    setImporting(true);
    try {
      await radarrApi.importManually(
        config,
        toImport.map((item) => {
          const { quality } = resolve(item);
          return {
            path: item.path,
            folderName: item.folderName,
            movieId: item.movie!.id,
            quality,
            languages: item.languages,
            releaseGroup: item.releaseGroup,
            downloadId: item.downloadId,
          };
        })
      );
      alert('Import Started', 'Radarr is importing the selected file(s) now.');
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
        <Text style={{ color: colors.textSecondary }}>Radarr isn&apos;t connected.</Text>
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
        <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
      ) : items.length === 0 ? (
        <Text style={styles.empty}>No importable files found for this download.</Text>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: tabBarClearance + 90 }]}>
          {items.map((item) => {
            const { qualityName } = resolve(item);
            const isSelected = selected.has(item.id);
            return (
              <View key={item.id} style={styles.card}>
                <TouchableOpacity style={styles.cardHeader} onPress={() => toggleSelected(item.id)}>
                  <Ionicons
                    name={isSelected ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={isSelected ? colors.accent : colors.textSecondary}
                  />
                  <Text style={styles.fileName} numberOfLines={2}>
                    {item.name ?? item.relativePath ?? item.path}
                  </Text>
                </TouchableOpacity>

                <Text style={styles.movieLine} numberOfLines={1}>
                  {item.movie ? item.movie.title : 'No movie matched'}
                </Text>

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
  movieLine: { color: colors.accent, fontSize: 13, fontWeight: '600', marginTop: 4 },
  metaLine: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  rejections: { marginTop: 6, gap: 2 },
  rejectionText: { color: colors.danger, fontSize: 12, lineHeight: 16 },
  footer: {
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  importButton: { backgroundColor: colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  importButtonDisabled: { opacity: 0.5 },
  importButtonText: { color: colors.background, fontWeight: '800', fontSize: 15 },
});
