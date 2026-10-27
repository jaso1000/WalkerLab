// A Discover "See all" grid on the TV - a category (Trending/Popular/Upcoming/Recently Released) or
// a Streaming Service / Studio, like the phone's app/discover/category/[category]. Category pages
// page through fetchDiscoverCategory; provider and studio pages run TMDB /discover with the same
// buildDiscoverParams the phone's filter sheet uses (sorted by popularity, provider results in the
// profile's default TMDB region). More pages load as focus nears the end of the grid. Sort, Genre and
// Rating chips above the grid stand in for the phone's filter sheet; choosing any of them switches a
// category page to TMDB /discover too, as applying filters does on the phone.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { radarrApi } from '../../../src/api/radarr';
import { sonarrApi } from '../../../src/api/sonarr';
import { TmdbGenre, tmdbApi, TmdbMovie, TmdbTv } from '../../../src/api/tmdb';
import { alert } from '../../../src/lib/alert';
import { DiscoverCardItem } from '../../../src/components/DiscoverRow';
import { CATEGORY_LABELS, dedupeById, DiscoverCategory, DiscoverMediaFilter, fetchDiscoverCategory, interleave } from '../../../src/lib/discoverCategories';
import { buildDiscoverParams, DEFAULT_SORT, DiscoverFilters, EMPTY_FILTERS, SORT_OPTIONS, SortChoice } from '../../../src/lib/discoverFilters';
import { PREVIEW_COUNT, toCardItems, toMixedCardItems } from '../../../src/lib/discoverRows';
import { buildLibraryIndex, EMPTY_LIBRARY_INDEX, LibraryIndex } from '../../../src/lib/libraryStatus';
import { getDefaultRegion } from '../../../src/lib/preferences';
import { colors } from '../../../src/theme/colors';
import { POSTER_W, PosterTile } from '../../components/Cards';
import { ROW_SIDE_PADDING } from '../../components/Row';
import { Chip, ListFrame, SNAP_CELL, TV_GRID } from '../../components/ui';
import { useEnabledServers } from '../../lib/useEnabledServers';

const COLUMNS = 5;
const GAP = 18;
const MEDIA_LABEL: Record<DiscoverMediaFilter, string> = { all: '', movie: 'Movies', tv: 'TV Shows' };

type Item = TmdbMovie | TmdbTv;
type Page = { results: Item[]; total_pages: number };

