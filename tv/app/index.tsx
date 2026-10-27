// TV home = the phone's Discover (app/discover.tsx): All / Movies / TV Shows tabs; Recently Added from
// the library, TMDB Trending / Popular / Upcoming (and Recently Released for movies), Streaming Service
// and Studios logo rows, with the phone's library status badges. Rows, caches and region come from
// the same shared modules the phone uses (src/lib/discoverRows, discoverCategories, discoverCache,
// libraryStatus), so both apps show the same thing. Music is tv/components/MusicDiscover; the Search
// button first in the tab row opens /discover/search (movies & TV on TMDB, artists on Last.fm).
import { Ionicons } from '@expo/vector-icons';
import { Redirect, router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { radarrApi, RadarrMovie } from '../../src/api/radarr';
import { sonarrApi, SonarrSeries } from '../../src/api/sonarr';
import { TMDB_STUDIOS, tmdbApi, tmdbImageUrl, TmdbMovie, TmdbTv } from '../../src/api/tmdb';
import { DiscoverCardItem } from '../../src/components/DiscoverRow';
import { LogoRowItem } from '../../src/components/LogoRow';
import { getCachedStudios, setCachedStudios } from '../../src/lib/discoverCache';
import { CATEGORY_LABELS, DiscoverCategory, DiscoverMediaFilter, fetchDiscoverCategory, interleave, MediaKind } from '../../src/lib/discoverCategories';
import {
  loadProviders,
  mergeProviderItems,
  toCardItems,
  toLocalMovieCardItems,
  toLocalSeriesCardItems,
  toMixedCardItems,
  toMixedLocalCardItems,
} from '../../src/lib/discoverRows';
import { buildLibraryIndex, EMPTY_LIBRARY_INDEX, LibraryIndex } from '../../src/lib/libraryStatus';
import { FALLBACK_WATCH_REGION, getDefaultRegion } from '../../src/lib/preferences';
import { colors } from '../../src/theme/colors';
import { DiscoverPosterRow, LogoTileRow } from '../components/DiscoverRows';
import { FocusCard } from '../components/FocusCard';
import { MusicDiscover } from '../components/MusicDiscover';
import { ROW_SIDE_PADDING } from '../components/Row';
import { Shell } from '../components/Shell';
import { useEnabledServers } from '../lib/useEnabledServers';
import { TV_LIST } from '../components/ui';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'movie', label: 'Movies' },
  { id: 'tv', label: 'TV Shows' },
  { id: 'music', label: 'Music' },
] as const;
type Tab = (typeof TABS)[number]['id'];
type MediaTab = Exclude<Tab, 'music'>;
const CATEGORIES: DiscoverCategory[] = ['trending', 'popular', 'upcoming'];

interface TabData {
  categories: Record<DiscoverCategory, (TmdbMovie | TmdbTv)[]>;
  providers: LogoRowItem[];
}

