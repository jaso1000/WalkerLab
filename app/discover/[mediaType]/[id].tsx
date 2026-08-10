import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ImageBackground, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { omdbApi, OmdbRatings } from '../../../src/api/omdb';
import { radarrApi, RadarrMovie, RadarrQualityProfile, RadarrRootFolder } from '../../../src/api/radarr';
import { sonarrApi, SonarrQualityProfile, SonarrRootFolder, SonarrSeries } from '../../../src/api/sonarr';
import {
  extractCrewCredits,
  extractKeywords,
  extractMovieReleaseInfo,
  normalizeAggregateCredits,
  originalLanguageName,
  tmdbApi,
  tmdbImageUrl,
  TmdbMovie,
  TmdbMovieDetail,
  TmdbTv,
  TmdbTvDetail,
} from '../../../src/api/tmdb';
import { ActionSheet, ActionSheetOption } from '../../../src/components/ActionSheet';
import { CastCrewSection } from '../../../src/components/CastCrewSection';
import { DiscoverCardItem, DiscoverRow } from '../../../src/components/DiscoverRow';
import { ReleaseTriptych } from '../../../src/components/ReleaseTriptych';
import { ReviewSources } from '../../../src/components/ReviewSources';
import { SelectRow, SwitchRow } from '../../../src/components/SelectRow';
import { TagList } from '../../../src/components/TagList';
import { useServers } from '../../../src/context/ServersContext';
import { alert } from '../../../src/lib/alert';
import { AVAILABILITY_OPTIONS, SONARR_MONITOR_OPTIONS, SonarrMonitorOption } from '../../../src/lib/constants';
import { deletedLibrary } from '../../../src/lib/deletedLibrary';
import { formatDate } from '../../../src/lib/format';
import { getLastQualityProfileId, setLastQualityProfileId } from '../../../src/lib/preferences';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

// Discover's universal detail page for both movies and TV, reached from
// search results, category grids, network browse, and person filmography -
// shows TMDB data with an inline "Add to Radarr/Sonarr" flow (or a link to
// the real detail page if already in the library). One route handles both
// media types via the `mediaType` param, branching internally rather than
// duplicating the whole page per type.
type MediaType = 'movie' | 'tv';

