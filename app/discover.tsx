import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { radarrApi, RadarrMovie } from '../src/api/radarr';
import { sonarrApi, SonarrSeries } from '../src/api/sonarr';
import { TMDB_STUDIOS, tmdbApi, tmdbImageUrl, TmdbMovie, TmdbSearchResult, TmdbTv, TmdbWatchProvider } from '../src/api/tmdb';
import { ServiceConfig } from '../src/api/types';
import { DiscoverCardItem, DiscoverRow } from '../src/components/DiscoverRow';
import { LogoRow, LogoRowItem } from '../src/components/LogoRow';
import { SwipeTabBar } from '../src/components/SwipeTabBar';
import { useServers } from '../src/context/ServersContext';
import { useSectionNames } from '../src/context/SectionNamesContext';
import { alert } from '../src/lib/alert';
import { deletedLibrary } from '../src/lib/deletedLibrary';
import { getCachedProviders, getCachedStudios, setCachedProviders, setCachedStudios } from '../src/lib/discoverCache';
import { FALLBACK_WATCH_REGION, getDefaultRegion, getLastQualityProfileId, setLastQualityProfileId } from '../src/lib/preferences';
import {
  CATEGORY_LABELS,
  DiscoverCategory,
  DiscoverMediaFilter,
  fetchDiscoverCategory,
  interleave,
  MediaKind,
  resolveMediaKind,
} from '../src/lib/discoverCategories';
import { badgeForMovie, badgeForSeries, buildLibraryIndex, EMPTY_LIBRARY_INDEX, LibraryIndex } from '../src/lib/libraryStatus';
import { useContentWidth } from '../src/lib/responsive';
import { useTabBarClearance } from '../src/lib/tabBarClearance';
import { HeaderTitle } from '../src/components/HeaderTitle';
import { SECTION_META } from '../src/lib/sectionMeta';
import { colors } from '../src/theme/colors';

// Main Discover screen: universal search with quick-add, plus three
// swipeable tabs (All/Movies/TV Shows, matching the same SwipeTabBar +
// paged Animated.ScrollView pattern Movies/TV Shows/Torrents/etc. already
// use) - each showing a Recently Added row sourced from the real Radarr/
// Sonarr library, and capped preview rows for Trending/Popular/Upcoming
// (Movies also gets Recently Released, movie-only - see
// discoverCategories.ts). "All" shows genuinely mixed movie+TV content:
// Trending via TMDB's own combined endpoint, Popular/Upcoming interleaved
// client-side from separate movie+TV calls, Recently Added merged by real
// date across both libraries. All is both the default tab and the only one
// loaded eagerly; Movies/TV Shows lazy-load on first swipe to them.
const PREVIEW_COUNT = 15;
const PROVIDER_PREVIEW_COUNT = 20;
const CATEGORIES: DiscoverCategory[] = ['trending', 'popular', 'upcoming'];
const TABS = ['All', 'Movies', 'TV Shows'] as const;

interface CategoryData {
  trending: (TmdbMovie | TmdbTv)[];
  popular: (TmdbMovie | TmdbTv)[];
  upcoming: (TmdbMovie | TmdbTv)[];
  recent: (TmdbMovie | TmdbTv)[];
}
const EMPTY_CATEGORY_DATA: CategoryData = { trending: [], popular: [], upcoming: [], recent: [] };

// Movies/TV Shows tabs - a single-type array, same shape as before this
// screen had an "All" tab at all.
function toCardItems(items: (TmdbMovie | TmdbTv)[], type: MediaKind, library: LibraryIndex): DiscoverCardItem[] {
  return items.slice(0, PREVIEW_COUNT).map((item) => ({
    id: item.id,
    title: type === 'movie' ? (item as TmdbMovie).title : (item as TmdbTv).name,
    posterUrl: tmdbImageUrl(item.poster_path),
    rating: item.vote_average,
    badge: type === 'movie' ? badgeForMovie(item.id, library) : badgeForSeries(item.id, library),
  }));
}

