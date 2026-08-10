import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ImageBackground,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { omdbApi, OmdbRatings } from '../../../src/api/omdb';
import { sonarrApi, SonarrEpisode, SonarrQualityProfile, SonarrSeries } from '../../../src/api/sonarr';
import {
  extractCrewCredits,
  extractKeywords,
  normalizeAggregateCredits,
  tmdbApi,
  TmdbCredits,
  TmdbWatchProvidersRegion,
} from '../../../src/api/tmdb';
import { ActionSheet, ActionSheetOption } from '../../../src/components/ActionSheet';
import { Badge } from '../../../src/components/Badge';
import { CastCrewSection } from '../../../src/components/CastCrewSection';
import { ReviewSources } from '../../../src/components/ReviewSources';
import { StreamingProviders, streamingProviders } from '../../../src/components/StreamingProviders';
import { TagList } from '../../../src/components/TagList';
import { useServers } from '../../../src/context/ServersContext';
import { alert } from '../../../src/lib/alert';
import { deletedLibrary } from '../../../src/lib/deletedLibrary';
import { formatBytes, formatDate, seriesStatusTone, titleCase } from '../../../src/lib/format';
import { FALLBACK_WATCH_REGION, getDefaultRegion } from '../../../src/lib/preferences';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

// Sonarr's own series detail page (as opposed to Discover's detail page for
// browsing/adding) - hero backdrop, quick-action chips, a season list
// (each row opening the season/episode drill-down), ratings, tags, and
// cast & crew, all backed by a live Sonarr fetch layered with optional TMDB/
// OMDb data, mirroring `movie/[id]/index.tsx`'s shape closely.

// One labeled details row - unlike the movie detail page's `InfoRow`, none
// of these fields are user-editable here, so there's no tappable/pencil variant.
function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string | number }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={colors.sonarr} style={styles.infoIcon} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

// Collects the episodeFileIds to bulk-delete for one season (or 'all' for
// the whole series) - only ever includes episodes that actually have a file.
function episodeFileIdsForSeason(episodes: SonarrEpisode[], seasonNumber: number | 'all') {
  return episodes
    .filter((e) => e.hasFile && (seasonNumber === 'all' || e.seasonNumber === seasonNumber))
    .map((e) => e.episodeFileId);
}

