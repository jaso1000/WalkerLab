import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { omdbApi, OmdbRatings } from '../../../src/api/omdb';
import { radarrApi, RadarrMovie, RadarrMovieFile, RadarrQualityProfile } from '../../../src/api/radarr';
import { extractCrewCredits, extractKeywords, tmdbApi, TmdbCredits } from '../../../src/api/tmdb';
import { ActionSheet, ActionSheetOption } from '../../../src/components/ActionSheet';
import { Badge } from '../../../src/components/Badge';
import { CastCrewSection } from '../../../src/components/CastCrewSection';
import { FileDetailsCard } from '../../../src/components/FileDetailsCard';
import { PosterGalleryModal } from '../../../src/components/PosterGalleryModal';
import { ReleaseTriptych } from '../../../src/components/ReleaseTriptych';
import { ReviewSources } from '../../../src/components/ReviewSources';
import { TagList } from '../../../src/components/TagList';
import { useServers } from '../../../src/context/ServersContext';
import { alert } from '../../../src/lib/alert';
import { AVAILABILITY_OPTIONS } from '../../../src/lib/constants';
import { deletedLibrary } from '../../../src/lib/deletedLibrary';
import { formatDate } from '../../../src/lib/format';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

// Radarr's own movie detail page (as opposed to Discover's detail page for
// browsing/adding) - hero backdrop, quick-action chips (monitor toggle,
// quality profile, search), file details, ratings, release triptych, tags,
// and cast & crew, all backed by a live Radarr fetch (Discover's version
// covers the not-yet-in-library case with TMDB data instead).

// One labeled details row; optionally tappable (shows a pencil icon) to
// open a picker for editable fields like Minimum Availability.
function InfoRow({
  icon,
  label,
  value,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: string | number;
  onPress?: () => void;
}) {
  if (value === undefined || value === null || value === '') return null;
  const Wrapper = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.infoRow} onPress={onPress}>
      <Ionicons name={icon} size={16} color={colors.accent} style={styles.infoIcon} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
      {onPress ? <Ionicons name="pencil" size={14} color={colors.accent} style={styles.infoPencil} /> : null}
    </Wrapper>
  );
}

// Builds the "In Theaters!"/"Coming Soon" banner shown for a movie that
// isn't downloaded yet - only shown pre-file, and only when there's a
// theatrical release date to say something useful about. Mentions the next
// upcoming digital/physical date when one's known, for a bit of extra
// context on when it might actually become available.
function statusBanner(movie: RadarrMovie): { title: string; message: string } | null {
  if (movie.hasFile) return null;
  const now = Date.now();
  const inCinemas = movie.inCinemas ? new Date(movie.inCinemas).getTime() : undefined;
  const digital = movie.digitalRelease ? new Date(movie.digitalRelease).getTime() : undefined;
  const physical = movie.physicalRelease ? new Date(movie.physicalRelease).getTime() : undefined;
  const nextRelease = [digital, physical].filter((d): d is number => !!d && d > now).sort((a, b) => a - b)[0];

  // A movie whose known digital/physical release date(s) have *also*
  // already passed is well past its theatrical window, even though
  // `inCinemas` itself is (permanently) in the past - the original check
  // only looked at `inCinemas <= now`, so a movie released a year ago with
  // both digital and physical already out still showed "In Theaters! This
  // movie is currently playing in theaters," since `nextRelease` filters
  // out past dates entirely rather than distinguishing "no known next date
  // yet" from "every known date has already passed." Only suppress the
  // banner when we positively know a later milestone happened; a movie
  // with only an `inCinemas` date populated (no digital/physical dates at
  // all yet) still gets the benefit of the doubt, matching the original
  // intent for a recently-released title Radarr hasn't filled in yet.
  const pastKnownMilestone = (digital !== undefined || physical !== undefined) && !nextRelease;

  if (inCinemas && inCinemas <= now && !pastKnownMilestone) {
    return {
      title: 'In Theaters!',
      message: nextRelease
        ? `This movie is currently playing in theaters. It's expected to release on ${formatDate(new Date(nextRelease).toISOString())}.`
        : "This movie is currently playing in theaters.",
    };
  }
  if (inCinemas && inCinemas > now) {
    return { title: 'Coming Soon', message: `This movie is expected in theaters on ${formatDate(movie.inCinemas)}.` };
  }
  return null;
}

