// A person on the TV (the phone's app/discover/person, reached from Cast & Crew): photo, department
// and biography, then their combined movie and TV credits as a grid - crew roles first when someone
// both acted in and directed a title, sorted by rating then popularity, as on the phone. OK opens
// the title's Discover page.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { tmdbApi, tmdbImageUrl, TmdbPerson, TmdbPersonCredit } from '../../../../src/api/tmdb';
import { colors } from '../../../../src/theme/colors';
import { POSTER_W, PosterTile } from '../../../components/Cards';
import { errText, ListFrame, Loading, Message, NotConfigured, SIDE, SNAP_CELL, TV_GRID } from '../../../components/ui';
import { useEnabledServers } from '../../../lib/useEnabledServers';

const COLUMNS = 6;
const tint = colors.sectionGreen;
const creditDate = (c: TmdbPersonCredit) => c.release_date ?? c.first_air_date ?? '';

export default function TvPerson() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { servers, ready } = useEnabledServers();
  const config = servers.tmdb;
  const [person, setPerson] = useState<TmdbPerson | null>(null);
  const [credits, setCredits] = useState<TmdbPersonCredit[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    Promise.all([tmdbApi.personDetail(config, Number(id)), tmdbApi.personCombinedCredits(config, Number(id))])
      .then(([p, c]) => {
        const seen = new Set<string>();
        const list = [...c.crew, ...c.cast].filter((x) => {
          const key = `${x.media_type}:${x.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        list.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0) || (b.popularity ?? 0) - (a.popularity ?? 0) || creditDate(b).localeCompare(creditDate(a)));
        setPerson(p);
        setCredits(list);
      })
      .catch((e) => setError(errText(e)));
  }, [config, id]);

  if (ready && !config) return <NotConfigured service="TMDB" />;
  if (error) return <Message text={error} error />;
  if (!person) return <Loading tint={tint} />;

  const photo = tmdbImageUrl(person.profile_path, 'w342');
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ListFrame>
        <FlatList
          {...TV_GRID}
          data={credits}
          keyExtractor={(c) => `${c.media_type}-${c.id}`}
          numColumns={COLUMNS}
          windowSize={7}
          columnWrapperStyle={{ gap: 18 }}
          contentContainerStyle={{ paddingHorizontal: SIDE, paddingTop: 36, paddingBottom: 40, gap: 14 }}
          ListHeaderComponent={
            <View style={{ flexDirection: 'row', gap: 24, marginBottom: 18 }}>
              <View style={{ width: 150, height: 225, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
                {photo ? <Image source={{ uri: photo }} style={{ width: 150, height: 225 }} contentFit="cover" /> : null}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.textPrimary, fontSize: 32, fontWeight: '700' }}>{person.name}</Text>
                <Text style={{ color: tint, fontSize: 15, marginTop: 4 }}>
                  {[person.known_for_department, `${credits.length} credits`].filter(Boolean).join('  ·  ')}
                </Text>
                {person.biography ? (
                  <Text style={{ color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginTop: 12 }} numberOfLines={7}>
                    {person.biography}
                  </Text>
                ) : null}
              </View>
            </View>
          }
          renderItem={({ item: c, index }) => (
            <View style={{ width: POSTER_W }} {...SNAP_CELL}>
              <PosterTile
                title={c.title ?? c.name ?? ''}
                poster={tmdbImageUrl(c.poster_path, 'w342')}
                recyclingKey={`${c.media_type}-${c.id}`}
                subtitle={c.character || c.job || (creditDate(c).slice(0, 4) || undefined)}
                preferredFocus={index === 0}
                onPress={() => router.push(`/discover/${c.media_type}/${c.id}` as never)}
              />
            </View>
          )}
        />
      </ListFrame>
    </View>
  );
}