function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string | number }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={colors.sectionGreen} style={styles.infoIcon} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function DiscoverDetailScreen() {
  const tabBarClearance = useTabBarClearance();
  const { mediaType, id } = useLocalSearchParams<{ mediaType: MediaType; id: string }>();
  const { servers } = useServers();
  const tmdbConfig = servers.tmdb;
  const radarrConfig = servers.radarr;
  const sonarrConfig = servers.sonarr;
  const omdbConfig = servers.omdb;
  const tmdbId = Number(id);

  const [detail, setDetail] = useState<TmdbMovieDetail | TmdbTvDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<(TmdbMovie | TmdbTv)[]>([]);
  const [previouslyDeleted, setPreviouslyDeleted] = useState(false);

  const [lookupMovie, setLookupMovie] = useState<RadarrMovie | null>(null);
  const [lookupSeries, setLookupSeries] = useState<SonarrSeries | null>(null);
  const [tvdbId, setTvdbId] = useState<number | null>(null);
  const [tvImdbId, setTvImdbId] = useState<string | null>(null);
  const [omdbRatings, setOmdbRatings] = useState<OmdbRatings | null>(null);
  const [checkingLibrary, setCheckingLibrary] = useState(false);

  const [profiles, setProfiles] = useState<(RadarrQualityProfile | SonarrQualityProfile)[]>([]);
  const [rootFolders, setRootFolders] = useState<(RadarrRootFolder | SonarrRootFolder)[]>([]);
  const [qualityProfileId, setQualityProfileId] = useState<number | null>(null);
  const [rootFolderPath, setRootFolderPath] = useState<string | null>(null);
  const [minimumAvailability, setMinimumAvailability] = useState('released');
  const [monitored, setMonitored] = useState(true);
  const [monitorOption, setMonitorOption] = useState<SonarrMonitorOption>('all');
  const [searchOnAdd, setSearchOnAdd] = useState(true);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);

  // Loads the TMDB detail payload (movie or TV depending on `mediaType`)
  // plus its "More Like This" recommendations, independently - a
  // recommendations failure shouldn't block the main detail content.
  useFocusEffect(
    useCallback(() => {
      if (!tmdbConfig || !tmdbId) return;
      setLoading(true);
      const fetchDetail = mediaType === 'movie' ? tmdbApi.movieDetail(tmdbConfig, tmdbId) : tmdbApi.tvDetail(tmdbConfig, tmdbId);
      fetchDetail
        .then((d) => setDetail(d))
        .catch(() => setDetail(null))
        .finally(() => setLoading(false));

      const fetchRecs = mediaType === 'movie' ? tmdbApi.movieRecommendations(tmdbConfig, tmdbId) : tmdbApi.tvRecommendations(tmdbConfig, tmdbId);
      fetchRecs
        .then((r) => setRecommendations(r.results))
        .catch(() => setRecommendations([]));
    }, [tmdbConfig, tmdbId, mediaType])
  );

  // Checks the local "previously deleted" flag (see `deletedLibrary.ts`) so
  // the banner below can show even though the real Radarr/Sonarr record is
  // long gone.
  useFocusEffect(
    useCallback(() => {
      const check = mediaType === 'movie' ? deletedLibrary.getDeletedMovieIds() : deletedLibrary.getDeletedSeriesTmdbIds();
      check.then((ids) => setPreviouslyDeleted(ids.has(tmdbId))).catch(() => setPreviouslyDeleted(false));
    }, [mediaType, tmdbId])
  );

  // Checks whether this title is already in the Radarr/Sonarr library (by
  // tmdbId for movies; TV needs an extra tvdbId resolve first since Sonarr's
  // lookup only matches on tvdbId), and loads that service's quality-profile/
  // root-folder options for the add form below, defaulting the quality
  // profile to whatever was last used for that service.
  useFocusEffect(
    useCallback(() => {
      if (mediaType === 'movie') {
        if (!radarrConfig || !tmdbId) return;
        setCheckingLibrary(true);
        radarrApi
          .searchMovies(radarrConfig, `tmdb:${tmdbId}`)
          .then((results) => setLookupMovie(results[0] ?? null))
          .catch(() => setLookupMovie(null))
          .finally(() => setCheckingLibrary(false));
        radarrApi.getQualityProfiles(radarrConfig).then(async (list) => {
          setProfiles(list);
          const remembered = await getLastQualityProfileId('radarr');
          setQualityProfileId((prev) => prev ?? list.find((p) => p.id === remembered)?.id ?? list[0]?.id ?? null);
        });
        radarrApi.getRootFolders(radarrConfig).then((list) => {
          setRootFolders(list);
          setRootFolderPath((prev) => prev ?? list[0]?.path ?? null);
        });
      } else {
        if (!tmdbConfig || !sonarrConfig || !tmdbId) return;
        setCheckingLibrary(true);
        tmdbApi
          .tvExternalIds(tmdbConfig, tmdbId)
          .then((ids) => {
            setTvdbId(ids.tvdb_id ?? null);
            setTvImdbId(ids.imdb_id ?? null);
            if (!ids.tvdb_id) return null;
            return sonarrApi.searchSeries(sonarrConfig, `tvdb:${ids.tvdb_id}`);
          })
          .then((results) => setLookupSeries(results?.[0] ?? null))
          .catch(() => setLookupSeries(null))
          .finally(() => setCheckingLibrary(false));
        sonarrApi.getQualityProfiles(sonarrConfig).then(async (list) => {
          setProfiles(list);
          const remembered = await getLastQualityProfileId('sonarr');
          setQualityProfileId((prev) => prev ?? list.find((p) => p.id === remembered)?.id ?? list[0]?.id ?? null);
        });
        sonarrApi.getRootFolders(sonarrConfig).then((list) => {
          setRootFolders(list);
          setRootFolderPath((prev) => prev ?? list[0]?.path ?? null);
        });
      }
    }, [mediaType, tmdbId, radarrConfig, sonarrConfig, tmdbConfig])
  );

  // OMDb ratings depend on an imdbId, which comes from different places per
  // media type: movies carry it directly in their TMDB detail payload, TV
  // only gets one via the external-ids lookup in the effect above.
  useEffect(() => {
    const imdbId = mediaType === 'movie' ? (detail as TmdbMovieDetail | null)?.imdb_id : tvImdbId;
    if (!omdbConfig || !imdbId) {
      setOmdbRatings(null);
      return;
    }
    omdbApi
      .byImdbId(omdbConfig, imdbId)
      .then(setOmdbRatings)
      .catch(() => setOmdbRatings(null));
  }, [omdbConfig, mediaType, detail, tvImdbId]);

  // Adds the resolved lookup result (movie or series) to the appropriate
  // service, clearing its "previously deleted" flag on success (an add is
  // effectively un-deleting it) and remembering the chosen quality profile.
  const submit = async () => {
    setAdding(true);
    try {
      if (mediaType === 'movie' && radarrConfig && lookupMovie && qualityProfileId && rootFolderPath) {
        await radarrApi.addMovie(radarrConfig, {
          title: lookupMovie.title,
          tmdbId: lookupMovie.tmdbId,
          qualityProfileId,
          rootFolderPath,
          minimumAvailability,
          monitored,
          searchOnAdd,
        });
        await deletedLibrary.unmarkMovieDeleted(lookupMovie.tmdbId);
        await setLastQualityProfileId('radarr', qualityProfileId);
        alert('Added', `${lookupMovie.title} was added to Radarr.`);
        router.back();
      } else if (mediaType === 'tv' && sonarrConfig && lookupSeries && tvdbId && qualityProfileId && rootFolderPath) {
        await sonarrApi.addSeries(sonarrConfig, {
          title: lookupSeries.title,
          tvdbId,
          qualityProfileId,
          rootFolderPath,
          monitorOption,
          searchOnAdd,
        });
        await deletedLibrary.unmarkSeriesDeleted(tvdbId);
        await deletedLibrary.unmarkSeriesDeletedByTmdbId(tmdbId);
        await setLastQualityProfileId('sonarr', qualityProfileId);
        alert('Added', `${lookupSeries.title} was added to Sonarr.`);
        router.back();
      }
    } catch (e) {
      alert('Failed to add', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAdding(false);
    }
  };

  if (!tmdbConfig) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyText}>TMDB isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  if (loading || !detail) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.sectionGreen} />
      </SafeAreaView>
    );
  }

  // Everything below derives display values from the TMDB `detail` payload,
  // branching per media type since `TmdbMovieDetail`/`TmdbTvDetail` don't
  // share field names for most of these (title/name, runtime/episode_run_time,
  // release_date/first_air_date, etc).
  const title = mediaType === 'movie' ? (detail as TmdbMovieDetail).title : (detail as TmdbTvDetail).name;
  const imdbId = mediaType === 'movie' ? (detail as TmdbMovieDetail).imdb_id ?? undefined : tvImdbId ?? undefined;
  const dateStr = mediaType === 'movie' ? (detail as TmdbMovieDetail).release_date : (detail as TmdbTvDetail).first_air_date;
  const year = dateStr ? dateStr.slice(0, 4) : undefined;
  const runtime =
    mediaType === 'movie'
      ? (detail as TmdbMovieDetail).runtime
      : (detail as TmdbTvDetail).episode_run_time?.[0];
  const genres = detail.genres?.map((g) => g.name).join(' · ');
  const poster = tmdbImageUrl(detail.poster_path, 'w342');
  const backdrop = tmdbImageUrl(detail.backdrop_path, 'w780');
  const inLibraryId = mediaType === 'movie' ? lookupMovie?.id : lookupSeries?.id;
  const canConfigure = mediaType === 'movie' ? Boolean(radarrConfig) : Boolean(sonarrConfig);
  const missingTvdb = mediaType === 'tv' && sonarrConfig && !checkingLibrary && !tvdbId;

  const studio = detail.production_companies?.[0]?.name;
  const productionCountry = detail.production_countries?.[0]?.name;
  const originalLanguage = originalLanguageName(detail);
  const tags = extractKeywords(detail).map((k) => k.name);
  const movieReleases = mediaType === 'movie' ? extractMovieReleaseInfo((detail as TmdbMovieDetail).release_dates) : null;
  const tvDetail = mediaType === 'tv' ? (detail as TmdbTvDetail) : null;
  const credits =
    mediaType === 'movie' ? (detail as TmdbMovieDetail).credits ?? null : normalizeAggregateCredits(tvDetail?.aggregate_credits);
  const actionTint = mediaType === 'movie' ? colors.accent : colors.sonarr;
  const actionTextColor = mediaType === 'movie' ? colors.background : colors.textPrimary;
  const recommendationItems: DiscoverCardItem[] = recommendations.map((r) => ({
    id: r.id,
    title: mediaType === 'movie' ? (r as TmdbMovie).title : (r as TmdbTv).name,
    posterUrl: tmdbImageUrl(r.poster_path),
    rating: r.vote_average,
  }));

  return (
    <View style={styles.screen}>
      <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: tabBarClearance }}>
        <ImageBackground source={backdrop ? { uri: backdrop } : undefined} style={styles.hero}>
          <LinearGradient colors={['transparent', colors.background]} style={styles.heroGradient} />
          <SafeAreaView edges={['top']} style={styles.heroTopBar}>
            <TouchableOpacity style={styles.circleButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </SafeAreaView>
          <View style={styles.heroBottom}>
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: '/gallery',
                  params: { mediaType, tmdbId: String(tmdbId), fallbackPosterUrl: poster ?? '' },
                })
              }
              disabled={!poster}
            >
              {poster ? (
                <Image source={{ uri: poster }} style={styles.poster} cachePolicy="memory-disk" />
              ) : (
                <View style={[styles.poster, styles.posterPlaceholder]} />
              )}
            </TouchableOpacity>
            <View style={styles.heroInfo}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.meta}>{[year, runtime ? `${runtime}m` : null].filter(Boolean).join(' · ')}</Text>
              {genres ? <Text style={styles.meta}>{genres}</Text> : null}
              {detail.vote_average || omdbRatings?.rottenTomatoes ? (
                <View style={styles.ratingRow}>
                  {detail.vote_average ? (
                    <View style={styles.ratingBadge}>
                      <Ionicons name="star" size={14} color={colors.sectionGreen} />
                      <Text style={styles.ratingText}>{detail.vote_average.toFixed(1)}</Text>
                    </View>
                  ) : null}
                  {omdbRatings?.rottenTomatoes ? (
                    <View style={styles.ratingBadge}>
                      <Text style={styles.tomato}>🍅</Text>
                      <Text style={styles.ratingText}>{Math.round(omdbRatings.rottenTomatoes)}%</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          </View>
        </ImageBackground>

        {previouslyDeleted && !inLibraryId ? (
          <View style={styles.deletedBanner}>
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
            <Text style={styles.deletedBannerText}>
              You removed this {mediaType === 'movie' ? 'movie' : 'show'} from your library before.
            </Text>
          </View>
        ) : null}

        <View style={styles.addSection}>
          {checkingLibrary ? (
            <ActivityIndicator color={colors.sectionGreen} style={{ marginTop: 12 }} />
          ) : inLibraryId ? (
            <TouchableOpacity
              style={[styles.addButton, { backgroundColor: actionTint }]}
              onPress={() => router.push(mediaType === 'movie' ? `/movie/${inLibraryId}` : `/series/${inLibraryId}`)}
            >
              <Text style={[styles.addButtonText, { color: actionTextColor }]}>Already in Library — View</Text>
            </TouchableOpacity>
          ) : !canConfigure ? (
            <Text style={styles.emptyText}>
              Connect {mediaType === 'movie' ? 'Radarr' : 'Sonarr'} in Settings to add this {mediaType === 'movie' ? 'movie' : 'show'}.
            </Text>
          ) : missingTvdb ? (
            <Text style={styles.emptyText}>This show couldn&apos;t be matched to a TheTVDB entry, so it can&apos;t be added automatically.</Text>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Add to {mediaType === 'movie' ? 'Radarr' : 'Sonarr'}</Text>
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
                {mediaType === 'movie' ? (
                  <>
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
                    <SwitchRow label="Monitored" value={monitored} onChange={setMonitored} tint={actionTint} />
                  </>
                ) : (
                  <SelectRow
                    label="Monitor"
                    value={SONARR_MONITOR_OPTIONS.find((o) => o.value === monitorOption)?.label ?? 'All Episodes'}
                    onPress={() =>
                      setMenu({
                        title: 'Monitor',
                        options: SONARR_MONITOR_OPTIONS.map((o) => ({
                          label: o.label,
                          onPress: () => setMonitorOption(o.value),
                        })),
                      })
                    }
                  />
                )}
                <SwitchRow label="Search on Add" value={searchOnAdd} onChange={setSearchOnAdd} tint={actionTint} />
              </View>

              <TouchableOpacity
                style={[
                  styles.addButton,
                  { backgroundColor: actionTint },
                  (adding || !qualityProfileId || !rootFolderPath) && styles.addButtonDisabled,
                ]}
                onPress={submit}
                disabled={adding || !qualityProfileId || !rootFolderPath}
              >
                <Text style={[styles.addButtonText, { color: actionTextColor }]}>
                  {adding ? 'Adding…' : `Add ${mediaType === 'movie' ? 'Movie' : 'Series'}`}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {detail.overview ? (
          <View style={styles.overviewCard}>
            <Text style={styles.overviewTitle}>Overview</Text>
            <Text style={styles.overview}>{detail.overview}</Text>
          </View>
        ) : null}

        <ReviewSources
          imdb={omdbRatings?.imdbRating}
          rottenTomatoes={omdbRatings?.rottenTomatoes}
          metacritic={omdbRatings?.metacritic}
          tmdb={detail.vote_average}
          imdbId={imdbId}
          tmdbId={tmdbId}
          mediaType={mediaType}
          title={title}
        />

        <View style={styles.detailsCard}>
          <Text style={styles.sectionTitle}>Details</Text>
          {mediaType === 'movie' ? (
            <>
              <ReleaseTriptych
                theatrical={formatDate(movieReleases?.theatrical) ?? undefined}
                digital={formatDate(movieReleases?.digital) ?? undefined}
                physical={formatDate(movieReleases?.physical) ?? undefined}
                tint={colors.sectionGreen}
              />
              <View style={styles.detailsDivider} />
              <InfoRow icon="film-outline" label="Studio" value={studio} />
              <InfoRow icon="information-circle-outline" label="Status" value={detail.status} />
              <InfoRow icon="globe-outline" label="Original Language" value={originalLanguage} />
              <InfoRow icon="flag-outline" label="Production Country" value={productionCountry} />
            </>
          ) : (
            <>
              <InfoRow icon="tv-outline" label="Network" value={tvDetail?.networks?.[0]?.name} />
              <InfoRow icon="film-outline" label="Studio" value={studio} />
              <InfoRow icon="information-circle-outline" label="Status" value={tvDetail?.status} />
              <InfoRow icon="calendar-outline" label="First Aired" value={formatDate(tvDetail?.first_air_date) ?? undefined} />
              <InfoRow
                icon="calendar-outline"
                label={tvDetail?.in_production ? 'Latest Episode' : 'Last Aired'}
                value={formatDate(tvDetail?.last_air_date) ?? undefined}
              />
              <InfoRow icon="albums-outline" label="Seasons" value={tvDetail?.number_of_seasons} />
              <InfoRow icon="globe-outline" label="Original Language" value={originalLanguage} />
              <InfoRow icon="flag-outline" label="Production Country" value={productionCountry} />
            </>
          )}
        </View>

        <TagList tags={tags} tint={colors.sectionGreen} />

        {credits ? (
          <CastCrewSection
            cast={credits.cast}
            directors={extractCrewCredits(credits.crew, ['Director'])}
            writers={extractCrewCredits(credits.crew, ['Writer', 'Screenplay', 'Story', 'Teleplay'])}
            tint={colors.sectionGreen}
          />
        ) : null}

        <DiscoverRow
          title="More Like This"
          items={recommendationItems}
          onPressItem={(recId) => router.push(`/discover/${mediaType}/${recId}`)}
        />

        <View style={{ height: 32 }} />
      </ScrollView>

      <ActionSheet visible={!!menu} title={menu?.title ?? ''} options={menu?.options ?? []} onClose={() => setMenu(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: colors.textSecondary, textAlign: 'center' },
  hero: { minHeight: 260, justifyContent: 'flex-end' },
  heroGradient: { ...StyleSheet.absoluteFill },
  heroTopBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 4 },
  circleButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBottom: { flexDirection: 'row', gap: 14, padding: 16 },
  poster: { width: 92, height: 138, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  heroInfo: { flex: 1, justifyContent: 'flex-end', gap: 4 },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  meta: { color: colors.textSecondary, fontSize: 13 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 2 },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ratingText: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  tomato: { fontSize: 13 },
  overviewCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, margin: 16, marginTop: 14, gap: 8 },
  overviewTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  overview: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  deletedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dangerMuted,
    borderRadius: 12,
    padding: 12,
    marginHorizontal: 16,
    marginTop: 14,
  },
  deletedBannerText: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', flex: 1 },
  addSection: { padding: 16, gap: 10 },
  sectionTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 6 },
  card: { backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 16 },
  detailsCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, margin: 16, marginBottom: 0, gap: 4 },
  detailsDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginTop: 12 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  infoIcon: { marginRight: 10 },
  infoLabel: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  infoValue: { color: colors.textPrimary, fontSize: 13, fontWeight: '600' },
  addButton: { borderRadius: 10, padding: 14, alignItems: 'center', marginTop: 4 },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: { fontWeight: '800', fontSize: 16 },
});
