// A Discover title (TMDB) on the TV: backdrop, title, overview, and either "Open in library" when
// Radarr/Sonarr already have it, or "Add to Radarr/Sonarr" through the same one-step add the phone's
// Discover uses (src/lib/quickAdd: last-used quality profile, first root folder), or "Options" for
// the full add form (tv/app/discover/add). Plus Open in Wholphin / Plex, then Cast & Crew (directors
// and writers first; OK opens their filmography) and More Like This, as on the phone.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { radarrApi } from '../../../../src/api/radarr';
import { sonarrApi, SonarrSeries } from '../../../../src/api/sonarr';
import { extractCrewCredits, normalizeAggregateCredits, tmdbApi, tmdbImageUrl, TmdbMovie, TmdbMovieDetail, TmdbTv, TmdbTvDetail } from '../../../../src/api/tmdb';
import { MediaKind } from '../../../../src/lib/discoverCategories';
import { quickAddToLibrary } from '../../../../src/lib/quickAdd';
import { getDefaultRegion } from '../../../../src/lib/preferences';
import { streamingProviders } from '../../../../src/components/StreamingProviders';
import { colors } from '../../../../src/theme/colors';
import { PosterTile } from '../../../components/Cards';
import { ActionButton, ButtonRow, Backdrop, detailStyles, OpenInButtons, TitleBlock, useNotice } from '../../../components/Detail';
import { DiscoverPosterRow } from '../../../components/DiscoverRows';
import { Row } from '../../../components/Row';
import { useEnabledServers } from '../../../lib/useEnabledServers';
import { TV_LIST } from '../../../components/ui';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');
const backdrop = (path?: string) => (path ? `https://image.tmdb.org/t/p/w1280${path}` : undefined);

