import { Ionicons } from '@expo/vector-icons';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { radarrApi, RadarrMovie } from '../../src/api/radarr';
import { sonarrApi, SonarrSeries } from '../../src/api/sonarr';
import { TMDB_NETWORKS, tmdbApi, tmdbImageUrl, TmdbMovie, TmdbSearchResult, TmdbTv } from '../../src/api/tmdb';
import { DiscoverCardItem, DiscoverRow } from '../../src/components/DiscoverRow';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import { deletedLibrary } from '../../src/lib/deletedLibrary';
import { getLastQualityProfileId, setLastQualityProfileId } from '../../src/lib/preferences';
import { CATEGORY_LABELS, DiscoverCategory, fetchDiscoverCategory, MediaKind } from '../../src/lib/discoverCategories';
import { badgeForMovie, badgeForSeries, buildLibraryIndex, EMPTY_LIBRARY_INDEX, LibraryIndex } from '../../src/lib/libraryStatus';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { colors } from '../../src/theme/colors';

// Main Discover screen: universal search with quick-add, a Recently Added
// row sourced from the actual Radarr/Sonarr library, and capped preview rows
// for Trending/Popular/Upcoming/Recently Released (movie-only) that each
// open into a full infinite-scroll grid (`discover/category/[category]`) via
// their row title. Movies/TV Shows toggle switches which set of TMDB data
// and library records everything below reads from.
const PREVIEW_COUNT = 15;
const CATEGORIES: DiscoverCategory[] = ['trending', 'popular', 'upcoming'];

// Converts raw TMDB list items into the generic card shape `DiscoverRow`
// renders, capped at `PREVIEW_COUNT` and tagging each with its library
// status badge (in-library/downloaded/deleted, or none).
function toCardItems(items: (TmdbMovie | TmdbTv)[], type: MediaKind, library: LibraryIndex): DiscoverCardItem[] {
  return items.slice(0, PREVIEW_COUNT).map((item) => ({
    id: item.id,
    title: type === 'movie' ? (item as TmdbMovie).title : (item as TmdbTv).name,
    posterUrl: tmdbImageUrl(item.poster_path),
    rating: item.vote_average,
    badge: type === 'movie' ? badgeForMovie(item.id, library) : badgeForSeries(item.id, library),
  }));
}

