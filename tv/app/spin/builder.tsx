// Making or editing a wheel on the TV (the phone's app/spin/builder): a name, "remove title after
// landing on it", and the titles - picked from the Radarr movies, the Sonarr shows, or a TMDB search,
// each list filtered by typing. OK on a title adds or removes it (a tick shows it's on the wheel);
// "On this wheel" lists the picks. Item ids follow the phone's scheme (`movie-12`, `tv-tmdb-1399`)
// so the same wheel works in both apps.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { radarrApi, RadarrMovie } from '../../../src/api/radarr';
import { sonarrApi, SonarrSeries } from '../../../src/api/sonarr';
import { tmdbApi, tmdbImageUrl } from '../../../src/api/tmdb';
import { useProfiles } from '../../../src/context/ProfilesContext';
import { alert } from '../../../src/lib/alert';
import { getWheels, newWheelId, saveWheel, Wheel, WheelItem } from '../../../src/lib/wheels';
import { colors } from '../../../src/theme/colors';
import { listStyles } from '../../components/DownloadClientView';
import { ActionButton } from '../../components/Detail';
import { Thumb } from '../../components/TautulliHistory';
import { errText, ListFrame, ListRow, Message, ScreenHeader, SIDE, TabChips, ToggleRow, TV_LIST, TvTextField } from '../../components/ui';
import { posterUrl } from '../../lib/images';
import { useEnabledServers } from '../../lib/useEnabledServers';

const TABS = ['On this wheel', 'Movies', 'TV Shows', 'Search TMDB'] as const;
const tint = colors.spin;

const fromMovie = (m: RadarrMovie): WheelItem => ({ id: `movie-${m.id}`, mediaType: 'movie', libraryId: m.id, title: m.title, posterUrl: posterUrl(m.images) });
const fromSeries = (s: SonarrSeries): WheelItem => ({ id: `tv-${s.id}`, mediaType: 'tv', libraryId: s.id, title: s.title, posterUrl: posterUrl(s.images) });

