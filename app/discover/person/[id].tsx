import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tmdbApi, tmdbImageUrl, TmdbMovie, TmdbPerson, TmdbPersonCredit, TmdbTv } from '../../../src/api/tmdb';
import { DiscoverFilterSheet } from '../../../src/components/DiscoverFilterSheet';
import { useServers } from '../../../src/context/ServersContext';
import { dedupeById, interleave } from '../../../src/lib/discoverCategories';
import { buildDiscoverParams, countActiveFilters, DiscoverFilters, EMPTY_FILTERS, SORT_OPTIONS } from '../../../src/lib/discoverFilters';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

// Cast & Crew's "tap through to filmography" page - shows a person's bio,
// photo (tappable through to a full-screen gallery of their TMDB photos,
// same interaction as a movie/series poster), and their filmography.
//
// The filmography itself starts on the person's real, complete combined
// credit list (`personCombinedCredits` - accurate and already a single,
// unpaginated call) and only switches to the general, paginated `/discover`
// query (this actor pre-applied via `with_cast`, combinable with genre/
// sort/rating/studio/etc. through the same Filters button and sheet the
// category screen uses) once the user actually applies something - the
// exact same `filtersApplied` pattern
// `app/discover/category/[category].tsx` already established for its own
// Studio/Provider deep-links, chosen here for the same reason: don't
// discard accurate, already-available data for a `/discover` approximation
// until the user asks for one.

// Whichever release-date field applies to this credit's media type.
function creditDate(item: TmdbPersonCredit): string {
  return item.release_date ?? item.first_air_date ?? '';
}

