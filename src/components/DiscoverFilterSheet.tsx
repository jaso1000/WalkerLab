// The full Discover Movies/TV filter panel, opened from the Filters button
// on `app/discover/category/[category].tsx` (Trending/Popular/Upcoming,
// single-media-type only) - every filter dimension seerr-team/seerr exposes
// on its own general-purpose Discover Movies/TV browse page: sort, release-
// date range, genres, keyword include/exclude, studio (movie) or network
// (tv), original language, runtime/rating/vote-count ranges, watch provider
// + region, and (movie-only) content rating. Edits buffer in local `draft`
// state and only reach the parent on "Apply" - avoids a refetch on every
// keystroke/slider drag/chip tap while the sheet is open.
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import {
  TmdbCertification,
  TmdbCompany,
  TmdbGenre,
  TmdbKeyword,
  TmdbLanguage,
  TmdbPersonSearchResult,
  TmdbWatchProvider,
  TmdbWatchRegion,
  tmdbApi,
  tmdbImageUrl,
} from '../api/tmdb';
import { ServiceConfig } from '../api/types';
import { MediaKind } from '../lib/discoverCategories';
import { DiscoverFilters, SORT_OPTIONS, SortChoice } from '../lib/discoverFilters';
import { getDefaultRegion } from '../lib/preferences';
import { colors } from '../theme/colors';
import { ActionSheet, ActionSheetOption } from './ActionSheet';
import { DateField } from './DateField';
import { RangeSlider } from './RangeSlider';

type NestedSheet = 'sort' | 'language' | 'watchRegion' | 'certFrom' | 'certTo' | null;

const RUNTIME_RANGE: [number, number] = [0, 300];
const RATING_RANGE: [number, number] = [0, 10];
const VOTE_COUNT_RANGE: [number, number] = [0, 20000];
const PROVIDER_PREVIEW_COUNT = 15;