export default function DiscoverScreen() {
  const { servers } = useServers();
  const config = servers.tmdb;
  const radarrConfig = servers.radarr;
  const sonarrConfig = servers.sonarr;
  const navigation = useNavigation();
  const tabBarClearance = useTabBarClearance();
  const [mediaType, setMediaType] = useState<MediaKind>('movie');

  const [categories, setCategories] = useState<Record<DiscoverCategory, (TmdbMovie | TmdbTv)[]>>({
    trending: [],
    popular: [],
    upcoming: [],
    recent: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [libraryMovies, setLibraryMovies] = useState<RadarrMovie[]>([]);
  const [librarySeries, setLibrarySeries] = useState<SonarrSeries[]>([]);
  const [library, setLibrary] = useState<LibraryIndex>(EMPTY_LIBRARY_INDEX);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<TmdbSearchResult[]>([]);
  const [quickAddBusy, setQuickAddBusy] = useState<Set<string>>(new Set());
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Loads page 1 of every preview row for the current media type in
  // parallel. "Recently Released" only applies to movies (see
  // `discoverCategories.ts`), so it's fetched conditionally rather than
  // unconditionally alongside the shared `CATEGORIES` list.
  const load = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    setError(null);
    try {
      const [t, p, u] = await Promise.all(CATEGORIES.map((c) => fetchDiscoverCategory(config, c, mediaType, 1)));
      const r = mediaType === 'movie' ? await fetchDiscoverCategory(config, 'recent', mediaType, 1) : null;
      setCategories({ trending: t.results, popular: p.results, upcoming: u.results, recent: r?.results ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load Discover');
    } finally {
      setLoading(false);
    }
  }, [config, mediaType]);

  // Loads the real Radarr/Sonarr library (for the Recently Added row) and
  // rebuilds the tmdbId-keyed library index (for poster status badges) -
  // each service's library fetch independently falls back to an empty list
  // on failure so a misconfigured/offline service doesn't block the other.
  const loadLibrary = useCallback(async () => {
    // Fetch each list once and reuse it for both the Recently Added row and
    // the library index below - buildLibraryIndex used to fetch its own
    // second copy of both internally, doubling every load's bandwidth for
    // no reason (see the comment on its `movies`/`series` params).
    const [movies, series] = await Promise.all([
      radarrConfig ? radarrApi.getMovies(radarrConfig).catch(() => [] as RadarrMovie[]) : Promise.resolve([] as RadarrMovie[]),
      sonarrConfig ? sonarrApi.getSeries(sonarrConfig).catch(() => [] as SonarrSeries[]) : Promise.resolve([] as SonarrSeries[]),
    ]);
    setLibraryMovies(movies);
    setLibrarySeries(series);
    buildLibraryIndex({ tmdbConfig: config, radarrConfig, sonarrConfig, movies, series }).then(setLibrary);
  }, [config, radarrConfig, sonarrConfig]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useFocusEffect(
    useCallback(() => {
      loadLibrary();
    }, [loadLibrary])
  );

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        navigation.dispatch(DrawerActions.openDrawer());
        return true;
      });
      return () => sub.remove();
    }, [navigation])
  );

  // Debounced universal search (`/search/multi`) - same 350ms pattern as
  // the Add Movie/Series screens' searches, filtered down to movie/tv
  // results only (search/multi can also return people, which this row
  // doesn't render).
  const runSearch = useCallback(
    (text: string) => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
      if (!config || !text.trim()) {
        setSearchResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      searchDebounce.current = setTimeout(() => {
        tmdbApi
          .searchMulti(config, text.trim())
          .then((res) => setSearchResults(res.results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv')))
          .catch(() => setSearchResults([]))
          .finally(() => setSearching(false));
      }, 350);
    },
    [config]
  );

  const handleQueryChange = (text: string) => {
    setQuery(text);
    runSearch(text);
  };

  // Adds a search result using the first quality profile (or last-
  // remembered one) and first root folder, without opening the full
  // config picker - a deliberately fast path for a "just add it" flow.
  // Open the full detail page instead if a specific profile/folder matters.
  const quickAdd = async (result: TmdbSearchResult) => {
    const key = `${result.media_type}:${result.id}`;
    setQuickAddBusy((prev) => new Set(prev).add(key));
    try {
      if (result.media_type === 'movie') {
        if (!radarrConfig) throw new Error('Radarr isn’t connected.');
        const [profiles, folders, matches] = await Promise.all([
          radarrApi.getQualityProfiles(radarrConfig),
          radarrApi.getRootFolders(radarrConfig),
          radarrApi.searchMovies(radarrConfig, `tmdb:${result.id}`),
        ]);
        const match = matches[0];
        if (!match || !profiles[0] || !folders[0]) throw new Error('Could not resolve defaults for this movie.');
        const remembered = await getLastQualityProfileId('radarr');
        const qualityProfileId = profiles.find((p) => p.id === remembered)?.id ?? profiles[0].id;
        await radarrApi.addMovie(radarrConfig, {
          title: match.title,
          tmdbId: match.tmdbId,
          qualityProfileId,
          rootFolderPath: folders[0].path,
        });
        await deletedLibrary.unmarkMovieDeleted(result.id);
        await setLastQualityProfileId('radarr', qualityProfileId);
      } else {
        if (!sonarrConfig || !config) throw new Error('Sonarr isn’t connected.');
        const ids = await tmdbApi.tvExternalIds(config, result.id);
        if (!ids.tvdb_id) throw new Error("This show couldn't be matched to TheTVDB.");
        const [profiles, folders, matches] = await Promise.all([
          sonarrApi.getQualityProfiles(sonarrConfig),
          sonarrApi.getRootFolders(sonarrConfig),
          sonarrApi.searchSeries(sonarrConfig, `tvdb:${ids.tvdb_id}`),
        ]);
        const match = matches[0];
        if (!match || !profiles[0] || !folders[0]) throw new Error('Could not resolve defaults for this show.');
        const remembered = await getLastQualityProfileId('sonarr');
        const qualityProfileId = profiles.find((p) => p.id === remembered)?.id ?? profiles[0].id;
        await sonarrApi.addSeries(sonarrConfig, {
          title: match.title,
          tvdbId: ids.tvdb_id,
          qualityProfileId,
          rootFolderPath: folders[0].path,
        });
        await deletedLibrary.unmarkSeriesDeleted(ids.tvdb_id);
        await deletedLibrary.unmarkSeriesDeletedByTmdbId(result.id);
        await setLastQualityProfileId('sonarr', qualityProfileId);
      }
      loadLibrary();
    } catch (e) {
      alert('Failed to add', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setQuickAddBusy((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  if (!config) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>Discover isn&apos;t set up yet</Text>
        <Text style={styles.emptyText}>
          Add a free TMDB API key in Settings to browse trending, popular, and upcoming movies &amp; shows.
        </Text>
        <TouchableOpacity style={styles.settingsButton} onPress={() => router.push('/settings')}>
          <Text style={styles.settingsButtonText}>Go to Settings</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const openItem = (id: number) => router.push(`/discover/${mediaType}/${id}`);
  const openCategory = (category: DiscoverCategory) => router.push(`/discover/category/${category}?mediaType=${mediaType}`);

  // Sourced from Radarr/Sonarr's own `added` timestamp (not TMDB), sorted
  // newest-first and capped the same way the TMDB preview rows are.
  const recentlyAdded: DiscoverCardItem[] =
    mediaType === 'movie'
      ? [...libraryMovies]
          .filter((m) => m.added)
          .sort((a, b) => new Date(b.added!).getTime() - new Date(a.added!).getTime())
          .slice(0, PREVIEW_COUNT)
          .map((m) => ({
            id: m.id,
            title: m.title,
            posterUrl: m.images.find((i) => i.coverType === 'poster')?.remoteUrl,
            rating: m.ratings?.imdb?.value,
          }))
      : [...librarySeries]
          .filter((s) => s.added)
          .sort((a, b) => new Date(b.added!).getTime() - new Date(a.added!).getTime())
          .slice(0, PREVIEW_COUNT)
          .map((s) => ({
            id: s.id,
            title: s.title,
            posterUrl: s.images.find((i) => i.coverType === 'poster')?.remoteUrl,
            rating: s.ratings?.value,
          }));
  const openLocalItem = (id: number) => router.push(mediaType === 'movie' ? `/movie/${id}` : `/series/${id}`);

  return (
    <View style={styles.screen}>
      <View style={styles.searchRow}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search movies & TV shows..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={handleQueryChange}
          />
          {query ? (
            <TouchableOpacity onPress={() => handleQueryChange('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {query.trim() ? (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => `${item.media_type}:${item.id}`}
          contentContainerStyle={[styles.searchList, { paddingBottom: tabBarClearance }]}
          ListEmptyComponent={
            !searching ? <Text style={styles.emptyText}>No results for &quot;{query}&quot;.</Text> : null
          }
          ListHeaderComponent={searching ? <ActivityIndicator color={colors.sectionGreen} style={{ marginBottom: 12 }} /> : null}
          renderItem={({ item }) => {
            const title = item.title ?? item.name ?? 'Untitled';
            const year = (item.release_date ?? item.first_air_date ?? '').slice(0, 4);
            const posterUrl = tmdbImageUrl(item.poster_path);
            const busy = quickAddBusy.has(`${item.media_type}:${item.id}`);
            return (
              <Pressable style={styles.searchRowItem} onPress={() => router.push(`/discover/${item.media_type}/${item.id}`)}>
                {posterUrl ? (
                  <Image source={{ uri: posterUrl }} style={styles.searchPoster} cachePolicy="memory-disk" />
                ) : (
                  <View style={[styles.searchPoster, styles.posterPlaceholder]} />
                )}
                <View style={styles.searchInfo}>
                  <Text style={styles.searchTitle} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text style={styles.searchMeta}>
                    {item.media_type === 'movie' ? 'Movie' : 'TV Show'}
                    {year ? ` · ${year}` : ''}
                  </Text>
                </View>
                <TouchableOpacity style={styles.quickAddButton} onPress={() => quickAdd(item)} disabled={busy}>
                  {busy ? <ActivityIndicator size="small" color={colors.background} /> : <Ionicons name="add" size={18} color={colors.background} />}
                </TouchableOpacity>
              </Pressable>
            );
          }}
        />
      ) : (
        <>
          <View style={styles.toggleRow}>
            <TouchableOpacity
              style={[styles.toggle, mediaType === 'movie' && styles.toggleActive]}
              onPress={() => setMediaType('movie')}
            >
              <Text style={[styles.toggleText, mediaType === 'movie' && styles.toggleTextActive]}>Movies</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.toggle, mediaType === 'tv' && styles.toggleActive]} onPress={() => setMediaType('tv')}>
              <Text style={[styles.toggleText, mediaType === 'tv' && styles.toggleTextActive]}>TV Shows</Text>
            </TouchableOpacity>
          </View>

          {mediaType === 'tv' ? (
            <View style={styles.networkRow}>
              {TMDB_NETWORKS.map((network) => (
                <TouchableOpacity
                  key={network.id}
                  style={[styles.networkChip, { borderColor: network.color }]}
                  onPress={() => router.push(`/discover/network/${network.id}?name=${encodeURIComponent(network.name)}`)}
                >
                  <View style={[styles.networkDot, { backgroundColor: network.color }]} />
                  <Text style={styles.networkChipText}>{network.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}

          {loading && categories.trending.length === 0 ? (
            <ActivityIndicator color={colors.sectionGreen} style={{ marginTop: 40 }} />
          ) : (
            <ScrollView
              contentContainerStyle={{ paddingBottom: tabBarClearance }}
              refreshControl={<RefreshControl tintColor={colors.sectionGreen} refreshing={loading} onRefresh={load} />}
            >
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <DiscoverRow title="Recently Added" items={recentlyAdded} onPressItem={openLocalItem} />
              {CATEGORIES.map((category) => (
                <DiscoverRow
                  key={category}
                  title={CATEGORY_LABELS[category]}
                  items={toCardItems(categories[category], mediaType, library)}
                  onPressItem={openItem}
                  onPressTitle={() => openCategory(category)}
                />
              ))}
              {mediaType === 'movie' ? (
                <DiscoverRow
                  title={CATEGORY_LABELS.recent}
                  items={toCardItems(categories.recent, mediaType, library)}
                  onPressItem={openItem}
                  onPressTitle={() => openCategory('recent')}
                />
              ) : null}

              <View style={{ height: 32 }} />
            </ScrollView>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  settingsButton: { backgroundColor: colors.sectionGreen, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 24, marginTop: 8 },
  settingsButtonText: { color: colors.background, fontWeight: '700' },
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
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 15 },
  searchList: { padding: 16, gap: 10 },
  searchRowItem: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 14, padding: 10, marginBottom: 10 },
  searchPoster: { width: 46, height: 69, borderRadius: 6, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  searchInfo: { flex: 1 },
  searchTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  searchMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  quickAddButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.sectionGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  toggle: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  toggleActive: { backgroundColor: colors.sectionGreenMuted },
  toggleText: { color: colors.textSecondary, fontWeight: '700' },
  toggleTextActive: { color: colors.sectionGreen },
  error: { color: colors.danger, marginHorizontal: 16, marginTop: 12 },
  networkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 },
  networkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  networkDot: { width: 8, height: 8, borderRadius: 4 },
  networkChipText: { color: colors.textPrimary, fontWeight: '600', fontSize: 13 },
});