export default function TvDiscoverDetail() {
  const { mediaType, id } = useLocalSearchParams<{ mediaType: string; id: string }>();
  const kind: MediaKind = mediaType === 'tv' ? 'tv' : 'movie';
  const tmdbId = Number(id);
  const { servers, ready } = useEnabledServers();
  const [detail, setDetail] = useState<TmdbMovieDetail | TmdbTvDetail | null>(null);
  // The library item's own page, when Radarr/Sonarr already track this title.
  const [libraryHref, setLibraryHref] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recommendations, setRecommendations] = useState<(TmdbMovie | TmdbTv)[]>([]);
  // "Streaming on …" in the profile's TMDB region (the phone's StreamingProviders row).
  const [streaming, setStreaming] = useState<string[]>([]);
  const notice = useNotice();

  const findInLibrary = useCallback(async () => {
    if (kind === 'movie') {
      if (!servers.radarr) return null;
      const movies = await radarrApi.getMovies(servers.radarr);
      const m = movies.find((x) => x.tmdbId === tmdbId);
      return m ? `/movies/${m.id}` : null;
    }
    if (!servers.sonarr || !servers.tmdb) return null;
    const [series, ids] = await Promise.all([sonarrApi.getSeries(servers.sonarr), tmdbApi.tvExternalIds(servers.tmdb, tmdbId)]);
    const s = series.find((x) => (x as SonarrSeries & { tmdbId?: number }).tmdbId === tmdbId || (ids.tvdb_id && x.tvdbId === ids.tvdb_id));
    return s ? `/shows/${s.id}` : null;
  }, [kind, tmdbId, servers.radarr, servers.sonarr, servers.tmdb]);

  useEffect(() => {
    if (!ready || !servers.tmdb) return;
    (kind === 'movie' ? tmdbApi.movieDetail(servers.tmdb, tmdbId) : tmdbApi.tvDetail(servers.tmdb, tmdbId))
      .then(setDetail)
      .catch((e) => setError(errText(e)));
    findInLibrary().then(setLibraryHref).catch(() => setLibraryHref(null));
    (kind === 'movie' ? tmdbApi.movieRecommendations(servers.tmdb, tmdbId) : tmdbApi.tvRecommendations(servers.tmdb, tmdbId))
      .then((r) => setRecommendations(r.results))
      .catch(() => setRecommendations([]));
    Promise.all([kind === 'movie' ? tmdbApi.movieWatchProviders(servers.tmdb, tmdbId) : tmdbApi.tvWatchProviders(servers.tmdb, tmdbId), getDefaultRegion()])
      .then(([all, region]) => setStreaming(streamingProviders(all[region]).map((p) => p.provider_name)))
      .catch(() => setStreaming([]));
  }, [ready, servers.tmdb, kind, tmdbId, findInLibrary]);

  if (ready && !servers.tmdb) return <Text style={detailStyles.error}>TMDB is not set up in this profile.</Text>;
  if (error) return <Text style={detailStyles.error}>{error}</Text>;
  if (!detail) {
    return (
      <View style={detailStyles.loading}>
        <ActivityIndicator color={colors.sectionGreen} size="large" />
      </View>
    );
  }

  const isMovie = kind === 'movie';
  const movie = detail as TmdbMovieDetail;
  const tv = detail as TmdbTvDetail;
  const title = isMovie ? movie.title : tv.name;
  const date = isMovie ? movie.release_date : tv.first_air_date;
  const year = date ? Number(date.slice(0, 4)) : undefined;
  const service = isMovie ? 'Radarr' : 'Sonarr';
  const tint = isMovie ? colors.accent : colors.sonarr;
  const credits = isMovie ? (movie.credits ?? { cast: [], crew: [] }) : normalizeAggregateCredits(tv.aggregate_credits);
  const people = [
    ...extractCrewCredits(credits.crew, ['Director']).map((c) => ({ ...c, role: 'Director' })),
    ...extractCrewCredits(credits.crew, ['Writer', 'Screenplay', 'Story', 'Teleplay']).map((c) => ({ ...c, role: 'Writer' })),
    ...credits.cast.slice(0, 20).map((c) => ({ id: c.id, name: c.name, profile_path: c.profile_path, role: c.character ?? '' })),
  ];

  return (
    <View style={detailStyles.screen}>
      <Backdrop uri={backdrop(detail.backdrop_path)} />
      <ScrollView {...TV_LIST} contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={[detailStyles.content, { paddingBottom: 20 }]}>
        <TitleBlock
          title={title}
          meta={[
            year ? String(year) : undefined,
            isMovie
              ? movie.runtime
                ? `${Math.floor(movie.runtime / 60) ? `${Math.floor(movie.runtime / 60)}h ` : ''}${movie.runtime % 60}m`
                : undefined
              : tv.number_of_seasons
                ? `${tv.number_of_seasons} season${tv.number_of_seasons === 1 ? '' : 's'}`
                : undefined,
            isMovie ? undefined : tv.networks?.[0]?.name,
            detail.vote_average ? `★ ${detail.vote_average.toFixed(1)}` : undefined,
            isMovie ? 'Movie' : 'TV Show',
          ]}
          genres={detail.genres?.map((g) => g.name)}
          overview={detail.overview}
        />
        <ButtonRow>
          {libraryHref ? (
            <ActionButton icon="library-outline" label="Open in library" tint={tint} primary preferredFocus onPress={() => router.push(libraryHref as never)} />
          ) : (
            <ActionButton
              icon="add"
              label={`Add to ${service}`}
              tint={tint}
              primary
              preferredFocus
              onPress={async () => {
                try {
                  await quickAddToLibrary({ tmdb: servers.tmdb, radarr: servers.radarr, sonarr: servers.sonarr }, tmdbId, kind);
                  notice.show(`Added to ${service} - searching for it now`);
                  setLibraryHref(await findInLibrary());
                } catch (e) {
                  notice.show(errText(e), true);
                }
              }}
            />
          )}
          {!libraryHref ? (
            <ActionButton
              icon="options-outline"
              label="Options"
              tint={tint}
              onPress={() => router.push(`/discover/add?mediaType=${kind}&id=${tmdbId}&title=${encodeURIComponent(title)}` as never)}
            />
          ) : null}
          <OpenInButtons title={title} year={year} kind={kind} onError={(m) => notice.show(m, true)} />
        </ButtonRow>
        {streaming.length > 0 ? (
          <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: 16 }}>
            Streaming on <Text style={{ color: colors.textPrimary, fontWeight: '600' }}>{streaming.slice(0, 6).join(', ')}</Text>
          </Text>
        ) : null}
        {notice.view}
        </View>
        {people.length > 0 ? (
          <Row title="Cast & Crew" accent={colors.sectionGreen}>
            {people.map((c, i) => (
              <PosterTile
                key={`${c.id}-${c.role}-${i}`}
                title={c.name}
                subtitle={c.role || undefined}
                poster={tmdbImageUrl(c.profile_path, 'w185')}
                recyclingKey={`person-${c.id}`}
                onPress={() => router.push(`/discover/person/${c.id}` as never)}
              />
            ))}
          </Row>
        ) : null}
        <DiscoverPosterRow
          title="More Like This"
          items={recommendations.map((r) => ({
            id: r.id,
            title: isMovie ? (r as TmdbMovie).title : (r as TmdbTv).name,
            posterUrl: tmdbImageUrl(r.poster_path),
            rating: r.vote_average,
          }))}
          onPressItem={(item) => router.push(`/discover/${kind}/${item.id}` as never)}
        />
      </ScrollView>
    </View>
  );
}