export function DiscoverFilterSheet({
  visible,
  mediaType,
  config,
  filters,
  onApply,
  onClose,
}: {
  visible: boolean;
  // 'all' (the Discover screen's mixed movie+TV tab/category) shows both
  // movie- and TV-specific sections at once (Movie Genres + TV Genres,
  // Studio + Network, etc.) since there's no combined `/discover` endpoint
  // to build a single query against - the category screen runs this
  // sheet's filters as two parallel queries (movie + tv) and interleaves
  // the results instead. See `buildDiscoverParams`'s own per-media-type
  // gating for how each section only ever affects its matching side.
  mediaType: MediaKind | 'all';
  config: ServiceConfig;
  filters: DiscoverFilters;
  onApply: (filters: DiscoverFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<DiscoverFilters>(filters);
  const [nestedSheet, setNestedSheet] = useState<NestedSheet>(null);
  const [providersExpanded, setProvidersExpanded] = useState(false);

  // Always start a fresh session from whatever's currently applied -
  // reopening after a previous Apply/Cancel never carries over stale edits.
  useEffect(() => {
    if (visible) setDraft(filters);
  }, [visible, filters]);

  // --- Option lists, fetched once per sheet lifetime (lazily, on first
  // open) rather than on every screen load - Discover's filter sheet is
  // opened far less often than the browse screen itself reloads pages.
  const [movieGenreList, setMovieGenreList] = useState<TmdbGenre[]>([]);
  const [tvGenreList, setTvGenreList] = useState<TmdbGenre[]>([]);
  const [languages, setLanguages] = useState<TmdbLanguage[]>([]);
  const [watchRegions, setWatchRegions] = useState<TmdbWatchRegion[]>([]);
  const [watchProviders, setWatchProviders] = useState<TmdbWatchProvider[]>([]);
  const [certifications, setCertifications] = useState<TmdbCertification[]>([]);
  const [defaultRegionCode, setDefaultRegionCode] = useState<string>();
  const loadedRef = useRef(false);

  const showMovie = mediaType === 'movie' || mediaType === 'all';
  const showTv = mediaType === 'tv' || mediaType === 'all';

  // The user's own saved default (Settings > TMDB (Discover) > Default
  // Region) - used whenever `draft.watchRegion` hasn't been explicitly
  // overridden for this session, both for the initial provider fetch and
  // as the "use default" option in the region picker below.
  useEffect(() => {
    getDefaultRegion().then(setDefaultRegionCode);
  }, []);
  const defaultRegionName = watchRegions.find((r) => r.iso_3166_1 === defaultRegionCode)?.english_name ?? defaultRegionCode;

  useEffect(() => {
    if (!visible || loadedRef.current) return;
    loadedRef.current = true;
    if (showMovie) tmdbApi.movieGenres(config).then(setMovieGenreList).catch(() => {});
    if (showTv) tmdbApi.tvGenres(config).then(setTvGenreList).catch(() => {});
    tmdbApi.languages(config).then(setLanguages).catch(() => {});
    tmdbApi.watchProviderRegions(config).then(setWatchRegions).catch(() => {});
    if (showMovie) tmdbApi.movieCertifications(config).then(setCertifications).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mediaType, config]);

  // Watch providers are region-scoped - reload whenever the chosen region
  // changes (including the very first load, at whatever region is current).
  // 'all' merges both sides' provider lists (deduped by id - the same
  // service carries the same provider_id across movie/tv catalogs in the
  // same region) since a single chip row here has to represent both.
  useEffect(() => {
    if (!visible || !defaultRegionCode) return;
    const region = draft.watchRegion?.iso_3166_1 ?? defaultRegionCode;
    const request =
      mediaType === 'all'
        ? Promise.all([tmdbApi.watchProviders(config, 'movie', region), tmdbApi.watchProviders(config, 'tv', region)]).then(
            ([movie, tv]) => {
              const seen = new Set<number>();
              return [...movie, ...tv].filter((p) => {
                if (seen.has(p.provider_id)) return false;
                seen.add(p.provider_id);
                return true;
              });
            }
          )
        : tmdbApi.watchProviders(config, mediaType, region);
    request.then(setWatchProviders).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mediaType, config, draft.watchRegion?.iso_3166_1, defaultRegionCode]);

  const toggleMovieGenre = (genre: TmdbGenre) => {
    setDraft((d) => ({
      ...d,
      movieGenres: d.movieGenres.some((g) => g.id === genre.id)
        ? d.movieGenres.filter((g) => g.id !== genre.id)
        : [...d.movieGenres, genre],
    }));
  };

  const toggleTvGenre = (genre: TmdbGenre) => {
    setDraft((d) => ({
      ...d,
      tvGenres: d.tvGenres.some((g) => g.id === genre.id) ? d.tvGenres.filter((g) => g.id !== genre.id) : [...d.tvGenres, genre],
    }));
  };

  const toggleProvider = (provider: TmdbWatchProvider) => {
    setDraft((d) => ({
      ...d,
      watchProviders: d.watchProviders.some((p) => p.provider_id === provider.provider_id)
        ? d.watchProviders.filter((p) => p.provider_id !== provider.provider_id)
        : [...d.watchProviders, provider],
    }));
  };

  const clearFilters = () =>
    setDraft((d) => ({ movieGenres: [], tvGenres: [], actors: [], keywords: [], excludeKeywords: [], watchProviders: [], sort: d.sort }));
  const apply = () => {
    onApply(draft);
    onClose();
  };

  const certIndex = (code: string) => certifications.findIndex((c) => c.certification === code);
  const certFromLabel = draft.certificationGte ?? 'Any';
  const certToLabel = draft.certificationLte ?? 'Any';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.screen}>
        <SafeAreaView edges={['top']} style={styles.header}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Filters</Text>
          <View style={{ width: 32 }} />
        </SafeAreaView>

        <ScrollView contentContainerStyle={styles.content}>
          <Section title="Sort By">
            <TouchableOpacity style={styles.pickerField} onPress={() => setNestedSheet('sort')}>
              <Text style={styles.pickerFieldText}>{draft.sort.label}</Text>
              <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </Section>

          <Section title={mediaType === 'tv' ? 'First Air Date' : mediaType === 'all' ? 'Release / Air Date' : 'Release Date'}>
            <View style={styles.row}>
              <DateField label="From" value={draft.releaseDateGte} onChange={(v) => setDraft((d) => ({ ...d, releaseDateGte: v }))} />
              <DateField label="To" value={draft.releaseDateLte} onChange={(v) => setDraft((d) => ({ ...d, releaseDateLte: v }))} />
            </View>
          </Section>

          {showMovie ? (
            <Section title={mediaType === 'all' ? 'Movie Genres' : 'Genres'}>
              <ChipRow>
                {movieGenreList.map((genre) => (
                  <Chip
                    key={genre.id}
                    label={genre.name}
                    active={draft.movieGenres.some((g) => g.id === genre.id)}
                    onPress={() => toggleMovieGenre(genre)}
                  />
                ))}
              </ChipRow>
            </Section>
          ) : null}
          {showTv ? (
            <Section title={mediaType === 'all' ? 'TV Genres' : 'Genres'}>
              <ChipRow>
                {tvGenreList.map((genre) => (
                  <Chip
                    key={genre.id}
                    label={genre.name}
                    active={draft.tvGenres.some((g) => g.id === genre.id)}
                    onPress={() => toggleTvGenre(genre)}
                  />
                ))}
              </ChipRow>
            </Section>
          ) : null}

          <ActorSection config={config} selected={draft.actors} onChange={(actors) => setDraft((d) => ({ ...d, actors }))} />

          <KeywordSection
            title="Keywords"
            config={config}
            selected={draft.keywords}
            onChange={(keywords) => setDraft((d) => ({ ...d, keywords }))}
          />
          <KeywordSection
            title="Exclude Keywords"
            config={config}
            selected={draft.excludeKeywords}
            onChange={(excludeKeywords) => setDraft((d) => ({ ...d, excludeKeywords }))}
          />

          {showMovie ? <StudioSection config={config} selected={draft.studio} onChange={(studio) => setDraft((d) => ({ ...d, studio }))} /> : null}

          <Section title="Original Language">
            <TouchableOpacity style={styles.pickerField} onPress={() => setNestedSheet('language')}>
              <Text style={styles.pickerFieldText}>{draft.originalLanguage?.english_name ?? 'Any'}</Text>
              <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </Section>

          <Section title="Runtime">
            <RangeSlider
              min={RUNTIME_RANGE[0]}
              max={RUNTIME_RANGE[1]}
              step={5}
              value={[draft.runtimeGte ?? RUNTIME_RANGE[0], draft.runtimeLte ?? RUNTIME_RANGE[1]]}
              formatLabel={(v) => (v >= RUNTIME_RANGE[1] ? `${v}+ min` : `${v} min`)}
              onValueChange={([lo, hi]) =>
                setDraft((d) => ({
                  ...d,
                  runtimeGte: lo <= RUNTIME_RANGE[0] ? undefined : lo,
                  runtimeLte: hi >= RUNTIME_RANGE[1] ? undefined : hi,
                }))
              }
            />
          </Section>

          <Section title="TMDB User Score">
            <RangeSlider
              min={RATING_RANGE[0]}
              max={RATING_RANGE[1]}
              step={0.5}
              value={[draft.voteAverageGte ?? RATING_RANGE[0], draft.voteAverageLte ?? RATING_RANGE[1]]}
              formatLabel={(v) => v.toFixed(1)}
              onValueChange={([lo, hi]) =>
                setDraft((d) => ({
                  ...d,
                  voteAverageGte: lo <= RATING_RANGE[0] ? undefined : lo,
                  voteAverageLte: hi >= RATING_RANGE[1] ? undefined : hi,
                }))
              }
            />
          </Section>

          <Section title="TMDB Vote Count">
            <RangeSlider
              min={VOTE_COUNT_RANGE[0]}
              max={VOTE_COUNT_RANGE[1]}
              step={250}
              value={[draft.voteCountGte ?? VOTE_COUNT_RANGE[0], draft.voteCountLte ?? VOTE_COUNT_RANGE[1]]}
              formatLabel={(v) => (v >= VOTE_COUNT_RANGE[1] ? `${v}+` : String(v))}
              onValueChange={([lo, hi]) =>
                setDraft((d) => ({
                  ...d,
                  voteCountGte: lo <= VOTE_COUNT_RANGE[0] ? undefined : lo,
                  voteCountLte: hi >= VOTE_COUNT_RANGE[1] ? undefined : hi,
                }))
              }
            />
          </Section>

          <Section title="Streaming Services">
            <TouchableOpacity style={styles.pickerField} onPress={() => setNestedSheet('watchRegion')}>
              <Text style={styles.pickerFieldText}>Region: {draft.watchRegion?.english_name ?? defaultRegionName ?? '...'}</Text>
              <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            <ChipRow>
              {(providersExpanded
                ? watchProviders
                : // Always keeps an already-selected provider visible/toggleable
                  // even past the preview cutoff, so collapsing the list can
                  // never hide (and strand) an active selection.
                  watchProviders.filter(
                    (p, i) => i < PROVIDER_PREVIEW_COUNT || draft.watchProviders.some((sel) => sel.provider_id === p.provider_id)
                  )
              ).map((provider) => {
                const logo = tmdbImageUrl(provider.logo_path, 'w45');
                const active = draft.watchProviders.some((p) => p.provider_id === provider.provider_id);
                return (
                  <Pressable
                    key={provider.provider_id}
                    style={[styles.providerChip, active && styles.providerChipActive]}
                    onPress={() => toggleProvider(provider)}
                  >
                    {logo ? <Image source={{ uri: logo }} style={styles.providerLogo} /> : null}
                    <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                      {provider.provider_name}
                    </Text>
                  </Pressable>
                );
              })}
              {watchProviders.length > PROVIDER_PREVIEW_COUNT ? (
                <Pressable style={styles.expandChip} onPress={() => setProvidersExpanded((v) => !v)}>
                  <Text style={styles.expandChipText}>
                    {providersExpanded ? 'Show Less' : `Show All (${watchProviders.length})`}
                  </Text>
                </Pressable>
              ) : null}
            </ChipRow>
          </Section>

          {showMovie ? (
            <Section title={mediaType === 'all' ? 'Content Rating (Movies)' : 'Content Rating'}>
              <View style={styles.row}>
                <TouchableOpacity style={styles.pickerField} onPress={() => setNestedSheet('certFrom')}>
                  <Text style={styles.pickerFieldText}>From: {certFromLabel}</Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.pickerField} onPress={() => setNestedSheet('certTo')}>
                  <Text style={styles.pickerFieldText}>To: {certToLabel}</Text>
                  <Ionicons name="chevron-down" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </Section>
          ) : null}

          <View style={{ height: 24 }} />
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity style={styles.clearButton} onPress={clearFilters}>
            <Text style={styles.clearButtonText}>Clear Filters</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.applyButton} onPress={apply}>
            <Text style={styles.applyButtonText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ActionSheet
        visible={nestedSheet === 'sort'}
        title="Sort By"
        onClose={() => setNestedSheet(null)}
        options={sortOptionsAsActionSheet(draft.sort, (sort) => setDraft((d) => ({ ...d, sort })))}
      />
      <ActionSheet
        visible={nestedSheet === 'language'}
        title="Original Language"
        onClose={() => setNestedSheet(null)}
        options={[
          { label: 'Any', onPress: () => setDraft((d) => ({ ...d, originalLanguage: undefined })) },
          ...languages
            .filter((l) => l.english_name)
            .sort((a, b) => a.english_name.localeCompare(b.english_name))
            .map((l) => ({ label: l.english_name, onPress: () => setDraft((d) => ({ ...d, originalLanguage: l })) })),
        ]}
      />
      <ActionSheet
        visible={nestedSheet === 'watchRegion'}
        title="Streaming Region"
        onClose={() => setNestedSheet(null)}
        options={[
          { label: `Default (${defaultRegionName ?? '...'})`, onPress: () => setDraft((d) => ({ ...d, watchRegion: undefined })) },
          ...watchRegions
            .sort((a, b) => a.english_name.localeCompare(b.english_name))
            .map((r) => ({ label: r.english_name, onPress: () => setDraft((d) => ({ ...d, watchRegion: r })) })),
        ]}
      />
      <ActionSheet
        visible={nestedSheet === 'certFrom'}
        title="Content Rating From"
        onClose={() => setNestedSheet(null)}
        options={[
          { label: 'Any', onPress: () => setDraft((d) => ({ ...d, certificationGte: undefined })) },
          ...certifications.map((c) => ({
            label: c.certification,
            onPress: () =>
              setDraft((d) => {
                const gte = c.certification;
                // Keeps the range coherent if "From" is dragged past "To".
                const lte = d.certificationLte && certIndex(d.certificationLte) < certIndex(gte) ? gte : d.certificationLte;
                return { ...d, certificationGte: gte, certificationLte: lte };
              }),
          })),
        ]}
      />
      <ActionSheet
        visible={nestedSheet === 'certTo'}
        title="Content Rating To"
        onClose={() => setNestedSheet(null)}
        options={[
          { label: 'Any', onPress: () => setDraft((d) => ({ ...d, certificationLte: undefined })) },
          ...certifications.map((c) => ({
            label: c.certification,
            onPress: () =>
              setDraft((d) => {
                const lte = c.certification;
                const gte = d.certificationGte && certIndex(d.certificationGte) > certIndex(lte) ? lte : d.certificationGte;
                return { ...d, certificationLte: lte, certificationGte: gte };
              }),
          })),
        ]}
      />
    </Modal>
  );
}

