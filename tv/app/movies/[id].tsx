// A movie's TV detail page: backdrop, title and ratings, the three release dates the phone's
// triptych shows, what file is on disk, and the phone's main actions (search, monitor). Same Radarr
// calls as app/movie/[id] on the phone.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RadarrMovie, radarrApi } from '../../../src/api/radarr';
import { formatBytes } from '../../../src/lib/format';
import { alert } from '../../../src/lib/alert';
import { colors } from '../../../src/theme/colors';
import { ActionButton, ButtonRow, Backdrop, detailStyles, OpenInButtons, TitleBlock, useNotice } from '../../components/Detail';
import { fileDetailsText } from '../../lib/fileDetails';
import { backdropUrl, logoUrl } from '../../lib/images';
import { useEnabledServers } from '../../lib/useEnabledServers';
import { TV_LIST } from '../../components/ui';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

const runtime = (mins?: number) => (mins ? `${Math.floor(mins / 60) ? `${Math.floor(mins / 60)}h ` : ''}${mins % 60}m` : undefined);

/** Radarr's release dates are calendar days stored as UTC midnight. */
function releaseDay(date?: string): { text: string; past: boolean } | null {
  if (!date) return null;
  const d = new Date(date);
  const day = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    text: day.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }),
    past: day.getTime() <= Date.now(),
  };
}

type MovieWithFile = RadarrMovie & { movieFile?: { size?: number; quality?: { quality?: { name?: string } } } };

export default function TvMovieDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const movieId = Number(id);
  const { servers, ready } = useEnabledServers();
  const config = servers.radarr;
  const [movie, setMovie] = useState<MovieWithFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notice = useNotice();

  const load = useCallback(async () => {
    if (!config) return;
    try {
      setMovie(await radarrApi.getMovie(config, movieId));
    } catch (e) {
      setError(errText(e));
    }
  }, [config, movieId]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  if (ready && !config) return <Text style={detailStyles.error}>Radarr is not set up in this profile.</Text>;
  if (error) return <Text style={detailStyles.error}>{error}</Text>;
  if (!movie) {
    return (
      <View style={detailStyles.loading}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  const fail = (e: unknown) => alert('Failed', errText(e));
  const moreMenu = () =>
    alert(movie.title, undefined, [
      { text: 'Interactive search', onPress: () => router.push(`/releases?service=radarr&movieId=${movie.id}&title=${encodeURIComponent(movie.title)}` as never) },
      ...(movie.hasFile && movie.movieFileId
        ? [
            {
              text: 'File details',
              onPress: () =>
                radarrApi
                  .getMovieFile(config!, movie.movieFileId!)
                  .then((f) => alert('File details', fileDetailsText(f)))
                  .catch(fail),
            },
            {
              text: 'Delete file',
              style: 'destructive' as const,
              onPress: () =>
                alert('Delete File', `Delete the downloaded file for "${movie.title}"? This cannot be undone.`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => radarrApi.deleteMovieFile(config!, movie.movieFileId!).then(load).catch(fail) },
                ]),
            },
          ]
        : []),
      {
        text: 'Remove from Library',
        style: 'destructive' as const,
        onPress: () =>
          alert('Remove from Library', `Remove "${movie.title}" from Radarr?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove Only', onPress: () => radarrApi.deleteMovie(config!, movie.id, false).then(() => router.back()).catch(fail) },
            { text: 'Remove and delete files', style: 'destructive', onPress: () => radarrApi.deleteMovie(config!, movie.id, true).then(() => router.back()).catch(fail) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ]);

  const tmdb = movie.ratings?.tmdb?.value;
  const imdb = movie.ratings?.imdb?.value;
  const releases = [
    { label: 'In cinemas', day: releaseDay(movie.inCinemas) },
    { label: 'Digital', day: releaseDay(movie.digitalRelease) },
    { label: 'Physical', day: releaseDay(movie.physicalRelease) },
  ];
  const file = movie.movieFile;

  return (
    <View style={detailStyles.screen}>
      <Backdrop uri={backdropUrl(movie.images)} />
      <ScrollView {...TV_LIST} contentContainerStyle={detailStyles.content} showsVerticalScrollIndicator={false}>
        <TitleBlock
          title={movie.title}
          logo={logoUrl(movie.images)}
          meta={[
            movie.year ? String(movie.year) : undefined,
            runtime(movie.runtime),
            movie.certification,
            movie.studio,
            tmdb ? `★ ${tmdb.toFixed(1)}` : undefined,
            imdb ? `IMDb ${imdb.toFixed(1)}` : undefined,
          ]}
          genres={movie.genres}
          overview={movie.overview}
        />

        <ButtonRow>
          <ActionButton
            icon="search"
            label={movie.hasFile ? 'Upgrade' : 'Search'}
            tint={colors.accent}
            primary
            preferredFocus
            onPress={async () => {
              try {
                await radarrApi.searchMovieRelease(config!, movie.id);
                notice.show(`Searching for ${movie.title}…`);
              } catch (e) {
                notice.show(errText(e), true);
              }
            }}
          />
          <ActionButton
            icon={movie.monitored ? 'eye' : 'eye-off'}
            label={movie.monitored ? 'Monitored' : 'Not monitored'}
            tint={movie.monitored ? colors.success : colors.textMuted}
            onPress={async () => {
              try {
                const updated = await radarrApi.updateMovie(config!, { ...movie, monitored: !movie.monitored });
                setMovie({ ...updated, movieFile: movie.movieFile });
                notice.show(updated.monitored ? 'Now monitored' : 'No longer monitored');
              } catch (e) {
                notice.show(errText(e), true);
              }
            }}
          />
          <ActionButton icon="ellipsis-horizontal" label="More" tint={colors.accent} onPress={moreMenu} />
          <OpenInButtons title={movie.title} year={movie.year} kind="movie" onError={(m) => notice.show(m, true)} />
        </ButtonRow>
        {notice.view}

        <View style={styles.cards}>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>RELEASES</Text>
            {releases.map((r) => (
              <View key={r.label} style={styles.releaseRow}>
                <Text style={styles.releaseLabel}>{r.label}</Text>
                <Text style={[styles.releaseValue, r.day && !r.day.past && { color: colors.info }]}>{r.day ? r.day.text : '—'}</Text>
              </View>
            ))}
          </View>
          <View style={styles.card}>
            <Text style={styles.cardLabel}>ON DISK</Text>
            {movie.hasFile ? (
              <>
                <Text style={[styles.fileState, { color: colors.success }]}>Downloaded</Text>
                <Text style={styles.fileMeta}>
                  {[file?.quality?.quality?.name, formatBytes(file?.size ?? movie.sizeOnDisk)].filter(Boolean).join('   ·   ')}
                </Text>
              </>
            ) : (
              <Text style={[styles.fileState, { color: movie.monitored ? colors.accent : colors.textMuted }]}>
                {movie.monitored ? 'Missing' : 'Not monitored'}
              </Text>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  cards: { flexDirection: 'row', gap: 16, marginTop: 18 },
  card: { backgroundColor: 'rgba(29,31,39,0.85)', borderRadius: 12, padding: 16, minWidth: 250, borderWidth: 1, borderColor: colors.border },
  cardLabel: { color: colors.textMuted, fontSize: 11, letterSpacing: 1.4, marginBottom: 10 },
  releaseRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 24, marginBottom: 6 },
  releaseLabel: { color: colors.textSecondary, fontSize: 14 },
  releaseValue: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  fileState: { fontSize: 18, fontWeight: '700' },
  fileMeta: { color: colors.textSecondary, fontSize: 14, marginTop: 6 },
});
