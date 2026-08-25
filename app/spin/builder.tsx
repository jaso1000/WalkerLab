import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { useAnimatedScrollHandler, useSharedValue } from 'react-native-reanimated';
import { radarrApi, RadarrMovie, RadarrQualityProfile } from '../../src/api/radarr';
import { sonarrApi, SonarrQualityProfile, SonarrSeries } from '../../src/api/sonarr';
import { Badge } from '../../src/components/Badge';
import { NotConfigured } from '../../src/components/NotConfigured';
import { RatingBadges } from '../../src/components/RatingBadges';
import { SwitchRow } from '../../src/components/SelectRow';
import { SortMenu } from '../../src/components/SortMenu';
import { SwipeTabBar } from '../../src/components/SwipeTabBar';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import { formatBytes, seriesStatusTone, titleCase } from '../../src/lib/format';
import { chunk, useColumns, useContentWidth } from '../../src/lib/responsive';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { getWheels, newWheelId, saveWheel, Wheel, WheelItem } from '../../src/lib/wheels';
import { useProfiles } from '../../src/context/ProfilesContext';
import { colors } from '../../src/theme/colors';

// Create/edit screen for one wheel - `wheelId` (search param) selects edit
// mode, prefilling from the saved wheel; omitted, it's a fresh new wheel.
// Structured as a real swipeable tab bar, same as Movies/TV Shows/Torrents
// elsewhere in this app, rather than a small strip + segmented toggle -
// "In Wheel" is its own full tab for reviewing/removing what's already
// selected, and "Movies"/"TV Shows" are the browse-and-add tabs (only
// shown for whichever service is actually configured). Movies and TV can
// still mix in one wheel - the tabs only control which list is showing,
// not what's allowed in the wheel.
type TabKey = 'wheel' | 'movies' | 'tv';

// Same sort fields as movies.tsx/index.tsx's own "All" tabs (kept as two
// separate lists, same as those screens, since the two services' sortable
// fields genuinely differ - Movies has Digital Release/Rating/Popularity/
// Studio, TV doesn't). No "set as default"/"group headers" here, unlike
// those screens - this is a one-off picker, not a persistent library view.
const MOVIE_SORT_FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'year', label: 'Year' },
  { key: 'added', label: 'Date Added' },
  { key: 'digitalRelease', label: 'Digital Release' },
  { key: 'size', label: 'Size' },
  { key: 'rating', label: 'Rating' },
  { key: 'popularity', label: 'Popularity' },
  { key: 'qualityProfile', label: 'Quality Profile' },
  { key: 'genre', label: 'Genre' },
  { key: 'studio', label: 'Studio' },
] as const;
type MovieSortKey = (typeof MOVIE_SORT_FIELDS)[number]['key'];

const SERIES_SORT_FIELDS = [
  { key: 'title', label: 'Title' },
  { key: 'year', label: 'Year' },
  { key: 'added', label: 'Date Added' },
  { key: 'size', label: 'Size' },
  { key: 'qualityProfile', label: 'Quality Profile' },
  { key: 'genre', label: 'Genre' },
] as const;
type SeriesSortKey = (typeof SERIES_SORT_FIELDS)[number]['key'];

// Size defaults to descending (largest first); every other field defaults
// ascending - same rule both source screens use.
function defaultSortAsc(key: string): boolean {
  return key !== 'size';
}

function movieSortValue(item: RadarrMovie, key: MovieSortKey, profiles: RadarrQualityProfile[]): string | number {
  switch (key) {
    case 'title':
      return item.title.toLowerCase();
    case 'year':
      return item.year ?? 0;
    case 'added':
      return item.added ? Math.abs(Date.now() - new Date(item.added).getTime()) : Number.POSITIVE_INFINITY;
    case 'digitalRelease':
      return item.digitalRelease ? Math.abs(Date.now() - new Date(item.digitalRelease).getTime()) : Number.POSITIVE_INFINITY;
    case 'size':
      return item.sizeOnDisk ?? 0;
    case 'rating':
      return item.ratings?.imdb?.value ?? 0;
    case 'popularity':
      return item.popularity ?? 0;
    case 'qualityProfile':
      return profiles.find((p) => p.id === item.qualityProfileId)?.name.toLowerCase() ?? '';
    case 'genre':
      return item.genres?.[0]?.toLowerCase() ?? '';
    case 'studio':
      return item.studio?.toLowerCase() ?? '';
  }
}

