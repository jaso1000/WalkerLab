// Discover search on the TV (the phone's search box above Discover): Movies & TV searches TMDB, Artists
// searches Last.fm (the phone's Music tab search), 350 ms after typing stops. OK on a movie or show
// offers Open and the phone's one-step Quick add (src/lib/quickAdd); OK on an artist opens its
// Discover page, where it can be added to Lidarr. `music=1` starts on Artists.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { lastfmApi, LastfmArtist } from '../../../src/api/lastfm';
import { tmdbApi, tmdbImageUrl, TmdbSearchResult } from '../../../src/api/tmdb';
import { alert } from '../../../src/lib/alert';
import { quickAddToLibrary } from '../../../src/lib/quickAdd';
import { colors } from '../../../src/theme/colors';
import { listStyles } from '../../components/DownloadClientView';
import { useArtistArt, artistHref } from '../../components/Music';
import { Thumb } from '../../components/TautulliHistory';
import { Chip, errText, ListFrame, ListRow, Loading, Message, ScreenHeader, SIDE, TV_LIST, TvTextField } from '../../components/ui';
import { useEnabledServers } from '../../lib/useEnabledServers';

const tint = colors.sectionGreen;

function ArtistResult({ artist, preferredFocus }: { artist: LastfmArtist; preferredFocus?: boolean }) {
  const art = useArtistArt(artist.name);
  return (
    <ListRow
      title={artist.name}
      subtitle={artist.listeners ? `${Number(artist.listeners).toLocaleString()} listeners` : undefined}
      thumb={<Thumb uri={art} />}
      preferredFocus={preferredFocus}
      onPress={() => router.push(artistHref({ name: artist.name }) as never)}
    />
  );
}

export default function TvDiscoverSearch() {
  const params = useLocalSearchParams<{ music?: string }>();
  const { servers } = useEnabledServers();
  const [music, setMusic] = useState(params.music === '1');
  const [query, setQuery] = useState('');
  const [media, setMedia] = useState<TmdbSearchResult[]>([]);
  const [artists, setArtists] = useState<LastfmArtist[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    const q = query.trim();
    if (!q) {
      setMedia([]);
      setArtists([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        setError(null);
        if (music) setArtists(servers.lastfm ? await lastfmApi.searchArtists(servers.lastfm, q) : []);
        else if (servers.tmdb) setMedia((await tmdbApi.searchMulti(servers.tmdb, q)).results.filter((r) => r.media_type === 'movie' || r.media_type === 'tv'));
      } catch (e) {
        setError(errText(e));
      } finally {
        setSearching(false);
      }
    }, 350);
  }, [query, music, servers.lastfm, servers.tmdb]);

  const openMedia = (r: TmdbSearchResult) => {
    const type = r.media_type === 'movie' ? 'movie' : 'tv';
    const title = r.title ?? r.name ?? '';
    alert(title, undefined, [
      { text: 'Open', onPress: () => router.push(`/discover/${type}/${r.id}` as never) },
      {
        text: `Quick add to ${type === 'movie' ? 'Radarr' : 'Sonarr'}`,
        onPress: () =>
          quickAddToLibrary({ tmdb: servers.tmdb, radarr: servers.radarr, sonarr: servers.sonarr }, r.id, type)
            .then(() => alert('Added', `${title} was added to your library.`))
            .catch((e) => alert('Failed to add', errText(e))),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const unavailable = music ? !servers.lastfm && 'Connect Last.fm in Settings to search artists.' : !servers.tmdb && 'Add a TMDB API key in Settings to search.';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Search" tint={tint} />
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center', paddingHorizontal: SIDE, marginBottom: 8 }}>
        <TvTextField value={query} onChangeText={setQuery} placeholder={music ? 'Search artists…' : 'Search movies & TV shows…'} preferredFocus style={{ flex: 1 }} />
        <Chip label="Movies & TV" on={!music} tint={tint} onPress={() => setMusic(false)} />
        <Chip label="Artists" on={music} tint={tint} onPress={() => setMusic(true)} />
      </View>
      {unavailable ? (
        <Message text={unavailable} />
      ) : searching ? (
        <Loading tint={tint} />
      ) : music ? (
        <ListFrame>
          <FlatList
            {...TV_LIST}
            data={artists}
            keyExtractor={(a, i) => `${a.mbid || a.name}-${i}`}
            contentContainerStyle={listStyles.list}
            ListEmptyComponent={query.trim() ? <Message text={error ?? `No results for "${query}".`} error={!!error} /> : null}
            renderItem={({ item }) => <ArtistResult artist={item} />}
          />
        </ListFrame>
      ) : (
        <ListFrame>
          <FlatList
            {...TV_LIST}
            data={media}
            keyExtractor={(r) => `${r.media_type}-${r.id}`}
            contentContainerStyle={listStyles.list}
            ListEmptyComponent={query.trim() ? <Message text={error ?? `No results for "${query}".`} error={!!error} /> : null}
            renderItem={({ item: r }) => (
              <ListRow
                title={r.title ?? r.name ?? ''}
                subtitle={[r.media_type === 'movie' ? 'Movie' : 'TV Show', (r.release_date ?? r.first_air_date)?.slice(0, 4), r.vote_average ? `★ ${r.vote_average.toFixed(1)}` : ''].filter(Boolean).join(' · ')}
                thumb={<Thumb uri={tmdbImageUrl(r.poster_path, 'w185')} />}
                onPress={() => openMedia(r)}
              />
            )}
          />
        </ListFrame>
      )}
    </View>
  );
}