export default function SeriesDetailScreen() {
  const tabBarClearance = useTabBarClearance();
  const { id } = useLocalSearchParams<{ id: string }>();
  const seriesId = Number(id);
  const { servers } = useServers();
  const config = servers.sonarr;
  const tmdbConfig = servers.tmdb;
  const omdbConfig = servers.omdb;

  const [series, setSeries] = useState<SonarrSeries | null>(null);
  const [episodes, setEpisodes] = useState<SonarrEpisode[]>([]);
  const [profiles, setProfiles] = useState<SonarrQualityProfile[]>([]);
  const [credits, setCredits] = useState<TmdbCredits | null>(null);
  const [omdbRatings, setOmdbRatings] = useState<OmdbRatings | null>(null);
  const [tmdbRating, setTmdbRating] = useState<number | undefined>(undefined);
  const [tmdbSeriesId, setTmdbSeriesId] = useState<number | undefined>(undefined);
  const [productionCountry, setProductionCountry] = useState<string | undefined>(undefined);
  const [tags, setTags] = useState<string[]>([]);
  const [watchProviders, setWatchProviders] = useState<Record<string, TmdbWatchProvidersRegion> | null>(null);
  const [region, setRegion] = useState(FALLBACK_WATCH_REGION);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);

  // Loads the series + its full episode list from Sonarr, then layers on
  // optional TMDB (needs a tvdbId->tmdbId resolve first, since Sonarr only
  // tracks tvdbId natively - cast/crew/rating/keywords/production country
  // all come from that resolved tmdbId) and OMDb (extra ratings) data.
  // Mirrors the movie detail page's independent-fallback pattern: any one
  // optional service failing doesn't block the rest of the page.
  useEffect(() => {
    getDefaultRegion().then(setRegion);
  }, []);

  const load = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    try {
      const [s, eps, profileList] = await Promise.all([
        sonarrApi.getSeriesById(config, seriesId),
        sonarrApi.getEpisodes(config, seriesId),
        sonarrApi.getQualityProfiles(config),
      ]);
      setSeries(s);
      setEpisodes(eps);
      setProfiles(profileList);
      if (tmdbConfig && s.tvdbId) {
        tmdbApi
          .findByTvdbId(tmdbConfig, s.tvdbId)
          .then((res) => {
            const tvId = res.tv_results[0]?.id;
            setTmdbSeriesId(tvId);
            if (!tvId) {
              setWatchProviders(null);
              return null;
            }
            tmdbApi
              .tvWatchProviders(tmdbConfig, tvId)
              .then(setWatchProviders)
              .catch(() => setWatchProviders(null));
            return tmdbApi.tvDetail(tmdbConfig, tvId);
          })
          .then((d) => {
            setCredits(d ? normalizeAggregateCredits(d.aggregate_credits) : null);
            setTmdbRating(d?.vote_average);
            setProductionCountry(d?.production_countries?.[0]?.name);
            setTags(d ? extractKeywords(d).map((k) => k.name) : []);
          })
          .catch(() => {
            setCredits(null);
            setTmdbRating(undefined);
            setProductionCountry(undefined);
            setTags([]);
          });
      } else {
        setTmdbSeriesId(undefined);
        setCredits(null);
        setTmdbRating(undefined);
        setProductionCountry(undefined);
        setTags([]);
        setWatchProviders(null);
      }
      if (omdbConfig && s.imdbId) {
        omdbApi
          .byImdbId(omdbConfig, s.imdbId)
          .then(setOmdbRatings)
          .catch(() => setOmdbRatings(null));
      } else {
        setOmdbRatings(null);
      }
    } catch (e) {
      alert('Failed to load series', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, seriesId, tmdbConfig, omdbConfig]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // These four (`toggleSeriesMonitored`, `setQualityProfile`,
  // `toggleSeasonMonitored`) follow the same optimistic-update-then-
  // rollback-on-failure pattern as the movie detail page's mutators.
  const toggleSeriesMonitored = async () => {
    if (!config || !series) return;
    const updated = { ...series, monitored: !series.monitored };
    setSeries(updated);
    try {
      await sonarrApi.updateSeries(config, updated);
    } catch (e) {
      setSeries(series);
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const setQualityProfile = async (qualityProfileId: number) => {
    if (!config || !series) return;
    const updated = { ...series, qualityProfileId };
    setSeries(updated);
    try {
      await sonarrApi.updateSeries(config, updated);
    } catch (e) {
      setSeries(series);
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  // Toggles just one season's monitored flag within the series' `seasons`
  // array, leaving every other season untouched.
  const toggleSeasonMonitored = async (seasonNumber: number) => {
    if (!config || !series || !series.seasons) return;
    const updated = {
      ...series,
      seasons: series.seasons.map((s) => (s.seasonNumber === seasonNumber ? { ...s, monitored: !s.monitored } : s)),
    };
    setSeries(updated);
    try {
      await sonarrApi.updateSeries(config, updated);
    } catch (e) {
      setSeries(series);
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  // Bulk-deletes every downloaded episode file for one season, or the whole
  // series when `seasonNumber` is 'all' (used both by a season's own menu
  // and by the series-level menu / remove-from-library flow).
  const deleteFiles = (seasonNumber: number | 'all', label: string) => {
    const fileIds = episodeFileIdsForSeason(episodes, seasonNumber);
    if (fileIds.length === 0) {
      alert('No files', `There are no downloaded files for ${label}.`);
      return;
    }
    alert('Delete Files', `Delete all ${fileIds.length} episode file(s) for ${label}? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (!config) return;
          setBusy(true);
          try {
            await sonarrApi.deleteEpisodeFilesBulk(config, fileIds);
            await load();
          } catch (e) {
            alert('Delete failed', e instanceof Error ? e.message : 'Unknown error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  const searchSeason = async (seasonNumber: number, label: string) => {
    if (!config) return;
    setBusy(true);
    try {
      await sonarrApi.searchSeasonRelease(config, seriesId, seasonNumber);
      alert('Search started', `Searching for ${label}.`);
    } catch (e) {
      alert('Search failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const searchWholeSeries = async () => {
    if (!config || !series) return;
    setBusy(true);
    try {
      await sonarrApi.searchSeriesRelease(config, series.id);
      alert('Search started', `Searching for all of ${series.title}.`);
    } catch (e) {
      alert('Search failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  // Builds the per-season "..." action sheet. "Season cleanup" is
  // implemented as just another search trigger (`searchSeason`) - there's
  // no dedicated Sonarr endpoint for a true file-cleanup pass, see Known
  // gaps in PLAN.md.
  const openSeasonMenu = (seasonNumber: number) => {
    const label = `Season ${seasonNumber}`;
    const isMonitored = series?.seasons?.find((s) => s.seasonNumber === seasonNumber)?.monitored ?? true;
    setMenu({
      title: label,
      options: [
        { label: 'Automatic season search', onPress: () => searchSeason(seasonNumber, label) },
        {
          label: 'Manual season search',
          onPress: () => {
            const searchTitle = series ? `${series.title} · ${label}` : label;
            router.push(
              `/series/${seriesId}/releases?seasonNumber=${seasonNumber}&title=${encodeURIComponent(searchTitle)}`
            );
          },
        },
        { label: 'Delete all episode files', destructive: true, onPress: () => deleteFiles(seasonNumber, label) },
        { label: isMonitored ? 'Stop monitoring' : 'Start monitoring', onPress: () => toggleSeasonMonitored(seasonNumber) },
        { label: 'Season cleanup', onPress: () => searchSeason(seasonNumber, label) },
      ],
    });
  };

  // Builds the series-level "..." action sheet - same shape as
  // `openSeasonMenu` but scoped to the whole series.
  const openSeriesMenu = () => {
    if (!series) return;
    setMenu({
      title: series.title,
      options: [
        { label: 'Automatic series search', onPress: searchWholeSeries },
        {
          label: 'Manual series search',
          onPress: () => router.push(`/series/${seriesId}/releases?title=${encodeURIComponent(series.title)}`),
        },
        { label: 'Delete all episode files', destructive: true, onPress: () => deleteFiles('all', 'the whole series') },
        {
          label: series.monitored ? 'Stop monitoring series' : 'Start monitoring series',
          onPress: toggleSeriesMonitored,
        },
        { label: 'Series cleanup', onPress: searchWholeSeries },
      ],
    });
  };

  // Records the local "deleted" flag under both tvdbId (always available)
  // and, best-effort, tmdbId - Discover's TV cards only carry a tmdbId, and
  // there's no live Sonarr record left after this to resolve tvdbId->tmdbId
  // from later, so the resolve has to happen now while the series data is
  // still on hand.
  const recordSeriesDeleted = async () => {
    if (!series?.tvdbId) return;
    await deletedLibrary.markSeriesDeleted(series.tvdbId);
    if (tmdbConfig) {
      try {
        const res = await tmdbApi.findByTvdbId(tmdbConfig, series.tvdbId);
        const tmdbId = res.tv_results[0]?.id;
        if (tmdbId) await deletedLibrary.markSeriesDeletedByTmdbId(tmdbId);
      } catch {
        // Best-effort - the tvdbId-keyed record above is still saved.
      }
    }
  };

  // The 3-way "Remove from Library" prompt, same pattern as the movie
  // detail page's version but bulk-deleting every episode file instead of
  // one movie file.
  const removeFromLibrary = () => {
    if (!config || !series) return;
    alert('Remove from Library', `Remove "${series.title}" from Sonarr?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove Only',
        onPress: async () => {
          setBusy(true);
          try {
            await sonarrApi.deleteSeries(config, series.id, false);
            await recordSeriesDeleted();
            router.back();
          } catch (e) {
            alert('Failed to remove', e instanceof Error ? e.message : 'Unknown error');
          } finally {
            setBusy(false);
          }
        },
      },
      {
        text: 'Delete Files Too',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            const fileIds = episodeFileIdsForSeason(episodes, 'all');
            if (fileIds.length > 0) {
              await sonarrApi.deleteEpisodeFilesBulk(config, fileIds);
            }
            await sonarrApi.deleteSeries(config, series.id, false);
            await recordSeriesDeleted();
            router.back();
          } catch (e) {
            alert('Failed to remove', e instanceof Error ? e.message : 'Unknown error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  if (!config) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyText}>Sonarr isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  if (loading || !series) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.sonarr} />
      </SafeAreaView>
    );
  }

  const backdrop = series.images.find((i) => i.coverType === 'fanart') ?? series.images.find((i) => i.coverType === 'poster');
  const poster = series.images.find((i) => i.coverType === 'poster');
  const seasons = [...(series.seasons ?? [])].sort((a, b) => b.seasonNumber - a.seasonNumber);
  const totalSize = series.statistics?.sizeOnDisk;
  const profileName = profiles.find((p) => p.id === series.qualityProfileId)?.name;
  const imdbRating = series.ratings?.value ?? omdbRatings?.imdbRating;
  const rtRating = omdbRatings?.rottenTomatoes;
  const qualityMenuOptions: ActionSheetOption[] = profiles.map((p) => ({
    label: p.name,
    onPress: () => setQualityProfile(p.id),
  }));

  return (
    <View style={styles.screen}>
      <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: tabBarClearance }}>
        <ImageBackground source={backdrop?.remoteUrl ? { uri: backdrop.remoteUrl } : undefined} style={styles.hero}>
          <LinearGradient colors={['transparent', colors.background]} style={styles.heroGradient} />
          <SafeAreaView edges={['top']} style={styles.heroTopBar}>
            <TouchableOpacity style={styles.circleButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.circleButton} onPress={removeFromLibrary} disabled={busy}>
              <Ionicons name="trash" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </SafeAreaView>
          <View style={styles.heroBottom}>
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: '/gallery',
                  params: { mediaType: 'tv', tmdbId: tmdbSeriesId ? String(tmdbSeriesId) : '', fallbackPosterUrl: poster?.remoteUrl ?? '' },
                })
              }
              disabled={!poster?.remoteUrl}
            >
              {poster?.remoteUrl ? (
                <Image source={{ uri: poster.remoteUrl }} style={styles.poster} cachePolicy="memory-disk" />
              ) : (
                <View style={[styles.poster, styles.posterPlaceholder]} />
              )}
            </TouchableOpacity>
            <View style={styles.heroInfo}>
              <Text style={styles.title}>{series.title}</Text>
              <View style={styles.statusRow}>
                <Text style={styles.meta}>{[series.year, series.network].filter(Boolean).join(' · ')}</Text>
                {series.status ? <Badge label={titleCase(series.status)} tone={seriesStatusTone(series.status)} /> : null}
              </View>
              {series.genres && series.genres.length > 0 ? (
                <Text style={styles.meta}>{series.genres.join(' · ')}</Text>
              ) : null}
            </View>
          </View>
        </ImageBackground>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionChip} onPress={toggleSeriesMonitored}>
            <Ionicons name={series.monitored ? 'bookmark' : 'bookmark-outline'} size={18} color={colors.sonarr} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionChip, styles.actionChipWide]}
            onPress={() => setQualityMenuOpen(true)}
            disabled={profiles.length === 0}
          >
            <Text style={styles.actionChipText}>{profileName ?? 'Quality'}</Text>
          </TouchableOpacity>
          {totalSize ? (
            <View style={[styles.actionChip, styles.actionChipWide]}>
              <Text style={styles.actionChipText}>{formatBytes(totalSize)}</Text>
            </View>
          ) : null}
          <TouchableOpacity style={styles.actionChip} onPress={searchWholeSeries} disabled={busy}>
            <Ionicons name="search" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionChip} onPress={openSeriesMenu} disabled={busy}>
            <Ionicons name="ellipsis-vertical" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Seasons</Text>
          {seasons.map((season) => {
            const stats = season.statistics;
            const label = season.seasonNumber === 0 ? 'Specials' : `Season ${season.seasonNumber}`;
            return (
              <Pressable
                key={season.seasonNumber}
                style={styles.seasonRow}
                onPress={() =>
                  router.push(
                    `/series/${series.id}/season/${season.seasonNumber}?seriesTitle=${encodeURIComponent(series.title)}`
                  )
                }
              >
                <TouchableOpacity onPress={() => toggleSeasonMonitored(season.seasonNumber)}>
                  <Ionicons
                    name={season.monitored ? 'bookmark' : 'bookmark-outline'}
                    size={18}
                    color={colors.sonarr}
                  />
                </TouchableOpacity>
                <View style={styles.seasonInfo}>
                  <Text style={styles.seasonLabel}>{label}</Text>
                  {stats ? <Text style={styles.seasonMeta}>{formatBytes(stats.sizeOnDisk)}</Text> : null}
                </View>
                {stats ? (
                  <Text style={styles.seasonCount}>
                    {stats.episodeFileCount}/{stats.episodeCount}
                  </Text>
                ) : null}
                <TouchableOpacity onPress={() => openSeasonMenu(season.seasonNumber)} style={styles.seasonMenuButton}>
                  <Ionicons name="ellipsis-vertical" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </Pressable>
            );
          })}
        </View>

        {series.overview ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Overview</Text>
            <Text style={styles.overview}>{series.overview}</Text>
          </View>
        ) : null}

        <ReviewSources
          imdb={series.ratings?.value ?? omdbRatings?.imdbRating}
          rottenTomatoes={omdbRatings?.rottenTomatoes}
          metacritic={omdbRatings?.metacritic}
          tmdb={tmdbRating}
          imdbId={series.imdbId}
          tmdbId={tmdbSeriesId ?? undefined}
          mediaType="tv"
          title={series.title}
        />

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Details</Text>
          <InfoRow icon="tv-outline" label="Network" value={series.network} />
          <InfoRow icon="globe-outline" label="Original Language" value={series.originalLanguage?.name} />
          <InfoRow icon="flag-outline" label="Production Country" value={productionCountry} />
          <InfoRow icon="calendar-outline" label="Added" value={formatDate(series.added) ?? undefined} />
          <InfoRow icon="albums-outline" label="Series Type" value={series.seriesType ? titleCase(series.seriesType) : undefined} />
          <InfoRow icon="folder-outline" label="Root Path" value={series.rootFolderPath} />
          <StreamingProviders
            providers={streamingProviders(watchProviders?.[region])}
            link={watchProviders?.[region]?.link}
            tint={colors.sonarr}
          />
        </View>

        <TagList tags={tags} tint={colors.sonarr} />

        {credits ? (
          <CastCrewSection
            cast={credits.cast}
            directors={extractCrewCredits(credits.crew, ['Director'])}
            writers={extractCrewCredits(credits.crew, ['Writer', 'Screenplay', 'Story', 'Teleplay'])}
            tint={colors.sonarr}
          />
        ) : null}
      </ScrollView>

      {menu ? (
        <ActionSheet visible title={menu.title} options={menu.options} onClose={() => setMenu(null)} />
      ) : null}
      <ActionSheet
        visible={qualityMenuOpen}
        title="Quality Profile"
        options={qualityMenuOptions}
        onClose={() => setQualityMenuOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary },
  hero: { minHeight: 260, justifyContent: 'flex-end' },
  heroGradient: { ...StyleSheet.absoluteFill },
  heroTopBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  circleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBottom: { flexDirection: 'row', gap: 14, padding: 16, alignItems: 'flex-end' },
  poster: { width: 90, height: 135, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  heroInfo: { flex: 1, gap: 4 },
  title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  meta: { fontSize: 13, color: colors.textSecondary },
  actionRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 14 },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    height: 44,
    minWidth: 44,
    paddingHorizontal: 12,
  },
  actionChipWide: { flex: 1 },
  actionChipText: { color: colors.textPrimary, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, margin: 16, marginTop: 14, gap: 4 },
  sectionTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 6 },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  seasonInfo: { flex: 1 },
  seasonLabel: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
  seasonMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  seasonCount: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  seasonMenuButton: { padding: 4 },
  overview: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  infoIcon: { marginRight: 10 },
  // infoLabel's flex: 1 is the spacer that pushes infoValue to the row's
  // right edge (no justifyContent needed) - don't touch it. infoValue needs
  // its own flexShrink + minWidth: 0 so a long value (e.g. rootFolderPath,
  // a full filesystem path) wraps within the row instead of overflowing -
  // same fix as app/downloads.tsx's file-path overflow.
  infoLabel: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  infoValue: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', flexShrink: 1, minWidth: 0 },
});