// "All" tab's mixed-array counterpart - tags each card with its own
// resolved type so DiscoverRow's onPressItem can route it correctly.
function toMixedCardItems(items: (TmdbMovie | TmdbTv)[], library: LibraryIndex): DiscoverCardItem[] {
  return items.slice(0, PREVIEW_COUNT).map((item) => {
    const type = resolveMediaKind(item);
    return {
      id: item.id,
      title: type === 'movie' ? (item as TmdbMovie).title : (item as TmdbTv).name,
      posterUrl: tmdbImageUrl(item.poster_path),
      rating: item.vote_average,
      badge: type === 'movie' ? badgeForMovie(item.id, library) : badgeForSeries(item.id, library),
      mediaType: type,
    };
  });
}

// Sourced from Radarr/Sonarr's own `added` timestamp (not TMDB), sorted
// newest-first and capped the same way the TMDB preview rows are.
function toLocalMovieCardItems(movies: RadarrMovie[]): DiscoverCardItem[] {
  return [...movies]
    .filter((m) => m.added)
    .sort((a, b) => new Date(b.added!).getTime() - new Date(a.added!).getTime())
    .slice(0, PREVIEW_COUNT)
    .map((m) => ({
      id: m.id,
      title: m.title,
      posterUrl: m.images.find((i) => i.coverType === 'poster')?.remoteUrl,
      rating: m.ratings?.imdb?.value,
    }));
}

function toLocalSeriesCardItems(series: SonarrSeries[]): DiscoverCardItem[] {
  return [...series]
    .filter((s) => s.added)
    .sort((a, b) => new Date(b.added!).getTime() - new Date(a.added!).getTime())
    .slice(0, PREVIEW_COUNT)
    .map((s) => ({
      id: s.id,
      title: s.title,
      posterUrl: s.images.find((i) => i.coverType === 'poster')?.remoteUrl,
      rating: s.ratings?.value,
    }));
}

function providersToItems(providers: TmdbWatchProvider[]): LogoRowItem[] {
  return providers.slice(0, PROVIDER_PREVIEW_COUNT).map((p) => ({
    id: p.provider_id,
    name: p.provider_name,
    logoUrl: tmdbImageUrl(p.logo_path, 'w185'),
  }));
}

// Cache-first: a region's streaming catalog doesn't change minute to
// minute, so a warm cache hit turns this into a local AsyncStorage read
// instead of a real TMDB round-trip - the "All" tab's own load function
// calls this on *every* focus (same as it already did for Trending/Popular/
// Upcoming before Streaming Service existed), so this is what actually
// keeps repeat visits fast (see discoverCache.ts's own header comment for
// the full story on why this was added).
async function loadProviders(config: ServiceConfig, mediaType: 'movie' | 'tv', region: string): Promise<LogoRowItem[]> {
  const cached = await getCachedProviders(mediaType, region);
  if (cached) return cached;
  const fresh = await tmdbApi.watchProviders(config, mediaType, region).catch(() => [] as TmdbWatchProvider[]);
  const items = providersToItems(fresh);
  if (items.length > 0) setCachedProviders(mediaType, region, items);
  return items;
}