export default function MovieDetailScreen() {
  const tabBarClearance = useTabBarClearance();
  const { id } = useLocalSearchParams<{ id: string }>();
  const movieId = Number(id);
  const { servers } = useServers();
  const config = servers.radarr;
  const tmdbConfig = servers.tmdb;
  const omdbConfig = servers.omdb;

  const [movie, setMovie] = useState<RadarrMovie | null>(null);
  const [file, setFile] = useState<RadarrMovieFile | null>(null);
  const [profiles, setProfiles] = useState<RadarrQualityProfile[]>([]);
  const [credits, setCredits] = useState<TmdbCredits | null>(null);
  const [productionCountry, setProductionCountry] = useState<string | undefined>(undefined);
  const [tags, setTags] = useState<string[]>([]);
  const [omdbRatings, setOmdbRatings] = useState<OmdbRatings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [searchMenuOpen, setSearchMenuOpen] = useState(false);
  const [availabilityMenuOpen, setAvailabilityMenuOpen] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [fileExpanded, setFileExpanded] = useState(false);
  const [posterGalleryOpen, setPosterGalleryOpen] = useState(false);

  // Loads the movie + its file (if any) from Radarr, then layers on optional
  // TMDB (cast/crew/keywords/production country) and OMDb (extra ratings)
  // data when those services are configured - each independently falls back
  // to an empty/null state on its own failure so one missing/misconfigured
  // service doesn't block the rest of the page from rendering.
  const load = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    try {
      const [m, profileList] = await Promise.all([radarrApi.getMovie(config, movieId), radarrApi.getQualityProfiles(config)]);
      setMovie(m);
      setProfiles(profileList);
      if (m.movieFileId) {
        setFile(await radarrApi.getMovieFile(config, m.movieFileId));
      } else {
        setFile(null);
      }
      if (tmdbConfig && m.tmdbId) {
        tmdbApi
          .movieDetail(tmdbConfig, m.tmdbId)
          .then((d) => {
            setCredits(d.credits ?? null);
            setProductionCountry(d.production_countries?.[0]?.name);
            setTags(extractKeywords(d).map((k) => k.name));
          })
          .catch(() => {
            setCredits(null);
            setProductionCountry(undefined);
            setTags([]);
          });
      } else {
        setCredits(null);
        setProductionCountry(undefined);
        setTags([]);
      }
      if (omdbConfig && m.imdbId) {
        omdbApi
          .byImdbId(omdbConfig, m.imdbId)
          .then(setOmdbRatings)
          .catch(() => setOmdbRatings(null));
      } else {
        setOmdbRatings(null);
      }
    } catch (e) {
      alert('Failed to load movie', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, movieId, tmdbConfig, omdbConfig]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // These three all follow the same optimistic-update pattern: apply the
  // change to local state immediately (so the UI feels instant), persist it
  // to Radarr, and roll back to the previous `movie` if the PUT fails.
  const toggleMonitored = async () => {
    if (!config || !movie) return;
    const updated = { ...movie, monitored: !movie.monitored };
    setMovie(updated);
    try {
      await radarrApi.updateMovie(config, updated);
    } catch (e) {
      setMovie(movie);
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const setMinimumAvailability = async (value: string) => {
    if (!config || !movie) return;
    const updated = { ...movie, minimumAvailability: value };
    setMovie(updated);
    try {
      await radarrApi.updateMovie(config, updated);
    } catch (e) {
      setMovie(movie);
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const setQualityProfile = async (qualityProfileId: number) => {
    if (!config || !movie) return;
    const updated = { ...movie, qualityProfileId };
    setMovie(updated);
    try {
      await radarrApi.updateMovie(config, updated);
    } catch (e) {
      setMovie(movie);
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  // Automatic search (Radarr's own grab logic decides the release) - the
  // Interactive search alternative is a router push to the releases screen,
  // listed alongside this in the same action sheet.
  const searchRelease = async () => {
    if (!config || !movie) return;
    setBusy(true);
    try {
      await radarrApi.searchMovieRelease(config, movie.id);
      alert('Search started', `Searching for ${movie.title}.`);
    } catch (e) {
      alert('Search failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const searchMenuOptions: ActionSheetOption[] = [
    { label: 'Automatic search', onPress: searchRelease },
    {
      label: 'Interactive search',
      onPress: () =>
        router.push(`/movie/${movieId}/releases?title=${encodeURIComponent(movie?.title ?? 'Movie search')}`),
    },
  ];

  const availabilityMenuOptions: ActionSheetOption[] = AVAILABILITY_OPTIONS.map((o) => ({
    label: o.label,
    onPress: () => setMinimumAvailability(o.value),
  }));

  const qualityMenuOptions: ActionSheetOption[] = profiles.map((p) => ({
    label: p.name,
    onPress: () => setQualityProfile(p.id),
  }));

  // Deletes just the downloaded file, keeping the movie monitored in the
  // library - distinct from `removeFromLibrary` below.
  const deleteFile = () => {
    if (!config || !movie?.movieFileId) return;
    alert('Delete File', 'This will delete the downloaded file from disk. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete File',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await radarrApi.deleteMovieFile(config, movie.movieFileId!);
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

  // The 3-way "Remove from Library" prompt: Remove Only keeps the file on
  // disk, Delete Files Too removes both. Either way, records the tmdbId as
  // locally "deleted" so Discover can show a "previously removed" badge/
  // banner even though Radarr itself no longer has any record of it.
  const removeFromLibrary = () => {
    if (!config || !movie) return;
    alert('Remove from Library', `Remove "${movie.title}" from Radarr?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove Only',
        onPress: async () => {
          setBusy(true);
          try {
            await radarrApi.deleteMovie(config, movie.id, false);
            await deletedLibrary.markMovieDeleted(movie.tmdbId);
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
            if (movie.movieFileId) {
              await radarrApi.deleteMovieFile(config, movie.movieFileId);
            }
            await radarrApi.deleteMovie(config, movie.id, false);
            await deletedLibrary.markMovieDeleted(movie.tmdbId);
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
        <Text style={styles.emptyText}>Radarr isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  if (loading || !movie) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  const backdrop = movie.images.find((i) => i.coverType === 'fanart') ?? movie.images.find((i) => i.coverType === 'poster');
  const poster = movie.images.find((i) => i.coverType === 'poster');
  const imdbRating = movie.ratings?.imdb?.value;
  const rtRating = movie.ratings?.rottenTomatoes?.value;
  const profileName = profiles.find((p) => p.id === movie.qualityProfileId)?.name;
  const banner = statusBanner(movie);
  const availabilityLabel = AVAILABILITY_OPTIONS.find((o) => o.value === movie.minimumAvailability)?.label ?? 'Unknown';

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
            <TouchableOpacity onPress={() => setPosterGalleryOpen(true)} disabled={!poster?.remoteUrl}>
              {poster?.remoteUrl ? (
                <Image source={{ uri: poster.remoteUrl }} style={styles.poster} cachePolicy="memory-disk" />
              ) : (
                <View style={[styles.poster, styles.posterPlaceholder]} />
              )}
            </TouchableOpacity>
            <View style={styles.heroInfo}>
              <Badge label={movie.hasFile ? 'Downloaded' : movie.status === 'inCinemas' ? 'In Theaters' : 'Missing'} tone={movie.hasFile ? 'success' : movie.status === 'inCinemas' ? 'accent' : 'danger'} />
              <Text style={styles.title}>{movie.title}</Text>
              <Text style={styles.meta}>
                {[movie.certification, movie.year, movie.runtime ? `${movie.runtime}m` : null].filter(Boolean).join(' · ')}
              </Text>
              {movie.genres && movie.genres.length > 0 ? (
                <Text style={styles.meta}>{movie.genres.join(' · ')}</Text>
              ) : null}
            </View>
          </View>
        </ImageBackground>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionChip} onPress={toggleMonitored}>
            <Ionicons name={movie.monitored ? 'bookmark' : 'bookmark-outline'} size={18} color={colors.accent} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionChip, styles.actionChipWide]}
            onPress={() => setQualityMenuOpen(true)}
            disabled={profiles.length === 0}
          >
            <Text style={styles.actionChipText}>{profileName ?? file?.quality.quality.name ?? 'No file'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionChip} onPress={() => setSearchMenuOpen(true)} disabled={busy}>
            <Ionicons name="search" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        {banner ? (
          <View style={styles.banner}>
            <Text style={styles.bannerTitle}>{banner.title}</Text>
            <Text style={styles.bannerMessage}>{banner.message}</Text>
          </View>
        ) : null}

        {file ? (
          <FileDetailsCard
            fileName={file.relativePath}
            size={file.size}
            qualityName={file.quality.quality.name}
            dateAdded={file.dateAdded}
            mediaInfo={file.mediaInfo}
            expanded={fileExpanded}
            onToggleExpand={() => setFileExpanded((v) => !v)}
            onDelete={deleteFile}
            deleting={busy}
            tint={colors.accent}
            badgeTone="accent"
          />
        ) : null}

        {movie.overview ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Overview</Text>
            <Text style={styles.overview}>{movie.overview}</Text>
          </View>
        ) : null}

        <ReviewSources
          imdb={imdbRating}
          rottenTomatoes={rtRating}
          metacritic={omdbRatings?.metacritic}
          tmdb={movie.ratings?.tmdb?.value}
          imdbId={movie.imdbId}
          tmdbId={movie.tmdbId}
          mediaType="movie"
          title={movie.title}
        />

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Details</Text>
          <ReleaseTriptych
            theatrical={formatDate(movie.inCinemas) ?? undefined}
            digital={formatDate(movie.digitalRelease) ?? undefined}
            physical={formatDate(movie.physicalRelease) ?? undefined}
            tint={colors.accent}
          />
          <View style={styles.detailsDivider} />
          <InfoRow icon="business-outline" label="Studio" value={movie.studio} />
          <InfoRow icon="globe-outline" label="Original Language" value={movie.originalLanguage?.name} />
          <InfoRow icon="flag-outline" label="Production Country" value={productionCountry} />
          <InfoRow icon="calendar-outline" label="Added" value={formatDate(movie.added) ?? undefined} />
          <InfoRow
            icon="alert-circle-outline"
            label="Min. Availability"
            value={availabilityLabel}
            onPress={() => setAvailabilityMenuOpen(true)}
          />
          <InfoRow icon="folder-outline" label="Root Path" value={movie.rootFolderPath} />
        </View>

        <TagList tags={tags} tint={colors.accent} />

        {credits ? (
          <CastCrewSection
            cast={credits.cast}
            directors={extractCrewCredits(credits.crew, ['Director'])}
            writers={extractCrewCredits(credits.crew, ['Writer', 'Screenplay', 'Story', 'Teleplay'])}
            tint={colors.accent}
          />
        ) : null}
      </ScrollView>

      <ActionSheet
        visible={searchMenuOpen}
        title="Search"
        options={searchMenuOptions}
        onClose={() => setSearchMenuOpen(false)}
      />
      <ActionSheet
        visible={availabilityMenuOpen}
        title="Minimum Availability"
        options={availabilityMenuOptions}
        onClose={() => setAvailabilityMenuOpen(false)}
      />
      <ActionSheet
        visible={qualityMenuOpen}
        title="Quality Profile"
        options={qualityMenuOptions}
        onClose={() => setQualityMenuOpen(false)}
      />
      <PosterGalleryModal
        visible={posterGalleryOpen}
        onClose={() => setPosterGalleryOpen(false)}
        tmdbConfig={tmdbConfig}
        mediaType="movie"
        tmdbId={movie.tmdbId}
        fallbackPosterUrl={poster?.remoteUrl}
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
  banner: { backgroundColor: colors.accentMuted, borderRadius: 14, padding: 16, margin: 16, marginTop: 14, gap: 4 },
  bannerTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  bannerMessage: { color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, margin: 16, marginTop: 14, gap: 8 },
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
  infoPencil: { marginLeft: 8 },
  detailsDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginTop: 12 },
  sectionTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  overview: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
});