export default function TvSpinBuilder() {
  const { wheelId } = useLocalSearchParams<{ wheelId?: string }>();
  const { activeProfileId } = useProfiles();
  const { servers, ready } = useEnabledServers();
  const [existing, setExisting] = useState<Wheel | null>(null);
  const [name, setName] = useState('');
  const [removeAfterSpin, setRemoveAfterSpin] = useState(false);
  const [items, setItems] = useState<WheelItem[]>([]);
  const [tab, setTab] = useState(1);
  const [filter, setFilter] = useState('');
  const [movies, setMovies] = useState<WheelItem[]>([]);
  const [shows, setShows] = useState<WheelItem[]>([]);
  const [tmdbResults, setTmdbResults] = useState<WheelItem[]>([]);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!wheelId) return;
    getWheels(activeProfileId).then((ws) => {
      const w = ws.find((x) => x.id === wheelId);
      if (!w) return;
      setExisting(w);
      setName(w.name);
      setRemoveAfterSpin(w.removeAfterSpin);
      setItems(w.items);
      setTab(0);
    });
  }, [activeProfileId, wheelId]);

  useEffect(() => {
    if (!ready) return;
    if (servers.radarr) radarrApi.getMovies(servers.radarr).then((l) => setMovies(l.map(fromMovie).sort((a, b) => a.title.localeCompare(b.title)))).catch(() => {});
    if (servers.sonarr) sonarrApi.getSeries(servers.sonarr).then((l) => setShows(l.map(fromSeries).sort((a, b) => a.title.localeCompare(b.title)))).catch(() => {});
  }, [ready, servers.radarr, servers.sonarr]);

  // TMDB search, debounced like the phone's 350 ms.
  useEffect(() => {
    if (tab !== 3 || !servers.tmdb) return;
    if (debounce.current) clearTimeout(debounce.current);
    if (!filter.trim()) {
      setTmdbResults([]);
      return;
    }
    debounce.current = setTimeout(() => {
      tmdbApi
        .searchMulti(servers.tmdb!, filter.trim())
        .then((res) =>
          setTmdbResults(
            res.results
              .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
              .map((r) => ({
                id: `${r.media_type}-tmdb-${r.id}`,
                mediaType: r.media_type as 'movie' | 'tv',
                tmdbId: r.id,
                title: (r.media_type === 'movie' ? r.title : r.name) ?? '',
                posterUrl: tmdbImageUrl(r.poster_path),
              }))
          )
        )
        .catch(() => setTmdbResults([]));
    }, 350);
  }, [filter, tab, servers.tmdb]);

  const picked = useMemo(() => new Set(items.map((i) => i.id)), [items]);
  const source = tab === 0 ? items : tab === 1 ? movies : tab === 2 ? shows : tmdbResults;
  const shown = tab === 3 || !filter.trim() ? source : source.filter((i) => i.title.toLowerCase().includes(filter.trim().toLowerCase()));

  const toggle = (item: WheelItem) => setItems((prev) => (prev.some((i) => i.id === item.id) ? prev.filter((i) => i.id !== item.id) : [...prev, item]));

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) return alert('Name needed', 'Give the wheel a name first.');
    if (items.length === 0) return alert('No titles yet', 'Add at least one title to the wheel.');
    const now = new Date().toISOString();
    const next: Wheel = existing
      ? { ...existing, name: trimmed, removeAfterSpin, items, updatedAt: now }
      : { id: newWheelId(), name: trimmed, removeAfterSpin, items, shared: false, createdAt: now, updatedAt: now };
    try {
      await saveWheel(activeProfileId, next);
      router.back();
    } catch (e) {
      alert('Failed to save wheel', errText(e));
    }
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={existing ? 'Edit wheel' : 'New wheel'} tint={tint} count={items.length} right={<ActionButton icon="checkmark" label="Save" tint={tint} primary onPress={save} />} />
      <View style={styles.form}>
        <TvTextField value={name} onChangeText={setName} placeholder="Wheel name" style={{ flex: 1 }} preferredFocus={!existing} />
        <View style={{ width: 380 }}>
          <ToggleRow label="Remove title after landing on it" value={removeAfterSpin} onChange={setRemoveAfterSpin} tint={tint} />
        </View>
      </View>
      <View style={{ paddingHorizontal: SIDE }}>
        <TabChips tabs={TABS} active={tab} onChange={setTab} tint={tint} />
        {tab !== 0 ? (
          <TvTextField
            value={filter}
            onChangeText={setFilter}
            placeholder={tab === 3 ? 'Search movies & TV…' : tab === 1 ? 'Filter movies…' : 'Filter TV shows…'}
            style={{ marginTop: 12 }}
          />
        ) : null}
      </View>
      <ListFrame>
        <FlatList
          {...TV_LIST}
          data={shown}
          keyExtractor={(i) => i.id}
          contentContainerStyle={listStyles.list}
          initialNumToRender={20}
          windowSize={7}
          ListEmptyComponent={
            <Message text={tab === 0 ? 'Nothing on this wheel yet - add titles from the other tabs.' : tab === 3 ? (servers.tmdb ? 'Type to search TMDB.' : 'TMDB is not set up in this profile.') : 'No titles.'} />
          }
          renderItem={({ item }) => {
            const on = picked.has(item.id);
            return (
              <ListRow
                title={item.title}
                subtitle={item.mediaType === 'movie' ? 'Movie' : 'TV show'}
                meta={on ? '✓ On wheel' : 'Add'}
                metaColor={on ? colors.success : colors.textMuted}
                thumb={<Thumb uri={item.posterUrl} />}
                onPress={() => toggle(item)}
              />
            );
          }}
        />
      </ListFrame>
      <Text style={styles.hint}>OK adds or removes a title</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  form: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: SIDE, marginTop: 4, marginBottom: 6 },
  hint: { position: 'absolute', bottom: 10, right: 30, color: colors.textMuted, fontSize: 12 },
});