// "All" tab's Streaming Service row merges both catalogs (deduped by id -
// the same service carries the same provider id across movie/tv catalogs
// in the same region) since a single row has to represent both.
function mergeProviderItems(a: LogoRowItem[], b: LogoRowItem[]): LogoRowItem[] {
  const seen = new Set<number>();
  return [...a, ...b].filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

// "All" tab's Recently Added - true chronological merge of both libraries by
// their real `added` timestamp (not alternating, unlike Popular/Upcoming
// below - both already carry a real added date to sort by).
function toMixedLocalCardItems(movies: RadarrMovie[], series: SonarrSeries[]): DiscoverCardItem[] {
  const tagged = [
    ...movies
      .filter((m) => m.added)
      .map((m) => ({
        id: m.id,
        title: m.title,
        added: m.added!,
        posterUrl: m.images.find((i) => i.coverType === 'poster')?.remoteUrl,
        rating: m.ratings?.imdb?.value,
        mediaType: 'movie' as const,
      })),
    ...series
      .filter((s) => s.added)
      .map((s) => ({
        id: s.id,
        title: s.title,
        added: s.added!,
        posterUrl: s.images.find((i) => i.coverType === 'poster')?.remoteUrl,
        rating: s.ratings?.value,
        mediaType: 'tv' as const,
      })),
  ];
  tagged.sort((a, b) => new Date(b.added).getTime() - new Date(a.added).getTime());
  return tagged.slice(0, PREVIEW_COUNT);
}

export default function DiscoverScreen() {
  const { names } = useSectionNames();
  const { servers } = useServers();
  const config = servers.tmdb;
  const radarrConfig = servers.radarr;
  const sonarrConfig = servers.sonarr;
  const tabBarClearance = useTabBarClearance();
  const width = useContentWidth();
  const scrollRef = useRef<ScrollView>(null);
  const scrollX = useSharedValue(0);
  const onPagerScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });
  const [activeTab, setActiveTab] = useState(0);

  const [allCategories, setAllCategories] = useState<CategoryData>(EMPTY_CATEGORY_DATA);
  const [movieCategories, setMovieCategories] = useState<CategoryData>(EMPTY_CATEGORY_DATA);
  const [tvCategories, setTvCategories] = useState<CategoryData>(EMPTY_CATEGORY_DATA);
  const [loadingAll, setLoadingAll] = useState(false);
  const [loadingMovies, setLoadingMovies] = useState(false);
  const [loadingTv, setLoadingTv] = useState(false);
  const [errorAll, setErrorAll] = useState<string | null>(null);
  const [errorMovies, setErrorMovies] = useState<string | null>(null);
  const [errorTv, setErrorTv] = useState<string | null>(null);
  const movieLoaded = useRef(false);
  const tvLoaded = useRef(false);

  // Streaming Service / Studios rows (all 3 tabs). Providers are region+
  // media-type scoped so each tab fetches its own; Studios is a fixed
  // curated list (`TMDB_STUDIOS`) with real logos resolved once and shared
  // across all three tabs. Region comes from Settings > TMDB (Discover) >
  // Default Region (`FALLBACK_WATCH_REGION` only until that loads) - loadAll/
  // loadMovies/loadTv all depend on it, so the one-time async load
  // transitioning from the fallback to the real saved value naturally
  // triggers a re-fetch with the correct region once it resolves.
  const [region, setRegion] = useState(FALLBACK_WATCH_REGION);
  useEffect(() => {
    getDefaultRegion().then(setRegion);
  }, []);

  const [allProviders, setAllProviders] = useState<LogoRowItem[]>([]);
  const [movieProviders, setMovieProviders] = useState<LogoRowItem[]>([]);
  const [tvProviders, setTvProviders] = useState<LogoRowItem[]>([]);
  const [studioItems, setStudioItems] = useState<LogoRowItem[]>([]);
  const studiosLoaded = useRef(false);

  useEffect(() => {
    if (!config || studiosLoaded.current) return;
    studiosLoaded.current = true;
    // Cache-first: a studio's logo essentially never changes, so this skips
    // all 14 real `/company/{id}` calls entirely once cached.
    getCachedStudios().then((cached) => {
      if (cached) {
        setStudioItems(cached);
        return;
      }
      Promise.all(TMDB_STUDIOS.map((s) => tmdbApi.company(config, s.id).catch(() => ({ id: s.id, name: s.name, logo_path: undefined }))))
        .then((companies) => {
          const items = companies.map((c) => ({ id: c.id, name: c.name, logoUrl: tmdbImageUrl(c.logo_path, 'w185') }));
          setStudioItems(items);
          setCachedStudios(items);
        })
        .catch(() => {});
    });
  }, [config]);

  const [libraryMovies, setLibraryMovies] = useState<RadarrMovie[]>([]);
  const [librarySeries, setLibrarySeries] = useState<SonarrSeries[]>([]);
  const [library, setLibrary] = useState<LibraryIndex>(EMPTY_LIBRARY_INDEX);

  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<TmdbSearchResult[]>([]);
  const [quickAddBusy, setQuickAddBusy] = useState<Set<string>>(new Set());
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // "All" tab: Trending uses TMDB's real combined endpoint; Popular/Upcoming
  // have no combined equivalent, so both types are fetched in parallel and
  // interleaved client-side. Recently Released has no cross-media equivalent
  // and is intentionally omitted here (recent stays []).
  const loadAll = useCallback(async () => {
    if (!config) return;
    setLoadingAll(true);
    setErrorAll(null);
    try {
      const [trendingRes, popularMovies, popularTv, upcomingMovies, upcomingTv, movieProv, tvProv] = await Promise.all([
        tmdbApi.trendingAll(config, 'week', 1),
        tmdbApi.popularMovies(config, 1),
        tmdbApi.popularTv(config, 1),
        tmdbApi.upcomingMovies(config, 1),
        tmdbApi.upcomingTv(config, 1),
        // Cache-first (see loadProviders) - this fires on *every* focus, so
        // a warm cache is what keeps repeat visits from re-hitting TMDB for
        // data that barely changes.
        loadProviders(config, 'movie', region),
        loadProviders(config, 'tv', region),
      ]);
      setAllCategories({
        trending: trendingRes.results.filter((r) => r.media_type !== 'person'),
        popular: interleave<TmdbMovie | TmdbTv>(popularMovies.results, popularTv.results),
        upcoming: interleave<TmdbMovie | TmdbTv>(upcomingMovies.results, upcomingTv.results),
        recent: [],
      });
      setAllProviders(mergeProviderItems(movieProv, tvProv));
    } catch (e) {
      setErrorAll(e instanceof Error ? e.message : 'Failed to load Discover');
    } finally {
      setLoadingAll(false);
    }
  }, [config, region]);

  const loadMovies = useCallback(async () => {
    if (!config) return;
    setLoadingMovies(true);
    setErrorMovies(null);
    try {
      const [[t, p, u], r, providers] = await Promise.all([
        Promise.all(CATEGORIES.map((c) => fetchDiscoverCategory(config, c, 'movie', 1))),
        fetchDiscoverCategory(config, 'recent', 'movie', 1),
        loadProviders(config, 'movie', region),
      ]);
      setMovieCategories({ trending: t.results, popular: p.results, upcoming: u.results, recent: r.results });
      setMovieProviders(providers);
    } catch (e) {
      setErrorMovies(e instanceof Error ? e.message : 'Failed to load Movies');
    } finally {
      setLoadingMovies(false);
    }
  }, [config, region]);

  const loadTv = useCallback(async () => {
    if (!config) return;
    setLoadingTv(true);
    setErrorTv(null);
    try {
      const [[t, p, u], providers] = await Promise.all([
        Promise.all(CATEGORIES.map((c) => fetchDiscoverCategory(config, c, 'tv', 1))),
        loadProviders(config, 'tv', region),
      ]);
      setTvCategories({ trending: t.results, popular: p.results, upcoming: u.results, recent: [] });
      setTvProviders(providers);
    } catch (e) {
      setErrorTv(e instanceof Error ? e.message : 'Failed to load TV Shows');
    } finally {
      setLoadingTv(false);
    }
  }, [config, region]);

  // Loads the real Radarr/Sonarr library (for the Recently Added rows) and
  // rebuilds the tmdbId-keyed library index (for poster status badges) -
  // each service's library fetch independently falls back to an empty list
  // on failure so a misconfigured/offline service doesn't block the other.
  const loadLibrary = useCallback(async () => {
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
      loadAll();
    }, [loadAll])
  );

  useFocusEffect(
    useCallback(() => {
      loadLibrary();
    }, [loadLibrary])
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

  const openDiscoverItem = (id: number, mediaType: MediaKind) => router.push(`/discover/${mediaType}/${id}`);
  const openLocalItem = (id: number, mediaType: MediaKind) => router.push(mediaType === 'movie' ? `/movie/${id}` : `/series/${id}`);
  const openCategory = (category: DiscoverCategory, mediaType: DiscoverMediaFilter) =>
    router.push(`/discover/category/${category}?mediaType=${mediaType}`);

  // Lands directly on the (pre-filtered) category screen rather than an
  // unfiltered one - "popular" is the underlying category since neither
  // concept has a "trending"/"upcoming" equivalent, but the screen shows
  // the provider/studio name as its title instead once deep-linked in like
  // this (see app/discover/category/[category].tsx).
  const openProvider = (item: LogoRowItem, mediaType: DiscoverMediaFilter) =>
    router.push(`/discover/category/popular?mediaType=${mediaType}&providerId=${item.id}&providerName=${encodeURIComponent(item.name)}`);
  // Always movie mediaType regardless of which tab the row is shown on -
  // TMDB's studio/production-company filter only ever applies to movies.
  const openStudio = (item: LogoRowItem) =>
    router.push(`/discover/category/popular?mediaType=movie&studioId=${item.id}&studioName=${encodeURIComponent(item.name)}`);

  // Central place to react to the active tab changing (tap or swipe). All
  // (index 0) is loaded eagerly on every focus above; Movies/TV Shows lazy-
  // load once on first activation, same pattern as movies.tsx/index.tsx.
  const handleTabChange = (index: number) => {
    if (index !== activeTab && query) setQuery('');
    setActiveTab(index);
    if (index === 1 && !movieLoaded.current) {
      movieLoaded.current = true;
      loadMovies();
    }
    if (index === 2 && !tvLoaded.current) {
      tvLoaded.current = true;
      loadTv();
    }
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    handleTabChange(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  const goToTab = (index: number) => {
    handleTabChange(index);
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
  };

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.textPrimary,
          headerTitleAlign: 'left',
          headerTitle: () => <HeaderTitle icon={SECTION_META.discover.icon} tint={SECTION_META.discover.tint} title={names.discover} />,
        }}
      />
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
          <View style={styles.tabBarRow}>
            <View style={styles.tabBar}>
              <SwipeTabBar
                tabs={TABS}
                activeTab={activeTab}
                onChange={goToTab}
                onSettle={handleTabChange}
                scrollX={scrollX}
                pageWidth={width}
                tint={colors.sectionGreen}
              />
            </View>
          </View>

          <Animated.ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            snapToInterval={width}
            decelerationRate="fast"
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={onMomentumEnd}
            onScroll={onPagerScroll}
            scrollEventThrottle={16}
            style={styles.pager}
          >
            {/* All */}
            <View style={[styles.page, { width }]}>
              {loadingAll && allCategories.trending.length === 0 ? (
                <ActivityIndicator color={colors.sectionGreen} style={{ marginTop: 40 }} />
              ) : (
                <ScrollView
                  contentContainerStyle={{ paddingBottom: tabBarClearance }}
                  refreshControl={<RefreshControl tintColor={colors.sectionGreen} refreshing={loadingAll} onRefresh={loadAll} />}
                >
                  {errorAll ? <Text style={styles.error}>{errorAll}</Text> : null}
                  <DiscoverRow
                    title="Recently Added"
                    items={toMixedLocalCardItems(libraryMovies, librarySeries)}
                    onPressItem={(id, t) => openLocalItem(id, t!)}
                  />
                  <DiscoverRow
                    title={CATEGORY_LABELS.trending}
                    items={toMixedCardItems(allCategories.trending, library)}
                    onPressItem={(id, t) => openDiscoverItem(id, t!)}
                    onPressTitle={() => openCategory('trending', 'all')}
                  />
                  <DiscoverRow
                    title={CATEGORY_LABELS.popular}
                    items={toMixedCardItems(allCategories.popular, library)}
                    onPressItem={(id, t) => openDiscoverItem(id, t!)}
                    onPressTitle={() => openCategory('popular', 'all')}
                  />
                  <DiscoverRow
                    title={CATEGORY_LABELS.upcoming}
                    items={toMixedCardItems(allCategories.upcoming, library)}
                    onPressItem={(id, t) => openDiscoverItem(id, t!)}
                    onPressTitle={() => openCategory('upcoming', 'all')}
                  />
                  <LogoRow title="Streaming Service" items={allProviders} onPressItem={(item) => openProvider(item, 'all')} />
                  {/* White tile background - studio logos are dark ink on
                      transparent artwork, meant for a light page, and are
                      nearly invisible on this app's default dark tile. */}
                  <LogoRow title="Studios" items={studioItems} onPressItem={openStudio} logoBackground="#FFFFFF" />
                  <View style={{ height: 32 }} />
                </ScrollView>
              )}
            </View>

            {/* Movies - same content as before this screen had swipeable tabs */}
            <View style={[styles.page, { width }]}>
              {loadingMovies && movieCategories.trending.length === 0 ? (
                <ActivityIndicator color={colors.sectionGreen} style={{ marginTop: 40 }} />
              ) : (
                <ScrollView
                  contentContainerStyle={{ paddingBottom: tabBarClearance }}
                  refreshControl={<RefreshControl tintColor={colors.sectionGreen} refreshing={loadingMovies} onRefresh={loadMovies} />}
                >
                  {errorMovies ? <Text style={styles.error}>{errorMovies}</Text> : null}
                  <DiscoverRow title="Recently Added" items={toLocalMovieCardItems(libraryMovies)} onPressItem={(id) => openLocalItem(id, 'movie')} />
                  {CATEGORIES.map((category) => (
                    <DiscoverRow
                      key={category}
                      title={CATEGORY_LABELS[category]}
                      items={toCardItems(movieCategories[category], 'movie', library)}
                      onPressItem={(id) => openDiscoverItem(id, 'movie')}
                      onPressTitle={() => openCategory(category, 'movie')}
                    />
                  ))}
                  <DiscoverRow
                    title={CATEGORY_LABELS.recent}
                    items={toCardItems(movieCategories.recent, 'movie', library)}
                    onPressItem={(id) => openDiscoverItem(id, 'movie')}
                    onPressTitle={() => openCategory('recent', 'movie')}
                  />
                  <LogoRow title="Streaming Service" items={movieProviders} onPressItem={(item) => openProvider(item, 'movie')} />
                  {/* White tile background - studio logos are dark ink on
                      transparent artwork, meant for a light page, and are
                      nearly invisible on this app's default dark tile. */}
                  <LogoRow title="Studios" items={studioItems} onPressItem={openStudio} logoBackground="#FFFFFF" />
                  <View style={{ height: 32 }} />
                </ScrollView>
              )}
            </View>

            {/* TV Shows - same content as before this screen had swipeable tabs */}
            <View style={[styles.page, { width }]}>
              {loadingTv && tvCategories.trending.length === 0 ? (
                <ActivityIndicator color={colors.sectionGreen} style={{ marginTop: 40 }} />
              ) : (
                <ScrollView
                  contentContainerStyle={{ paddingBottom: tabBarClearance }}
                  refreshControl={<RefreshControl tintColor={colors.sectionGreen} refreshing={loadingTv} onRefresh={loadTv} />}
                >
                  {errorTv ? <Text style={styles.error}>{errorTv}</Text> : null}
                  <DiscoverRow title="Recently Added" items={toLocalSeriesCardItems(librarySeries)} onPressItem={(id) => openLocalItem(id, 'tv')} />
                  {CATEGORIES.map((category) => (
                    <DiscoverRow
                      key={category}
                      title={CATEGORY_LABELS[category]}
                      items={toCardItems(tvCategories[category], 'tv', library)}
                      onPressItem={(id) => openDiscoverItem(id, 'tv')}
                      onPressTitle={() => openCategory(category, 'tv')}
                    />
                  ))}
                  <LogoRow title="Streaming Service" items={tvProviders} onPressItem={(item) => openProvider(item, 'tv')} />
                  <View style={{ height: 32 }} />
                </ScrollView>
              )}
            </View>
          </Animated.ScrollView>
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
  // 16px avoids iOS Safari's auto-zoom-on-focus for small inputs - see movies.tsx.
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 16 },
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
  tabBarRow: { flexDirection: 'row', alignItems: 'center' },
  tabBar: { flex: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  pager: { flex: 1 },
  page: { flex: 1 },
  error: { color: colors.danger, marginHorizontal: 16, marginTop: 12 },
});