export default function TvDiscoverCategory() {
  const params = useLocalSearchParams<{
    category: DiscoverCategory;
    mediaType: DiscoverMediaFilter;
    providerId?: string;
    providerName?: string;
    studioId?: string;
    studioName?: string;
  }>();
  const category = params.category ?? 'popular';
  const mediaType = params.mediaType ?? 'all';
  const { servers, ready } = useEnabledServers();
  const config = servers.tmdb;
  const [items, setItems] = useState<Item[]>([]);
  const [library, setLibrary] = useState<LibraryIndex>(EMPTY_LIBRARY_INDEX);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const page = useRef(0);
  const totalPages = useRef(1);
  const busy = useRef(false);
  const gen = useRef(0);
  const [sort, setSort] = useState<SortChoice>(DEFAULT_SORT);
  const [genre, setGenre] = useState<string | null>(null);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [genres, setGenres] = useState<{ movie: TmdbGenre[]; tv: TmdbGenre[] } | null>(null);
  const userFiltered = sort !== DEFAULT_SORT || !!genre || minRating != null;

  const filtered = !!(params.providerId || params.studioId) || userFiltered;

  const fetchPage = useCallback(
    async (n: number): Promise<Page> => {
      if (!filtered) return fetchDiscoverCategory(config!, category, mediaType, n);
      const region = await getDefaultRegion();
      const byName = (list: TmdbGenre[] | undefined) => (genre ? (list ?? []).filter((g) => g.name === genre) : []);
      const filters: DiscoverFilters = {
        ...EMPTY_FILTERS,
        sort,
        movieGenres: byName(genres?.movie),
        tvGenres: byName(genres?.tv),
        voteAverageGte: minRating ?? undefined,
        voteCountGte: minRating != null ? 50 : undefined,
        watchProviders: params.providerId ? [{ provider_id: Number(params.providerId), provider_name: params.providerName ?? '' }] : [],
        watchRegion: { iso_3166_1: region } as DiscoverFilters['watchRegion'],
        studio: params.studioId ? ({ id: Number(params.studioId), name: params.studioName ?? '' } as DiscoverFilters['studio']) : undefined,
      };
      // A genre only one side has (TV's "Kids", movies' "Horror") leaves the other side empty.
      const none = Promise.resolve({ results: [] as Item[], total_pages: 0 });
      if (mediaType === 'all') {
        const [m, t] = await Promise.all([
          genre && filters.movieGenres.length === 0 ? none : tmdbApi.discoverMovies(config!, buildDiscoverParams(filters, 'movie'), n),
          genre && filters.tvGenres.length === 0 ? none : tmdbApi.discoverTv(config!, buildDiscoverParams(filters, 'tv'), n),
        ]);
        return { results: interleave<Item>(m.results, t.results), total_pages: Math.max(m.total_pages, t.total_pages) };
      }
      return mediaType === 'movie'
        ? tmdbApi.discoverMovies(config!, buildDiscoverParams(filters, 'movie'), n)
        : tmdbApi.discoverTv(config!, buildDiscoverParams(filters, 'tv'), n);
    },
    [config, category, mediaType, filtered, params.providerId, params.providerName, params.studioId, params.studioName, sort, genre, genres, minRating]
  );

  // `reset` starts over from page 1 (a filter changed); a page still loading for the old filters is dropped.
  const loadMore = useCallback(
    async (reset = false) => {
      if (!config) return;
      if (reset) {
        gen.current += 1;
        page.current = 0;
        totalPages.current = 1;
        busy.current = false;
      }
      if (busy.current || page.current >= totalPages.current) return;
      const g = gen.current;
      busy.current = true;
      try {
        const next = await fetchPage(page.current + 1);
        if (g !== gen.current) return;
        page.current += 1;
        totalPages.current = next.total_pages;
        setItems((prev) => (reset ? dedupeById([], next.results) : [...prev, ...dedupeById(prev, next.results)]));
        setError(null);
      } catch (e) {
        if (g === gen.current) setError(e instanceof Error ? e.message : 'Could not load');
      } finally {
        if (g === gen.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [config, fetchPage]
  );

  useEffect(() => {
    if (!ready || !config) return;
    setLoading(true);
    loadMore(true);
  }, [ready, config, loadMore]);

  const loadGenres = async () => {
    if (genres) return genres;
    const [movie, tv] = await Promise.all([tmdbApi.movieGenres(config!), tmdbApi.tvGenres(config!)]);
    const next = { movie, tv };
    setGenres(next);
    return next;
  };
  const pickGenre = async () => {
    try {
      const g = await loadGenres();
      const names = mediaType === 'movie' ? g.movie.map((x) => x.name) : mediaType === 'tv' ? g.tv.map((x) => x.name) : [...new Set([...g.movie, ...g.tv].map((x) => x.name))].sort();
      alert('Genre', undefined, [{ text: 'Any genre', onPress: () => setGenre(null) }, ...names.map((n) => ({ text: n, onPress: () => setGenre(n) })), { text: 'Cancel', style: 'cancel' as const }]);
    } catch (e) {
      alert('Failed', e instanceof Error ? e.message : 'Could not load genres');
    }
  };

  useEffect(() => {
    if (!ready) return;
    Promise.all([
      servers.radarr ? radarrApi.getMovies(servers.radarr).catch(() => []) : Promise.resolve([]),
      servers.sonarr ? sonarrApi.getSeries(servers.sonarr).catch(() => []) : Promise.resolve([]),
    ])
      .then(([movies, series]) => buildLibraryIndex({ tmdbConfig: config, radarrConfig: servers.radarr, sonarrConfig: servers.sonarr, movies, series }))
      .then(setLibrary)
      .catch(() => {});
  }, [ready, config, servers.radarr, servers.sonarr]);

  const title = params.providerName ?? params.studioName ?? CATEGORY_LABELS[category];
  const all = mapAll(items, library, mediaType);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {MEDIA_LABEL[mediaType] ? <Text style={styles.sub}>{MEDIA_LABEL[mediaType]}</Text> : null}
      </View>
      <View style={styles.filters}>
        <Chip
          icon="swap-vertical"
          label={sort.label}
          on={sort !== DEFAULT_SORT}
          tint={colors.sectionGreen}
          onPress={() => alert('Sort', undefined, [...SORT_OPTIONS.map((o) => ({ text: o.label, onPress: () => setSort(o) })), { text: 'Cancel', style: 'cancel' as const }])}
        />
        <Chip icon="pricetags-outline" label={genre ?? 'Any genre'} on={!!genre} tint={colors.sectionGreen} onPress={pickGenre} />
        <Chip
          icon="star-outline"
          label={minRating != null ? `${minRating}+ rating` : 'Any rating'}
          on={minRating != null}
          tint={colors.sectionGreen}
          onPress={() =>
            alert('Minimum rating', undefined, [
              { text: 'Any rating', onPress: () => setMinRating(null) },
              ...[5, 6, 7, 8].map((r) => ({ text: `${r}+`, onPress: () => setMinRating(r) })),
              { text: 'Cancel', style: 'cancel' as const },
            ])
          }
        />
        {userFiltered ? (
          <Chip
            icon="close"
            label="Clear"
            tint={colors.textSecondary}
            onPress={() => {
              setSort(DEFAULT_SORT);
              setGenre(null);
              setMinRating(null);
            }}
          />
        ) : null}
      </View>
      {loading ? (
        <ActivityIndicator color={colors.sectionGreen} size="large" style={{ marginTop: 60 }} />
      ) : error && items.length === 0 ? (
        <Text style={styles.message}>{error}</Text>
      ) : (
        <ListFrame>
          <FlatList
            {...TV_GRID}
            data={all}
            numColumns={COLUMNS}
            keyExtractor={(i) => `${i.mediaType ?? mediaType}-${i.id}`}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={{ gap: GAP }}
            initialNumToRender={COLUMNS * 4}
            maxToRenderPerBatch={COLUMNS * 2}
            windowSize={7}
            onEndReached={() => loadMore()}
            onEndReachedThreshold={1.5}
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={<Text style={styles.message}>Nothing here.</Text>}
            renderItem={({ item, index }) => (
              <View style={styles.cell} {...SNAP_CELL}>
                <PosterTile
                  title={item.title}
                  poster={item.posterUrl}
                  recyclingKey={`${item.mediaType ?? mediaType}-${item.id}`}
                  badge={item.badge}
                  subtitle={item.rating ? `★ ${item.rating.toFixed(1)}` : undefined}
                  preferredFocus={index === 0}
                  onPress={() => router.push(`/discover/${item.mediaType ?? mediaType}/${item.id}` as never)}
                />
              </View>
            )}
          />
        </ListFrame>
      )}
    </View>
  );
}

/**
 * Every loaded item as a card, through the shared row builders (same titles, posters, ratings and
 * badges as the rows). They cap at a row's preview length, so the grid feeds them in row-sized chunks.
 */
function mapAll(items: Item[], library: LibraryIndex, mediaType: DiscoverMediaFilter): DiscoverCardItem[] {
  const out: DiscoverCardItem[] = [];
  for (let i = 0; i < items.length; i += PREVIEW_COUNT) {
    const chunk = items.slice(i, i + PREVIEW_COUNT);
    out.push(...(mediaType === 'all' ? toMixedCardItems(chunk, library) : toCardItems(chunk, mediaType, library)));
  }
  return out;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: { flexDirection: 'row', alignItems: 'baseline', gap: 14, paddingHorizontal: ROW_SIDE_PADDING, paddingTop: 30, paddingBottom: 6 },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '700' },
  filters: { flexDirection: 'row', gap: 10, paddingHorizontal: ROW_SIDE_PADDING, paddingTop: 8 },
  sub: { color: colors.sectionGreen, fontSize: 17, fontWeight: '600' },
  grid: { paddingHorizontal: ROW_SIDE_PADDING, paddingTop: 14, paddingBottom: 40, gap: 12 },
  cell: { width: POSTER_W, paddingTop: 6 },
  message: { color: colors.textMuted, fontSize: 15, paddingHorizontal: ROW_SIDE_PADDING, marginTop: 30 },
});