// Filmography grid card - memoized since this can grow to a long list for a
// prolific actor/director, and is fully self-contained (only reads its own
// `item` prop), so memoization is effective with no extra prop-stabilizing
// needed at the call site.
const CreditCard = memo(function CreditCard({ item }: { item: TmdbPersonCredit }) {
  const posterUrl = tmdbImageUrl(item.poster_path);
  const title = item.title ?? item.name ?? 'Untitled';
  return (
    <TouchableOpacity style={styles.card} onPress={() => router.push(`/discover/${item.media_type}/${item.id}`)}>
      {posterUrl ? (
        <Image source={{ uri: posterUrl }} style={styles.poster} cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.poster, styles.posterPlaceholder]} />
      )}
      <Text style={styles.cardTitle} numberOfLines={2}>
        {title}
      </Text>
      {item.character || item.job ? (
        <Text style={styles.cardCharacter} numberOfLines={1}>
          {item.character ?? item.job}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
});

// Maps one filtered `/discover` result into the same `TmdbPersonCredit`
// shape the unfiltered `personCombinedCredits` list already uses, so the
// grid's `renderItem` doesn't need to know which mode produced the data -
// `character`/`job` are left undefined (a discover result doesn't carry
// this person's specific role), which the existing render already handles.
function toPersonCredit(item: TmdbMovie | TmdbTv, mediaType: 'movie' | 'tv'): TmdbPersonCredit {
  return {
    id: item.id,
    media_type: mediaType,
    title: mediaType === 'movie' ? (item as TmdbMovie).title : undefined,
    name: mediaType === 'tv' ? (item as TmdbTv).name : undefined,
    poster_path: item.poster_path,
    release_date: (item as TmdbMovie).release_date,
    first_air_date: (item as TmdbTv).first_air_date,
    vote_average: item.vote_average,
  };
}

export default function PersonScreen() {
  const tabBarClearance = useTabBarClearance();
  const { id } = useLocalSearchParams<{ id: string }>();
  const personId = Number(id);
  const { servers } = useServers();
  const config = servers.tmdb;

  const [person, setPerson] = useState<TmdbPerson | null>(null);
  const [credits, setCredits] = useState<TmdbPersonCredit[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters button/sheet - seeded with this person once their real name is
  // known, so the sheet shows them pre-selected as soon as it's opened
  // rather than starting empty. `filtersApplied` (not `countActiveFilters`
  // alone) gates the badge below - the pre-seed shouldn't read as "1 active
  // filter" while the visible grid is still the unfiltered, complete
  // filmography.
  const seededRef = useRef(false);
  const [filters, setFilters] = useState<DiscoverFilters>(EMPTY_FILTERS);
  const [filtersApplied, setFiltersApplied] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!person || seededRef.current) return;
    seededRef.current = true;
    setFilters((f) => ({ ...f, sort: SORT_OPTIONS[0], actors: [{ id: person.id, name: person.name }] }));
  }, [person]);

  // Filtered/paginated grid state - only ever populated once `filtersApplied`.
  const [filteredItems, setFilteredItems] = useState<TmdbPersonCredit[]>([]);
  const [page, setPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [filteredLoading, setFilteredLoading] = useState(false);
  const [filteredLoadingMore, setFilteredLoadingMore] = useState(false);
  const loadMoreLock = useRef(false);

  const movieParams = useMemo(() => buildDiscoverParams(filters, 'movie'), [filters]);
  const tvParams = useMemo(() => buildDiscoverParams(filters, 'tv'), [filters]);

  // Same interleaved-two-queries strategy the category screen's own 'all'
  // mode already uses - no combined `/discover` endpoint exists, so a
  // person's movie and TV credits are fetched separately and merged
  // client-side.
  const fetchFilteredPage = (pageNum: number) =>
    Promise.all([tmdbApi.discoverMovies(config!, movieParams, pageNum), tmdbApi.discoverTv(config!, tvParams, pageNum)]).then(
      ([m, t]) => ({
        results: interleave<TmdbPersonCredit>(
          m.results.map((item) => toPersonCredit(item, 'movie')),
          t.results.map((item) => toPersonCredit(item, 'tv'))
        ),
        total_pages: Math.max(m.total_pages, t.total_pages),
      })
    );

  useEffect(() => {
    if (!config || !filtersApplied) return;
    let cancelled = false;
    setFilteredLoading(true);
    setPage(0);
    fetchFilteredPage(1)
      .then((res) => {
        if (cancelled) return;
        setFilteredItems(res.results);
        setPage(1);
        setTotalPages(res.total_pages);
      })
      .catch((e) => {
        if (!cancelled) console.error('Failed to load filtered credits', e);
      })
      .finally(() => {
        if (!cancelled) setFilteredLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, filtersApplied, movieParams, tvParams]);

  const loadMore = () => {
    if (!config || !filtersApplied || loadMoreLock.current || page === 0 || page >= totalPages) return;
    loadMoreLock.current = true;
    setFilteredLoadingMore(true);
    fetchFilteredPage(page + 1)
      .then((res) => {
        setFilteredItems((prev) => [...prev, ...dedupeById(prev, res.results)]);
        setPage((p) => p + 1);
        setTotalPages(res.total_pages);
      })
      .catch((e) => console.error('Failed to load more', e))
      .finally(() => {
        setFilteredLoadingMore(false);
        loadMoreLock.current = false;
      });
  };

  useFocusEffect(
    useCallback(() => {
      if (!config || !personId) return;
      setLoading(true);
      Promise.all([tmdbApi.personDetail(config, personId), tmdbApi.personCombinedCredits(config, personId)])
        .then(([p, c]) => {
          setPerson(p);
          // De-dupes by media_type+id (a person can appear in both cast and
          // crew lists for the same title, e.g. an actor-director), then
          // sorts the merged list by rating, then popularity, then recency.
          const seen = new Set<string>();
          // Crew credits (directing/writing/etc.) first so a title someone
          // both directed and acted in surfaces their crew role - that's
          // usually the more relevant contribution when you tapped through
          // from a Director/Writer credit rather than a cast member.
          const deduped = [...c.crew, ...c.cast].filter((item) => {
            const key = `${item.media_type}:${item.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          deduped.sort((a, b) => {
            const ratingDiff = (b.vote_average ?? 0) - (a.vote_average ?? 0);
            if (ratingDiff !== 0) return ratingDiff;
            const popularityDiff = (b.popularity ?? 0) - (a.popularity ?? 0);
            if (popularityDiff !== 0) return popularityDiff;
            return creditDate(b).localeCompare(creditDate(a));
          });
          setCredits(deduped);
        })
        .catch(() => {
          setPerson(null);
          setCredits([]);
        })
        .finally(() => setLoading(false));
    }, [config, personId])
  );

  if (!config) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.emptyText}>TMDB isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  const photo = tmdbImageUrl(person?.profile_path, 'w185');
  const activeFilterCount = filtersApplied ? countActiveFilters(filters) : 0;
  const items = filtersApplied ? filteredItems : credits;
  const showInitialSpinner = filtersApplied ? filteredLoading && filteredItems.length === 0 : loading && !person;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {person?.name ?? ''}
        </Text>
        {person ? (
          <TouchableOpacity style={styles.iconButton} onPress={() => setSheetOpen(true)}>
            <Ionicons name="options-outline" size={22} color={colors.textPrimary} />
            {activeFilterCount > 0 ? (
              <View style={styles.filterBadge}>
                <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 38 }} />
        )}
      </View>

      {showInitialSpinner ? (
        <ActivityIndicator color={colors.sectionGreen} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => `${item.media_type}:${item.id}`}
          numColumns={3}
          contentContainerStyle={[styles.grid, { paddingBottom: tabBarClearance }]}
          onEndReachedThreshold={0.5}
          onEndReached={filtersApplied ? loadMore : undefined}
          ListFooterComponent={filteredLoadingMore ? <ActivityIndicator color={colors.sectionGreen} style={{ marginVertical: 16 }} /> : null}
          ListHeaderComponent={
            person ? (
              <View style={styles.header}>
                <TouchableOpacity
                  onPress={() =>
                    router.push({
                      pathname: '/gallery',
                      params: { mediaType: 'person', tmdbId: String(personId), fallbackPosterUrl: photo ?? '' },
                    })
                  }
                  disabled={!photo}
                >
                  {photo ? (
                    <Image source={{ uri: photo }} style={styles.photo} cachePolicy="memory-disk" />
                  ) : (
                    <View style={[styles.photo, styles.photoPlaceholder]} />
                  )}
                </TouchableOpacity>
                <Text style={styles.name}>{person.name}</Text>
                {person.known_for_department ? <Text style={styles.department}>{person.known_for_department}</Text> : null}
                {person.biography ? (
                  <Text style={styles.bio} numberOfLines={5}>
                    {person.biography}
                  </Text>
                ) : null}
                <Text style={styles.filmographyTitle}>Filmography</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => <CreditCard item={item} />}
          ListEmptyComponent={!showInitialSpinner ? <Text style={styles.emptyText}>No credits found.</Text> : null}
        />
      )}

      {person ? (
        <DiscoverFilterSheet
          visible={sheetOpen}
          mediaType="all"
          config={config}
          filters={filters}
          onApply={(next) => {
            setFilters(next);
            setFiltersApplied(true);
          }}
          onClose={() => setSheetOpen(false)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 40 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  filterBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.sectionGreen,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: { color: colors.background, fontSize: 10, fontWeight: '800' },
  topBarTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  header: { alignItems: 'center', padding: 20, gap: 4 },
  photo: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surfaceAlt },
  photoPlaceholder: {},
  name: { color: colors.textPrimary, fontWeight: '800', fontSize: 20, marginTop: 12 },
  department: { color: colors.sectionGreen, fontSize: 13, fontWeight: '600' },
  bio: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 10 },
  filmographyTitle: {
    alignSelf: 'flex-start',
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 16,
    marginTop: 20,
    marginBottom: 4,
  },
  grid: { padding: 12, gap: 4 },
  card: { flex: 1 / 3, padding: 6 },
  poster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  cardTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', marginTop: 6 },
  cardCharacter: { color: colors.textSecondary, fontSize: 11, marginTop: 1 },
});
