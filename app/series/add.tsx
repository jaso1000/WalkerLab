import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sonarrApi, SonarrQualityProfile, SonarrRootFolder, SonarrSeries } from '../../src/api/sonarr';
import { tmdbApi } from '../../src/api/tmdb';
import { ActionSheet, ActionSheetOption } from '../../src/components/ActionSheet';
import { SelectRow, SwitchRow } from '../../src/components/SelectRow';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import { SONARR_MONITOR_OPTIONS, SonarrMonitorOption } from '../../src/lib/constants';
import { getLastQualityProfileId, setLastQualityProfileId } from '../../src/lib/preferences';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { colors } from '../../src/theme/colors';

// Add Series flow: Sonarr's own title search (works without TMDB
// configured), then either opens Discover's richer detail page (resolving
// Sonarr's tvdbId to a tmdbId first, since Discover routes are tmdbId-keyed)
// or falls back to this screen's own lightweight config form. Mirrors
// `movie/add.tsx`'s shape, plus the extra tvdbId->tmdbId resolve step and a
// Monitor picker instead of a plain Monitored switch.
export default function AddSeriesScreen() {
  const tabBarClearance = useTabBarClearance();
  const { servers } = useServers();
  const config = servers.sonarr;
  const tmdbConfig = servers.tmdb;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SonarrSeries[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SonarrSeries | null>(null);
  const [resolvingTvdbId, setResolvingTvdbId] = useState<number | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [profiles, setProfiles] = useState<SonarrQualityProfile[]>([]);
  const [rootFolders, setRootFolders] = useState<SonarrRootFolder[]>([]);
  const [qualityProfileId, setQualityProfileId] = useState<number | null>(null);
  const [rootFolderPath, setRootFolderPath] = useState<string | null>(null);
  const [monitorOption, setMonitorOption] = useState<SonarrMonitorOption>('all');
  const [searchOnAdd, setSearchOnAdd] = useState(true);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);

  // Loads Sonarr's profile/root-folder options once, defaulting the quality
  // profile to whatever was last used for a Sonarr add.
  useFocusEffect(
    useCallback(() => {
      if (!config) return;
      sonarrApi.getQualityProfiles(config).then(async (list) => {
        setProfiles(list);
        const remembered = await getLastQualityProfileId('sonarr');
        setQualityProfileId((prev) => prev ?? list.find((p) => p.id === remembered)?.id ?? list[0]?.id ?? null);
      });
      sonarrApi.getRootFolders(config).then((list) => {
        setRootFolders(list);
        setRootFolderPath((prev) => prev ?? list[0]?.path ?? null);
      });
    }, [config])
  );

  // Debounced Sonarr title search, same 350ms pattern as Add Movie.
  const runSearch = useCallback(
    (text: string) => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
      if (!config || !text.trim()) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      searchDebounce.current = setTimeout(() => {
        sonarrApi
          .searchSeries(config, text.trim())
          .then(setResults)
          .catch((e) => alert('Search failed', e instanceof Error ? e.message : 'Unknown error'))
          .finally(() => setSearching(false));
      }, 350);
    },
    [config]
  );

  const handleQueryChange = (text: string) => {
    setQuery(text);
    runSearch(text);
  };

  // Already-in-library results just open the real series detail page. New
  // results try to resolve a tmdbId (Discover needs one; Sonarr's search
  // results only carry a tvdbId) and open Discover's detail page if that
  // resolves; otherwise falls back to this screen's own lightweight form.
  const openResult = async (item: SonarrSeries) => {
    if (item.id) {
      router.push(`/series/${item.id}`);
      return;
    }
    if (tmdbConfig && item.tvdbId) {
      setResolvingTvdbId(item.tvdbId);
      try {
        const res = await tmdbApi.findByTvdbId(tmdbConfig, item.tvdbId);
        const tmdbId = res.tv_results[0]?.id;
        if (tmdbId) {
          router.push(`/discover/tv/${tmdbId}`);
          return;
        }
      } catch {
        // Fall through to the lightweight config screen below.
      } finally {
        setResolvingTvdbId(null);
      }
    }
    setSelected(item);
  };

  // Adds the selected series using this form's own config fields, remembers
  // the chosen quality profile for next time, and returns on success.
  const submit = async () => {
    if (!config || !selected || !qualityProfileId || !rootFolderPath || !selected.tvdbId) return;
    setAdding(true);
    try {
      await sonarrApi.addSeries(config, {
        title: selected.title,
        tvdbId: selected.tvdbId,
        qualityProfileId,
        rootFolderPath,
        monitorOption,
        searchOnAdd,
      });
      await setLastQualityProfileId('sonarr', qualityProfileId);
      alert('Added', `${selected.title} was added to Sonarr.`);
      router.back();
    } catch (e) {
      alert('Failed to add', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAdding(false);
    }
  };

  if (!config) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyText}>Sonarr isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  if (selected) {
    const poster = selected.images.find((i) => i.coverType === 'poster');
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconButton} onPress={() => setSelected(null)}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Add Series</Text>
          <View style={{ width: 38 }} />
        </View>
        <ScrollView contentContainerStyle={[styles.configContainer, { paddingBottom: tabBarClearance }]}>
          <View style={styles.configHeader}>
            {poster?.remoteUrl ? (
              <Image source={{ uri: poster.remoteUrl }} style={styles.poster} cachePolicy="memory-disk" />
            ) : (
              <View style={[styles.poster, styles.posterPlaceholder]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.configTitle}>{selected.title}</Text>
              <Text style={styles.configMeta}>{selected.year}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <SelectRow
              label="Quality Profile"
              value={profiles.find((p) => p.id === qualityProfileId)?.name ?? 'Select'}
              onPress={() =>
                setMenu({
                  title: 'Quality Profile',
                  options: profiles.map((p) => ({ label: p.name, onPress: () => setQualityProfileId(p.id) })),
                })
              }
            />
            <SelectRow
              label="Root Folder"
              value={rootFolderPath ?? 'Select'}
              onPress={() =>
                setMenu({
                  title: 'Root Folder',
                  options: rootFolders.map((f) => ({ label: f.path, onPress: () => setRootFolderPath(f.path) })),
                })
              }
            />
            <SelectRow
              label="Monitor"
              value={SONARR_MONITOR_OPTIONS.find((o) => o.value === monitorOption)?.label ?? 'All Episodes'}
              onPress={() =>
                setMenu({
                  title: 'Monitor',
                  options: SONARR_MONITOR_OPTIONS.map((o) => ({ label: o.label, onPress: () => setMonitorOption(o.value) })),
                })
              }
            />
            <SwitchRow label="Search on Add" value={searchOnAdd} onChange={setSearchOnAdd} tint={colors.sonarr} />
          </View>

          <TouchableOpacity
            style={[styles.addButton, (adding || !qualityProfileId || !rootFolderPath) && styles.addButtonDisabled]}
            onPress={submit}
            disabled={adding || !qualityProfileId || !rootFolderPath}
          >
            <Text style={styles.addButtonText}>{adding ? 'Adding…' : 'Add Series'}</Text>
          </TouchableOpacity>
        </ScrollView>

        <ActionSheet
          visible={!!menu}
          title={menu?.title ?? ''}
          options={menu?.options ?? []}
          onClose={() => setMenu(null)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Add Series</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for a show"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={handleQueryChange}
            returnKeyType="search"
            autoFocus
          />
          {query ? (
            <TouchableOpacity onPress={() => handleQueryChange('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(item, index) => `${item.title}-${index}`}
        contentContainerStyle={[styles.list, { paddingBottom: tabBarClearance }]}
        ListHeaderComponent={searching ? <ActivityIndicator color={colors.sonarr} style={{ marginBottom: 12 }} /> : null}
        renderItem={({ item }) => {
          const poster = item.images.find((i) => i.coverType === 'poster');
          const inLibrary = Boolean(item.id);
          const resolving = resolvingTvdbId !== null && resolvingTvdbId === item.tvdbId;
          return (
            <TouchableOpacity style={styles.resultRow} onPress={() => openResult(item)} disabled={resolving}>
              {poster?.remoteUrl ? (
                <Image source={{ uri: poster.remoteUrl }} style={styles.resultPoster} cachePolicy="memory-disk" />
              ) : (
                <View style={[styles.resultPoster, styles.posterPlaceholder]} />
              )}
              <View style={styles.resultInfo}>
                <Text style={styles.resultTitle} numberOfLines={2}>
                  {item.title}
                </Text>
                <Text style={styles.resultMeta}>
                  {item.year ?? ''}
                  {inLibrary ? ' · In Library' : ''}
                </Text>
              </View>
              {resolving ? <ActivityIndicator size="small" color={colors.sonarr} /> : null}
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  searchRow: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 48,
  },
  // 16px avoids iOS Safari's auto-zoom-on-focus for small inputs - see movies.tsx.
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 16 },
  list: { padding: 16, gap: 10 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 14, padding: 10, marginBottom: 10 },
  resultPoster: { width: 46, height: 69, borderRadius: 6, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  resultInfo: { flex: 1 },
  resultTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  resultMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  configContainer: { padding: 16, gap: 14 },
  configHeader: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  poster: { width: 70, height: 105, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  configTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 18 },
  configMeta: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 16 },
  addButton: { backgroundColor: colors.sonarr, borderRadius: 10, padding: 14, alignItems: 'center' },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: { color: colors.textPrimary, fontWeight: '800', fontSize: 16 },
});