function seriesSortValue(item: SonarrSeries, key: SeriesSortKey, profiles: SonarrQualityProfile[]): string | number {
  switch (key) {
    case 'title':
      return item.title.toLowerCase();
    case 'year':
      return item.year ?? 0;
    case 'added':
      return item.added ? Math.abs(Date.now() - new Date(item.added).getTime()) : Number.POSITIVE_INFINITY;
    case 'size':
      return item.statistics?.sizeOnDisk ?? 0;
    case 'qualityProfile':
      return profiles.find((p) => p.id === item.qualityProfileId)?.name.toLowerCase() ?? '';
    case 'genre':
      return item.genres?.[0]?.toLowerCase() ?? '';
  }
}

function posterUrl(images: { coverType: string; remoteUrl?: string }[]): string | undefined {
  return images.find((i) => i.coverType === 'poster')?.remoteUrl;
}

// "Downloaded" for a movie is Radarr's own single `hasFile` flag. A series
// has no equivalent single flag - it's downloaded here if at least one
// episode has a file, not requiring every episode (a partially-downloaded
// show is still something you can actually watch, unlike one that's
// tracked but entirely missing).
function isDownloaded(entry: RadarrMovie | SonarrSeries, tab: 'movies' | 'tv'): boolean {
  return tab === 'movies' ? (entry as RadarrMovie).hasFile : ((entry as SonarrSeries).statistics?.episodeFileCount ?? 0) > 0;
}

// Same status badge as movies.tsx's movieBadge()/index.tsx's episodeBadge().
function libraryBadge(entry: RadarrMovie | SonarrSeries, tab: 'movies' | 'tv') {
  if (tab === 'movies') {
    const movie = entry as RadarrMovie;
    if (movie.hasFile) return <Badge label="Downloaded" tone="success" />;
    if (movie.status === 'inCinemas') return <Badge label="In Theaters" tone="accent" />;
    return <Badge label={titleCase(movie.status) || 'Missing'} tone="danger" />;
  }
  const series = entry as SonarrSeries;
  if (!series.statistics || series.statistics.episodeCount === 0) {
    return <Badge label={titleCase(series.status)} tone={seriesStatusTone(series.status)} />;
  }
  const { episodeFileCount, episodeCount } = series.statistics;
  if (episodeFileCount >= episodeCount) return <Badge label="Complete" tone="success" />;
  if (episodeFileCount === 0) return <Badge label="Missing" tone="danger" />;
  return <Badge label={`${episodeFileCount}/${episodeCount} eps`} tone="sonarr" />;
}

function librarySize(entry: RadarrMovie | SonarrSeries, tab: 'movies' | 'tv'): number | undefined {
  return tab === 'movies' ? (entry as RadarrMovie).sizeOnDisk : (entry as SonarrSeries).statistics?.sizeOnDisk;
}

// Same card style Movies/TV Shows' own All tab uses (MovieRow/SeriesRow) -
// poster, title, status badge, size, rating - just wired for tap-to-select
// instead of tap-to-open-detail/long-press-menu, since this is a picker,
// not a browse screen.
const LibraryCard = memo(function LibraryCard({
  entry,
  tab,
  selected,
  onPress,
  onLongPress,
}: {
  entry: RadarrMovie | SonarrSeries;
  tab: 'movies' | 'tv';
  selected: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const poster = posterUrl(entry.images);
  const size = librarySize(entry, tab);
  const rating = tab === 'movies' ? (entry as RadarrMovie).ratings?.imdb?.value : (entry as SonarrSeries).ratings?.value;
  return (
    <TouchableOpacity style={[styles.card, styles.rowItem]} onPress={onPress} onLongPress={onLongPress}>
      {poster ? (
        <Image source={{ uri: poster }} style={styles.poster} cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.poster, styles.posterPlaceholder]} />
      )}
      {selected ? (
        <View style={styles.cardCheckOverlay}>
          <View style={styles.cardCheck}>
            <Ionicons name="checkmark" size={14} color={colors.background} />
          </View>
        </View>
      ) : null}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {entry.title}
          {entry.year ? ` (${entry.year})` : ''}
        </Text>
        <View style={styles.badgeRow}>
          {libraryBadge(entry, tab)}
          {size ? <Text style={styles.size}>{formatBytes(size)}</Text> : null}
        </View>
        <RatingBadges imdb={rating} tint={tab === 'tv' ? colors.sonarr : undefined} compact />
      </View>
    </TouchableOpacity>
  );
});