function sortOptionsAsActionSheet(active: SortChoice, onSelect: (s: SortChoice) => void): ActionSheetOption[] {
  return SORT_OPTIONS.map((opt) => ({
    label: opt.label + (opt.key === active.key && opt.direction === active.direction ? ' ✓' : ''),
    onPress: () => onSelect(opt),
  }));
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={styles.chipRow}>{children}</View>;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

// Shared debounced-search-with-chips picker for Keywords include/exclude -
// the only two filters needing free-text TMDB search plus a multi-select
// result list, so this is kept local to this file rather than a separate
// exported component.
function KeywordSection({
  title,
  config,
  selected,
  onChange,
}: {
  title: string;
  config: ServiceConfig;
  selected: TmdbKeyword[];
  onChange: (keywords: TmdbKeyword[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbKeyword[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = (text: string) => {
    setQuery(text);
    if (debounce.current) clearTimeout(debounce.current);
    if (!text.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(() => {
      tmdbApi
        .searchKeywords(config, text.trim())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
  };

  const add = (keyword: TmdbKeyword) => {
    if (!selected.some((k) => k.id === keyword.id)) onChange([...selected, keyword]);
    setQuery('');
    setResults([]);
  };
  const remove = (id: number) => onChange(selected.filter((k) => k.id !== id));

  return (
    <Section title={title}>
      <TextInput
        style={styles.searchInput}
        placeholder="Search keywords..."
        placeholderTextColor={colors.textMuted}
        value={query}
        onChangeText={runSearch}
      />
      {searching ? <ActivityIndicator color={colors.sectionGreen} style={{ marginTop: 8 }} /> : null}
      {results.length > 0 ? (
        <View style={styles.searchResults}>
          {results.slice(0, 8).map((k) => (
            <TouchableOpacity key={k.id} style={styles.searchResultRow} onPress={() => add(k)}>
              <Text style={styles.searchResultText}>{k.name}</Text>
              <Ionicons name="add-circle-outline" size={18} color={colors.sectionGreen} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {selected.length > 0 ? (
        <ChipRow>
          {selected.map((k) => (
            <Pressable key={k.id} style={[styles.chip, styles.chipActive]} onPress={() => remove(k.id)}>
              <Text style={[styles.chipText, styles.chipTextActive]}>{k.name} ✕</Text>
            </Pressable>
          ))}
        </ChipRow>
      ) : null}
    </Section>
  );
}

// Actors filter - same debounced-search-with-chips shape as Keywords,
// multi-select (`with_cast` is pipe-joined OR - "either of these actors",
// same convention every other multi-select filter here already uses).
// Applies to both movie and tv discover queries equally, so unlike Studio/
// Network this has no media-type gating anywhere.
function ActorSection({
  config,
  selected,
  onChange,
}: {
  config: ServiceConfig;
  selected: TmdbPersonSearchResult[];
  onChange: (actors: TmdbPersonSearchResult[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbPersonSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = (text: string) => {
    setQuery(text);
    if (debounce.current) clearTimeout(debounce.current);
    if (!text.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(() => {
      tmdbApi
        .searchPeople(config, text.trim())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
  };

  const add = (actor: TmdbPersonSearchResult) => {
    if (!selected.some((a) => a.id === actor.id)) onChange([...selected, actor]);
    setQuery('');
    setResults([]);
  };
  const remove = (id: number) => onChange(selected.filter((a) => a.id !== id));

  return (
    <Section title="Actors">
      <TextInput
        style={styles.searchInput}
        placeholder="Search actors..."
        placeholderTextColor={colors.textMuted}
        value={query}
        onChangeText={runSearch}
      />
      {searching ? <ActivityIndicator color={colors.sectionGreen} style={{ marginTop: 8 }} /> : null}
      {results.length > 0 ? (
        <View style={styles.searchResults}>
          {results.slice(0, 8).map((a) => (
            <TouchableOpacity key={a.id} style={styles.searchResultRow} onPress={() => add(a)}>
              <Text style={styles.searchResultText}>
                {a.name}
                {a.known_for_department ? ` (${a.known_for_department})` : ''}
              </Text>
              <Ionicons name="add-circle-outline" size={18} color={colors.sectionGreen} />
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
      {selected.length > 0 ? (
        <ChipRow>
          {selected.map((a) => (
            <Pressable key={a.id} style={[styles.chip, styles.chipActive]} onPress={() => remove(a.id)}>
              <Text style={[styles.chipText, styles.chipTextActive]}>{a.name} ✕</Text>
            </Pressable>
          ))}
        </ChipRow>
      ) : null}
    </Section>
  );
}

// Movie-only studio picker - same debounced-search shape as keywords, but
// single-select (TMDB's `with_companies` filter here only ever carries one
// studio id, matching Seerr's own single-studio `CompanySelector`).
function StudioSection({
  config,
  selected,
  onChange,
}: {
  config: ServiceConfig;
  selected?: TmdbCompany;
  onChange: (studio: TmdbCompany | undefined) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TmdbCompany[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = (text: string) => {
    setQuery(text);
    if (debounce.current) clearTimeout(debounce.current);
    if (!text.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    debounce.current = setTimeout(() => {
      tmdbApi
        .searchCompanies(config, text.trim())
        .then(setResults)
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 350);
  };

  return (
    <Section title="Studio">
      {selected ? (
        <ChipRow>
          <Pressable style={[styles.chip, styles.chipActive]} onPress={() => onChange(undefined)}>
            <Text style={[styles.chipText, styles.chipTextActive]}>{selected.name} ✕</Text>
          </Pressable>
        </ChipRow>
      ) : (
        <>
          <TextInput
            style={styles.searchInput}
            placeholder="Search studios..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={runSearch}
          />
          {searching ? <ActivityIndicator color={colors.sectionGreen} style={{ marginTop: 8 }} /> : null}
          {results.length > 0 ? (
            <View style={styles.searchResults}>
              {results.slice(0, 8).map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.searchResultRow}
                  onPress={() => {
                    onChange(c);
                    setQuery('');
                    setResults([]);
                  }}
                >
                  <Text style={styles.searchResultText}>{c.name}</Text>
                  <Ionicons name="add-circle-outline" size={18} color={colors.sectionGreen} />
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  closeButton: { width: 32 },
  headerTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  content: { padding: 16 },
  section: { marginBottom: 22 },
  sectionTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  row: { flexDirection: 'row', gap: 10, minWidth: 0 },
  pickerField: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  pickerFieldText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  chipActive: { backgroundColor: colors.sectionGreenMuted, borderColor: colors.sectionGreen },
  chipText: { color: colors.textSecondary, fontWeight: '600', fontSize: 13 },
  chipTextActive: { color: colors.sectionGreen },
  providerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
  },
  providerChipActive: { backgroundColor: colors.sectionGreenMuted, borderColor: colors.sectionGreen },
  providerLogo: { width: 20, height: 20, borderRadius: 5 },
  expandChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.sectionGreen,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  expandChipText: { color: colors.sectionGreen, fontWeight: '700', fontSize: 13 },
  searchInput: {
    backgroundColor: colors.surfaceAlt,
    color: colors.textPrimary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  searchResults: { marginTop: 6, backgroundColor: colors.surface, borderRadius: 10, overflow: 'hidden' },
  searchResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  searchResultText: { color: colors.textPrimary, fontSize: 14, flexShrink: 1, minWidth: 0 },
  footer: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  clearButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  clearButtonText: { color: colors.textSecondary, fontWeight: '700', fontSize: 15 },
  applyButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 14,
    backgroundColor: colors.sectionGreen,
  },
  applyButtonText: { color: colors.background, fontWeight: '700', fontSize: 15 },
});