export default function TvDiscover() {
  const { servers, ready } = useEnabledServers();
  const config = servers.tmdb;
  const [tab, setTab] = useState<Tab>('all');
  const [data, setData] = useState<Partial<Record<MediaTab, TabData>>>({});
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState(FALLBACK_WATCH_REGION);
  const [studios, setStudios] = useState<LogoRowItem[]>([]);
  const [movies, setMovies] = useState<RadarrMovie[]>([]);
  const [series, setSeries] = useState<SonarrSeries[]>([]);
  const [library, setLibrary] = useState<LibraryIndex>(EMPTY_LIBRARY_INDEX);
  const loading = useRef<Set<MediaTab>>(new Set());

  useEffect(() => {
    getDefaultRegion().then(setRegion).catch(() => {});
  }, []);

  // A tab's rows, the way the phone's loadAll / loadMovies / loadTv build them.
  const loadTab = useCallback(
    async (which: MediaTab) => {
      if (!config || loading.current.has(which)) return;
      loading.current.add(which);
      try {
        let next: TabData;
        if (which === 'all') {
          const [trending, popM, popT, upM, upT, movieProv, tvProv] = await Promise.all([
            tmdbApi.trendingAll(config, 'week', 1),
            tmdbApi.popularMovies(config, 1),
            tmdbApi.popularTv(config, 1),
            tmdbApi.upcomingMovies(config, 1),
            tmdbApi.upcomingTv(config, 1),
            loadProviders(config, 'movie', region),
            loadProviders(config, 'tv', region),
          ]);
          next = {
            categories: {
              trending: trending.results.filter((r) => r.media_type !== 'person'),
              popular: interleave<TmdbMovie | TmdbTv>(popM.results, popT.results),
              upcoming: interleave<TmdbMovie | TmdbTv>(upM.results, upT.results),
              recent: [],
            },
            providers: mergeProviderItems(movieProv, tvProv),
          };
        } else {
          const [[t, p, u], recent, providers] = await Promise.all([
            Promise.all(CATEGORIES.map((c) => fetchDiscoverCategory(config, c, which, 1))),
            which === 'movie' ? fetchDiscoverCategory(config, 'recent', 'movie', 1) : Promise.resolve({ results: [] }),
            loadProviders(config, which, region),
          ]);
          next = { categories: { trending: t.results, popular: p.results, upcoming: u.results, recent: recent.results }, providers };
        }
        setData((d) => ({ ...d, [which]: next }));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load Discover');
      } finally {
        loading.current.delete(which);
      }
    },
    [config, region]
  );

  useEffect(() => {
    if (ready && config && tab !== 'music') loadTab(tab);
  }, [ready, config, tab, loadTab]);

  // The library, for Recently Added and the poster badges.
  useEffect(() => {
    if (!ready) return;
    (async () => {
      const [m, s] = await Promise.all([
        servers.radarr ? radarrApi.getMovies(servers.radarr).catch(() => [] as RadarrMovie[]) : Promise.resolve([] as RadarrMovie[]),
        servers.sonarr ? sonarrApi.getSeries(servers.sonarr).catch(() => [] as SonarrSeries[]) : Promise.resolve([] as SonarrSeries[]),
      ]);
      setMovies(m);
      setSeries(s);
      buildLibraryIndex({ tmdbConfig: config, radarrConfig: servers.radarr, sonarrConfig: servers.sonarr, movies: m, series: s })
        .then(setLibrary)
        .catch(() => {});
    })();
  }, [ready, config, servers.radarr, servers.sonarr]);

  // Studios: a fixed list whose logos are resolved once and cached, as on the phone.
  useEffect(() => {
    if (!config) return;
    getCachedStudios().then((cached) => {
      if (cached) return setStudios(cached);
      Promise.all(TMDB_STUDIOS.map((s) => tmdbApi.company(config, s.id).catch(() => ({ id: s.id, name: s.name, logo_path: undefined }))))
        .then((companies) => {
          const items = companies.map((c) => ({ id: c.id, name: c.name, logoUrl: tmdbImageUrl(c.logo_path, 'w185') }));
          setStudios(items);
          setCachedStudios(items);
        })
        .catch(() => {});
    });
  }, [config]);

  if (ready && !config) {
    // No TMDB key in this profile: Discover has nothing to show; TV Shows is the useful place to land.
    return servers.sonarr ? <Redirect href="/shows" /> : <Redirect href="/setup" />;
  }

  const current = tab === 'music' ? undefined : data[tab];
  const openTmdb = (item: DiscoverCardItem, type: MediaKind) => router.push(`/discover/${item.mediaType ?? type}/${item.id}` as never);
  const openLocal = (item: DiscoverCardItem, type: MediaKind) =>
    router.push(((item.mediaType ?? type) === 'movie' ? `/movies/${item.id}` : `/shows/${item.id}`) as never);
  const seeAll = (category: DiscoverCategory, mediaType: DiscoverMediaFilter) =>
    router.push(`/discover/category?category=${category}&mediaType=${mediaType}` as never);
  const openProvider = (p: LogoRowItem, mediaType: DiscoverMediaFilter) =>
    router.push(`/discover/category?category=popular&mediaType=${mediaType}&providerId=${p.id}&providerName=${encodeURIComponent(p.name)}` as never);
  const openStudio = (s: LogoRowItem) =>
    router.push(`/discover/category?category=popular&mediaType=movie&studioId=${s.id}&studioName=${encodeURIComponent(s.name)}` as never);

  const recentlyAdded =
    tab === 'all' ? toMixedLocalCardItems(movies, series) : tab === 'movie' ? toLocalMovieCardItems(movies) : toLocalSeriesCardItems(series);
  const rowItems = (category: DiscoverCategory) =>
    !current || tab === 'music' ? [] : tab === 'all' ? toMixedCardItems(current.categories[category], library) : toCardItems(current.categories[category], tab, library);
  const localType: MediaKind = tab === 'tv' ? 'tv' : 'movie';

  return (
    <Shell active="discover">
      <View style={styles.tabs}>
        <FocusCard radius={18} scale={1.05} style={[styles.tab, styles.search]} onPress={() => router.push(`/discover/search?music=${tab === 'music' ? 1 : 0}` as never)}>
          <Ionicons name="search" size={16} color={colors.textPrimary} />
          <Text style={styles.tabText}>Search</Text>
        </FocusCard>
        {TABS.map((t) => {
          const on = t.id === tab;
          return (
            <FocusCard key={t.id} radius={18} scale={1.05} style={[styles.tab, on && styles.tabOn]} onPress={() => setTab(t.id)}>
              <Text style={[styles.tabText, on && { color: colors.background }]}>{t.label}</Text>
            </FocusCard>
          );
        })}
      </View>

      {tab === 'music' ? (
        <MusicDiscover />
      ) : !current ? (
        <View style={styles.loading}>
          {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.sectionGreen} size="large" />}
        </View>
      ) : (
        <ScrollView {...TV_LIST} key={tab} contentContainerStyle={styles.rows} showsVerticalScrollIndicator={false}>
          <DiscoverPosterRow title="Recently Added" items={recentlyAdded} onPressItem={(i) => openLocal(i, localType)} preferredFocus />
          {CATEGORIES.map((c) => (
            <DiscoverPosterRow key={c} title={CATEGORY_LABELS[c]} items={rowItems(c)} onPressItem={(i) => openTmdb(i, localType)} onSeeAll={() => seeAll(c, tab as MediaTab)} />
          ))}
          {tab === 'movie' && (
            <DiscoverPosterRow title={CATEGORY_LABELS.recent} items={rowItems('recent')} onPressItem={(i) => openTmdb(i, 'movie')} onSeeAll={() => seeAll('recent', 'movie')} />
          )}
          <LogoTileRow title="Streaming Service" items={current.providers} onPressItem={(p) => openProvider(p, tab as MediaTab)} />
          {tab !== 'tv' && <LogoTileRow title="Studios" items={studios} onPressItem={openStudio} light />}
        </ScrollView>
      )}
    </Shell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  tabs: { flexDirection: 'row', gap: 10, paddingHorizontal: ROW_SIDE_PADDING, marginTop: 22, marginBottom: 4 },
  tab: { paddingHorizontal: 18, paddingVertical: 7, backgroundColor: colors.surfaceAlt },
  tabOn: { backgroundColor: colors.sectionGreen },
  tabText: { color: colors.textPrimary, fontSize: 14, fontWeight: '700' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 8 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  error: { color: colors.danger, fontSize: 15 },
  rows: { paddingTop: 4, paddingBottom: 40 },
});