// "In Wheel" tab's row - same card shape as LibraryCard, but a WheelItem is
// only a lightweight snapshot (no badge/size/rating data by design, see
// wheels.ts), so this just shows poster + title + a real remove button
// instead of a selection checkmark.
const WheelRow = memo(function WheelRow({ item, onRemove }: { item: WheelItem; onRemove: (item: WheelItem) => void }) {
  return (
    <TouchableOpacity
      style={[styles.card, styles.rowItem]}
      onPress={() => router.push(item.mediaType === 'movie' ? `/movie/${item.libraryId}` : `/series/${item.libraryId}`)}
    >
      {item.posterUrl ? (
        <Image source={{ uri: item.posterUrl }} style={styles.poster} cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.poster, styles.posterPlaceholder]} />
      )}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.wheelRowType}>{item.mediaType === 'movie' ? 'Movie' : 'TV Show'}</Text>
      </View>
      <TouchableOpacity style={styles.removeButton} onPress={() => onRemove(item)}>
        <Ionicons name="trash-outline" size={20} color={colors.danger} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
});

// Shared search + "only downloaded" + sort controls, identical between the
// Movies and TV Shows tabs - only what they're wired to differs.
function PickerControls({
  placeholder,
  search,
  onSearchChange,
  onlyDownloaded,
  onToggleDownloaded,
  sortLabel,
  sortAsc,
  onOpenSort,
  quickAddLabel,
  onQuickAdd,
}: {
  placeholder: string;
  search: string;
  onSearchChange: (v: string) => void;
  onlyDownloaded: boolean;
  onToggleDownloaded: () => void;
  sortLabel: string | undefined;
  sortAsc: boolean;
  onOpenSort: () => void;
  quickAddLabel: string;
  onQuickAdd: () => void;
}) {
  return (
    <View>
      <View style={styles.pageHeaderRow}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={onSearchChange}
          />
          {search ? (
            <TouchableOpacity onPress={() => onSearchChange('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
        <TouchableOpacity style={styles.quickAddButton} onPress={onQuickAdd}>
          <Text style={styles.quickAddText}>{quickAddLabel}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.filterRow}>
        <TouchableOpacity
          style={[styles.filterChip, onlyDownloaded && { backgroundColor: `${colors.spin}26` }]}
          onPress={onToggleDownloaded}
        >
          <Ionicons
            name={onlyDownloaded ? 'checkbox' : 'square-outline'}
            size={16}
            color={onlyDownloaded ? colors.spin : colors.textSecondary}
          />
          <Text style={[styles.filterChipText, onlyDownloaded && { color: colors.spin }]}>Only downloaded</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.sortPill} onPress={onOpenSort}>
          <Text style={styles.sortPillText}>{sortLabel}</Text>
          <Ionicons name={sortAsc ? 'arrow-up' : 'arrow-down'} size={16} color={colors.spin} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function WheelBuilderScreen() {
  const { wheelId } = useLocalSearchParams<{ wheelId?: string }>();
  const isEditing = !!wheelId;
  const { servers } = useServers();
  const { activeProfileId } = useProfiles();
  const width = useContentWidth();
  const columns = useColumns();
  const tabBarClearance = useTabBarClearance();
  const scrollRef = useRef<ScrollView>(null);
  const scrollX = useSharedValue(0);
  const onPagerScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });
  const radarrConfig = servers.radarr;
  const sonarrConfig = servers.sonarr;

  const [name, setName] = useState('');
  const [removeAfterSpin, setRemoveAfterSpin] = useState(false);
  const [shared, setShared] = useState(false);
  const [items, setItems] = useState<WheelItem[]>([]);
  const [existingWheels, setExistingWheels] = useState<Wheel[] | null>(null);
  const [saving, setSaving] = useState(false);

  const [movies, setMovies] = useState<RadarrMovie[]>([]);
  const [series, setSeries] = useState<SonarrSeries[]>([]);
  const [movieProfiles, setMovieProfiles] = useState<RadarrQualityProfile[]>([]);
  const [seriesProfiles, setSeriesProfiles] = useState<SonarrQualityProfile[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [search, setSearch] = useState('');
  const [onlyDownloaded, setOnlyDownloaded] = useState(false);
  const [movieSort, setMovieSort] = useState<{ key: MovieSortKey; asc: boolean }>({ key: 'title', asc: true });
  const [seriesSort, setSeriesSort] = useState<{ key: SeriesSortKey; asc: boolean }>({ key: 'title', asc: true });
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  const [activeTab, setActiveTab] = useState(0);

  // Tabs are built from whichever services are actually configured - "In
  // Wheel" always exists, "Movies"/"TV Shows" only appear when their
  // service is set up (the screen already requires at least one, see the
  // NotConfigured gate below).
  const tabs = useMemo(() => {
    const list: { key: TabKey; label: string }[] = [{ key: 'wheel', label: `In Wheel (${items.length})` }];
    if (radarrConfig) list.push({ key: 'movies', label: 'Movies' });
    if (sonarrConfig) list.push({ key: 'tv', label: 'TV Shows' });
    return list;
  }, [items.length, radarrConfig, sonarrConfig]);
  const activeKey = tabs[activeTab]?.key ?? 'wheel';

  // Loads the saved wheel (edit mode) and the Movies/TV library in
  // parallel, once per focus - cheap enough (a plain library list fetch,
  // same one Movies/TV Shows themselves already do) not to bother caching.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        setLoadingLibrary(true);
        try {
          const [wheels, movieList, seriesList, movieProfileList, seriesProfileList] = await Promise.all([
            getWheels(activeProfileId),
            radarrConfig ? radarrApi.getMovies(radarrConfig).catch(() => []) : Promise.resolve([]),
            sonarrConfig ? sonarrApi.getSeries(sonarrConfig).catch(() => []) : Promise.resolve([]),
            radarrConfig ? radarrApi.getQualityProfiles(radarrConfig).catch(() => []) : Promise.resolve([]),
            sonarrConfig ? sonarrApi.getQualityProfiles(sonarrConfig).catch(() => []) : Promise.resolve([]),
          ]);
          if (cancelled) return;
          setExistingWheels(wheels);
          setMovies(movieList);
          setSeries(seriesList);
          setMovieProfiles(movieProfileList);
          setSeriesProfiles(seriesProfileList);
          if (wheelId) {
            const existing = wheels.find((w) => w.id === wheelId);
            if (existing) {
              setName(existing.name);
              setRemoveAfterSpin(existing.removeAfterSpin);
              setShared(existing.shared);
              setItems(existing.items);
            }
          }
        } catch (e) {
          if (!cancelled) alert('Failed to load', e instanceof Error ? e.message : 'Unknown error');
        } finally {
          if (!cancelled) setLoadingLibrary(false);
        }
      })();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeProfileId, radarrConfig, sonarrConfig])
  );

  const handleTabChange = (index: number) => setActiveTab(index);
  const goToTab = (index: number) => {
    handleTabChange(index);
    scrollRef.current?.scrollTo({ x: index * width, animated: true });
  };
  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    handleTabChange(Math.round(e.nativeEvent.contentOffset.x / width));
  };
  // A fold/unfold changes `width` without firing a scroll event - re-snap
  // to the current tab under the new width instead of leaving it stale,
  // same fix TorrentClientScreen/movies.tsx already use.
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: activeTab * width, animated: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const selectedIds = useMemo(() => new Set(items.map((i) => i.id)), [items]);

  const toggleItem = (item: WheelItem) => {
    setItems((prev) => (prev.some((i) => i.id === item.id) ? prev.filter((i) => i.id !== item.id) : [...prev, item]));
  };

  const addAllMovies = () => {
    const toAdd: WheelItem[] = movies
      .filter((m) => !selectedIds.has(`movie-${m.id}`) && (!onlyDownloaded || isDownloaded(m, 'movies')))
      .map((m) => ({ id: `movie-${m.id}`, libraryId: m.id, mediaType: 'movie', title: m.title, posterUrl: posterUrl(m.images) }));
    setItems((prev) => [...prev, ...toAdd]);
  };

  const addAllSeries = () => {
    const toAdd: WheelItem[] = series
      .filter((s) => !selectedIds.has(`tv-${s.id}`) && (!onlyDownloaded || isDownloaded(s, 'tv')))
      .map((s) => ({ id: `tv-${s.id}`, libraryId: s.id, mediaType: 'tv', title: s.title, posterUrl: posterUrl(s.images) }));
    setItems((prev) => [...prev, ...toAdd]);
  };

  // Tapping the currently-active sort field flips its direction; picking a
  // different field switches to it at that field's own default direction -
  // same behavior as Movies/TV Shows' own sort pill.
  const handleSortSelect = (key: string) => {
    if (activeKey === 'movies') {
      const field = key as MovieSortKey;
      setMovieSort((prev) => (prev.key === field ? { key: field, asc: !prev.asc } : { key: field, asc: defaultSortAsc(field) }));
    } else {
      const field = key as SeriesSortKey;
      setSeriesSort((prev) => (prev.key === field ? { key: field, asc: !prev.asc } : { key: field, asc: defaultSortAsc(field) }));
    }
  };

  // Filtered/sorted per tab - two separate memos (matching e.g. movies.tsx's
  // own multiple chunked-sections pattern) rather than a shared helper
  // function defined inside the component, which hook-linting tools don't
  // recognize as a real custom hook.
  const movieData = useMemo(() => {
    let result: RadarrMovie[] = movies;
    if (onlyDownloaded) result = result.filter((item) => isDownloaded(item, 'movies'));
    const trimmed = search.trim().toLowerCase();
    if (trimmed) result = result.filter((item) => item.title.toLowerCase().includes(trimmed));
    const sorted = [...result].sort((a, b) => {
      const av = movieSortValue(a, movieSort.key, movieProfiles);
      const bv = movieSortValue(b, movieSort.key, movieProfiles);
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    if (!movieSort.asc) sorted.reverse();
    return sorted;
  }, [movies, search, onlyDownloaded, movieSort, movieProfiles]);

  const seriesData = useMemo(() => {
    let result: SonarrSeries[] = series;
    if (onlyDownloaded) result = result.filter((item) => isDownloaded(item, 'tv'));
    const trimmed = search.trim().toLowerCase();
    if (trimmed) result = result.filter((item) => item.title.toLowerCase().includes(trimmed));
    const sorted = [...result].sort((a, b) => {
      const av = seriesSortValue(a, seriesSort.key, seriesProfiles);
      const bv = seriesSortValue(b, seriesSort.key, seriesProfiles);
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    if (!seriesSort.asc) sorted.reverse();
    return sorted;
  }, [series, search, onlyDownloaded, seriesSort, seriesProfiles]);

  const chunkedMovies = useMemo(() => chunk(movieData, columns), [movieData, columns]);
  const chunkedSeries = useMemo(() => chunk(seriesData, columns), [seriesData, columns]);
  const chunkedItems = useMemo(() => chunk(items, columns), [items, columns]);
  const rowKey = (row: { id: number | string }[]) => row.map((r) => r.id).join('-');

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      alert('Name required', 'Give this wheel a name first.');
      return;
    }
    if (items.length === 0) {
      alert('No titles yet', 'Add at least one movie or show to this wheel.');
      return;
    }
    if (!existingWheels) return;
    setSaving(true);
    const now = new Date().toISOString();
    const existing = isEditing ? existingWheels.find((w) => w.id === wheelId) : undefined;
    const next: Wheel = existing
      ? { ...existing, name: trimmed, removeAfterSpin, items, shared, updatedAt: now }
      : { id: newWheelId(), name: trimmed, removeAfterSpin, items, shared, createdAt: now, updatedAt: now };
    try {
      await saveWheel(activeProfileId, next);
      router.back();
    } catch (e) {
      alert('Failed to save wheel', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  if (!radarrConfig && !sonarrConfig) {
    return <NotConfigured service="Sonarr or Radarr" tint={colors.spin} />;
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerTitle: isEditing ? 'Edit Wheel' : 'New Wheel',
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.textPrimary,
          headerRight: () => (
            <TouchableOpacity style={styles.headerButton} onPress={save} disabled={saving}>
              {saving ? <ActivityIndicator color={colors.spin} /> : <Text style={styles.saveText}>Save</Text>}
            </TouchableOpacity>
          ),
        }}
      />

      <View style={styles.form}>
        <TextInput
          style={styles.nameInput}
          placeholder="Wheel name"
          placeholderTextColor={colors.textMuted}
          value={name}
          onChangeText={setName}
        />
        <SwitchRow label="Remove title after landing on it" value={removeAfterSpin} onChange={setRemoveAfterSpin} tint={colors.spin} />
        {Platform.OS === 'web' ? (
          <SwitchRow label="Share with all users on this instance" value={shared} onChange={setShared} tint={colors.spin} />
        ) : null}
      </View>

      <View style={styles.tabBarRow}>
        <SwipeTabBar
          tabs={tabs.map((t) => t.label)}
          activeTab={activeTab}
          onChange={goToTab}
          onSettle={handleTabChange}
          scrollX={scrollX}
          pageWidth={width}
          tint={colors.spin}
        />
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
        <View style={[styles.page, { width }]}>
          <FlatList
            data={chunkedItems}
            keyExtractor={rowKey}
            contentContainerStyle={[items.length === 0 ? styles.emptyContainer : styles.grid, { paddingBottom: 24 + tabBarClearance }]}
            ListEmptyComponent={
              <Text style={styles.empty}>Nothing added yet - switch to Movies or TV Shows to add titles.</Text>
            }
            renderItem={({ item: row }) => (
              <View style={styles.gridRow}>
                {row.map((wi) => (
                  <WheelRow key={wi.id} item={wi} onRemove={toggleItem} />
                ))}
              </View>
            )}
          />
        </View>

        {radarrConfig ? (
          <View style={[styles.page, { width }]}>
            <PickerControls
              placeholder="Search movies..."
              search={search}
              onSearchChange={setSearch}
              onlyDownloaded={onlyDownloaded}
              onToggleDownloaded={() => setOnlyDownloaded((v) => !v)}
              sortLabel={MOVIE_SORT_FIELDS.find((f) => f.key === movieSort.key)?.label}
              sortAsc={movieSort.asc}
              onOpenSort={() => setSortMenuOpen(true)}
              quickAddLabel="+ Add all"
              onQuickAdd={addAllMovies}
            />
            <FlatList
              data={chunkedMovies}
              keyExtractor={rowKey}
              contentContainerStyle={[styles.grid, { paddingBottom: 24 + tabBarClearance }]}
              ListEmptyComponent={!loadingLibrary ? <Text style={styles.empty}>No movies in your library.</Text> : null}
              renderItem={({ item: row }) => (
                <View style={styles.gridRow}>
                  {row.map((entry) => (
                    <LibraryCard
                      key={entry.id}
                      entry={entry}
                      tab="movies"
                      selected={selectedIds.has(`movie-${entry.id}`)}
                      onPress={() =>
                        toggleItem({
                          id: `movie-${entry.id}`,
                          libraryId: entry.id,
                          mediaType: 'movie',
                          title: entry.title,
                          posterUrl: posterUrl(entry.images),
                        })
                      }
                      onLongPress={() => router.push(`/movie/${entry.id}`)}
                    />
                  ))}
                </View>
              )}
            />
          </View>
        ) : null}

        {sonarrConfig ? (
          <View style={[styles.page, { width }]}>
            <PickerControls
              placeholder="Search TV shows..."
              search={search}
              onSearchChange={setSearch}
              onlyDownloaded={onlyDownloaded}
              onToggleDownloaded={() => setOnlyDownloaded((v) => !v)}
              sortLabel={SERIES_SORT_FIELDS.find((f) => f.key === seriesSort.key)?.label}
              sortAsc={seriesSort.asc}
              onOpenSort={() => setSortMenuOpen(true)}
              quickAddLabel="+ Add all"
              onQuickAdd={addAllSeries}
            />
            <FlatList
              data={chunkedSeries}
              keyExtractor={rowKey}
              contentContainerStyle={[styles.grid, { paddingBottom: 24 + tabBarClearance }]}
              ListEmptyComponent={!loadingLibrary ? <Text style={styles.empty}>No TV shows in your library.</Text> : null}
              renderItem={({ item: row }) => (
                <View style={styles.gridRow}>
                  {row.map((entry) => (
                    <LibraryCard
                      key={entry.id}
                      entry={entry}
                      tab="tv"
                      selected={selectedIds.has(`tv-${entry.id}`)}
                      onPress={() =>
                        toggleItem({
                          id: `tv-${entry.id}`,
                          libraryId: entry.id,
                          mediaType: 'tv',
                          title: entry.title,
                          posterUrl: posterUrl(entry.images),
                        })
                      }
                      onLongPress={() => router.push(`/series/${entry.id}`)}
                    />
                  ))}
                </View>
              )}
            />
          </View>
        ) : null}
      </Animated.ScrollView>

      <SortMenu
        visible={sortMenuOpen}
        fields={activeKey === 'movies' ? (MOVIE_SORT_FIELDS as unknown as { key: string; label: string }[]) : (SERIES_SORT_FIELDS as unknown as { key: string; label: string }[])}
        activeKey={activeKey === 'movies' ? movieSort.key : seriesSort.key}
        activeAsc={activeKey === 'movies' ? movieSort.asc : seriesSort.asc}
        onSelect={handleSortSelect}
        onClose={() => setSortMenuOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  // The native-stack header here doesn't inset headerRight from the screen
  // edge on its own (unlike headerLeft's back arrow elsewhere in this app,
  // which native-stack positions itself) - confirmed live, "Save" touched
  // the very edge of the screen without this.
  headerButton: { paddingRight: 16, paddingVertical: 4 },
  saveText: { color: colors.spin, fontWeight: '700', fontSize: 16 },
  form: { paddingHorizontal: 16, paddingTop: 8, gap: 4 },
  nameInput: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.textPrimary,
    fontSize: 16,
    marginBottom: 4,
  },
  tabBarRow: { paddingHorizontal: 16, marginTop: 12, marginBottom: 8 },
  // See app/index.tsx's identical comment - fixes "can't scroll" on the
  // web build without affecting native.
  pager: { flex: 1 },
  page: { flex: 1 },
  pageHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginBottom: 8 },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 44,
  },
  // 16px isn't a stylistic choice - iOS Safari auto-zooms the page in on
  // focus for a text input with a computed font-size under 16px - see
  // movies.tsx's identical comment for the full explanation.
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 16 },
  quickAddButton: { backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 14, height: 44, justifyContent: 'center' },
  quickAddText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 10,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  filterChipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  sortPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  sortPillText: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  // Same list/row/card shape as movies.tsx/index.tsx's own "All" tab, so
  // the picker looks and reads exactly like the familiar Movies/TV Shows
  // library list - see LibraryCard's own comment for what differs
  // (tap-to-select instead of tap-to-open/long-press-menu).
  grid: { padding: 12, gap: 10 },
  gridRow: { flexDirection: 'row', gap: 10 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', marginTop: 40, marginHorizontal: 24, color: colors.textSecondary },
  rowItem: { flex: 1, minWidth: 0 },
  card: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: 14, padding: 10, minWidth: 0 },
  poster: { width: 60, height: 90, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  cardCheckOverlay: { position: 'absolute', top: 6, left: 6 },
  cardCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.spin,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.background,
  },
  info: { flex: 1, justifyContent: 'center', minWidth: 0 },
  title: { fontSize: 16, fontWeight: '700', color: colors.textPrimary },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  size: { color: colors.textSecondary, fontSize: 12 },
  wheelRowType: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  removeButton: { padding: 8, alignSelf: 'center' },
});
