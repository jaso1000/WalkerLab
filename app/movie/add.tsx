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
import { radarrApi, RadarrMovie, RadarrQualityProfile, RadarrRootFolder } from '../../src/api/radarr';
import { ActionSheet, ActionSheetOption } from '../../src/components/ActionSheet';
import { SelectRow, SwitchRow } from '../../src/components/SelectRow';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import { AVAILABILITY_OPTIONS } from '../../src/lib/constants';
import { getLastQualityProfileId, setLastQualityProfileId } from '../../src/lib/preferences';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { colors } from '../../src/theme/colors';

// Add Movie flow: Radarr's own title search (works without TMDB configured),
// then either opens Discover's richer detail page (when TMDB is available
// and the result isn't already in the library) or falls back to this
// screen's own lightweight quality-profile/root-folder config form.
export default function AddMovieScreen() {
  const tabBarClearance = useTabBarClearance();
  const { servers } = useServers();
  const config = servers.radarr;
  const tmdbConfig = servers.tmdb;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RadarrMovie[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<RadarrMovie | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [profiles, setProfiles] = useState<RadarrQualityProfile[]>([]);
  const [rootFolders, setRootFolders] = useState<RadarrRootFolder[]>([]);
  const [qualityProfileId, setQualityProfileId] = useState<number | null>(null);
  const [rootFolderPath, setRootFolderPath] = useState<string | null>(null);
  const [minimumAvailability, setMinimumAvailability] = useState('released');
  const [monitored, setMonitored] = useState(true);
  const [searchOnAdd, setSearchOnAdd] = useState(true);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);

  // Loads Radarr's profile/root-folder options once, defaulting the quality
  // profile to whatever was last used for a Radarr add (falling back to the
  // first profile if nothing's been remembered yet). `prev ?? ...` avoids
  // clobbering a selection the user already made if this effect re-runs.
  useFocusEffect(
    useCallback(() => {
      if (!config) return;
      radarrApi.getQualityProfiles(config).then(async (list) => {
        setProfiles(list);
        const remembered = await getLastQualityProfileId('radarr');
        setQualityProfileId((prev) => prev ?? list.find((p) => p.id === remembered)?.id ?? list[0]?.id ?? null);
      });
      radarrApi.getRootFolders(config).then((list) => {
        setRootFolders(list);
        setRootFolderPath((prev) => prev ?? list[0]?.path ?? null);
      });
    }, [config])
  );

  // Debounced Radarr title search - waits 350ms after the last keystroke
  // before actually calling the API, so fast typing doesn't fire a request
  // per character.
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
        radarrApi
          .searchMovies(config, text.trim())
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

  // Already-in-library results just open the real movie detail page.
  // New results prefer Discover's richer detail page when TMDB is
  // configured; otherwise fall back to this screen's own lightweight form.
  const openResult = (item: RadarrMovie) => {
    if (item.id) {
      router.push(`/movie/${item.id}`);
    } else if (tmdbConfig) {
      router.push(`/discover/movie/${item.tmdbId}`);
    } else {
      setSelected(item);
    }
  };

  // Adds the selected movie using this form's own config fields, remembers
  // the chosen quality profile for next time, and returns to the previous
  // screen on success.
  const submit = async () => {
    if (!config || !selected || !qualityProfileId || !rootFolderPath) return;
    setAdding(true);
    try {
      await radarrApi.addMovie(config, {
        title: selected.title,
        tmdbId: selected.tmdbId,
        qualityProfileId,
        rootFolderPath,
        minimumAvailability,
        monitored,
        searchOnAdd,
      });
      await setLastQualityProfileId('radarr', qualityProfileId);
      alert('Added', `${selected.title} was added to Radarr.`);
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
        <Text style={styles.emptyText}>Radarr isn&apos;t connected.</Text>
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
          <Text style={styles.topBarTitle}>Add Movie</Text>
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
              label="Minimum Availability"
              value={AVAILABILITY_OPTIONS.find((o) => o.value === minimumAvailability)?.label ?? 'Released'}
              onPress={() =>
                setMenu({
                  title: 'Minimum Availability',
                  options: AVAILABILITY_OPTIONS.map((o) => ({
                    label: o.label,
                    onPress: () => setMinimumAvailability(o.value),
                  })),
                })
              }
            />
            <SwitchRow label="Monitored" value={monitored} onChange={setMonitored} />
            <SwitchRow label="Search on Add" value={searchOnAdd} onChange={setSearchOnAdd} />
          </View>

          <TouchableOpacity
            style={[styles.addButton, (adding || !qualityProfileId || !rootFolderPath) && styles.addButtonDisabled]}
            onPress={submit}
            disabled={adding || !qualityProfileId || !rootFolderPath}
          >
            <Text style={styles.addButtonText}>{adding ? 'Adding…' : 'Add Movie'}</Text>
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
        <Text style={styles.topBarTitle}>Add Movie</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for a movie"
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
        keyExtractor={(item) => String(item.tmdbId)}
        contentContainerStyle={[styles.list, { paddingBottom: tabBarClearance }]}
        ListHeaderComponent={searching ? <ActivityIndicator color={colors.accent} style={{ marginBottom: 12 }} /> : null}
        renderItem={({ item }) => {
          const poster = item.images.find((i) => i.coverType === 'poster');
          const inLibrary = Boolean(item.id);
          return (
            <TouchableOpacity style={styles.resultRow} onPress={() => openResult(item)}>
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
  addButton: { backgroundColor: colors.accent, borderRadius: 10, padding: 14, alignItems: 'center' },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: { color: '#1A1300', fontWeight: '800', fontSize: 16 },
});
