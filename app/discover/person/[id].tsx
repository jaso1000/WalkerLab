import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { tmdbApi, tmdbImageUrl, TmdbPerson, TmdbPersonCredit } from '../../../src/api/tmdb';
import { useServers } from '../../../src/context/ServersContext';
import { colors } from '../../../src/theme/colors';

// Cast & Crew's "tap through to filmography" page - shows a person's bio and
// their combined movie+TV credit history as a poster grid, each tappable
// back into Discover's own detail page flow so you can browse/add straight
// from someone's filmography.

// Whichever release-date field applies to this credit's media type.
function creditDate(item: TmdbPersonCredit): string {
  return item.release_date ?? item.first_air_date ?? '';
}

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const personId = Number(id);
  const { servers } = useServers();
  const config = servers.tmdb;

  const [person, setPerson] = useState<TmdbPerson | null>(null);
  const [credits, setCredits] = useState<TmdbPersonCredit[]>([]);
  const [loading, setLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!config || !personId) return;
      setLoading(true);
      Promise.all([tmdbApi.personDetail(config, personId), tmdbApi.personCombinedCredits(config, personId)])
        .then(([p, c]) => {
          setPerson(p);
          // De-dupes by media_type+id (a person can appear in both cast and
          // crew lists for the same title, e.g. an actor-director), then
          // sorts the merged list by rating, then popularity, then recency.
          const seen = new Set<string>();
          // Crew credits (directing/writing/etc.) first so a title someone
          // both directed and acted in surfaces their crew role - that's
          // usually the more relevant contribution when you tapped through
          // from a Director/Writer credit rather than a cast member.
          const deduped = [...c.crew, ...c.cast].filter((item) => {
            const key = `${item.media_type}:${item.id}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
          deduped.sort((a, b) => {
            const ratingDiff = (b.vote_average ?? 0) - (a.vote_average ?? 0);
            if (ratingDiff !== 0) return ratingDiff;
            const popularityDiff = (b.popularity ?? 0) - (a.popularity ?? 0);
            if (popularityDiff !== 0) return popularityDiff;
            return creditDate(b).localeCompare(creditDate(a));
          });
          setCredits(deduped);
        })
        .catch(() => {
          setPerson(null);
          setCredits([]);
        })
        .finally(() => setLoading(false));
    }, [config, personId])
  );

  if (!config) {
    return (
      <SafeAreaView style={styles.center} edges={['top']}>
        <Text style={styles.emptyText}>TMDB isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  const photo = tmdbImageUrl(person?.profile_path, 'w185');

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {person?.name ?? ''}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      {loading && !person ? (
        <ActivityIndicator color={colors.sectionGreen} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={credits}
          keyExtractor={(item) => `${item.media_type}:${item.id}`}
          numColumns={3}
          contentContainerStyle={styles.grid}
          ListHeaderComponent={
            person ? (
              <View style={styles.header}>
                {photo ? (
                  <Image source={{ uri: photo }} style={styles.photo} cachePolicy="memory-disk" />
                ) : (
                  <View style={[styles.photo, styles.photoPlaceholder]} />
                )}
                <Text style={styles.name}>{person.name}</Text>
                {person.known_for_department ? <Text style={styles.department}>{person.known_for_department}</Text> : null}
                {person.biography ? (
                  <Text style={styles.bio} numberOfLines={5}>
                    {person.biography}
                  </Text>
                ) : null}
                <Text style={styles.filmographyTitle}>Filmography</Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const posterUrl = tmdbImageUrl(item.poster_path);
            const title = item.title ?? item.name ?? 'Untitled';
            return (
              <TouchableOpacity style={styles.card} onPress={() => router.push(`/discover/${item.media_type}/${item.id}`)}>
                {posterUrl ? (
                  <Image source={{ uri: posterUrl }} style={styles.poster} cachePolicy="memory-disk" />
                ) : (
                  <View style={[styles.poster, styles.posterPlaceholder]} />
                )}
                <Text style={styles.cardTitle} numberOfLines={2}>
                  {title}
                </Text>
                {item.character || item.job ? (
                  <Text style={styles.cardCharacter} numberOfLines={1}>
                    {item.character ?? item.job}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={!loading ? <Text style={styles.emptyText}>No credits found.</Text> : null}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 40 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  header: { alignItems: 'center', padding: 20, gap: 4 },
  photo: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surfaceAlt },
  photoPlaceholder: {},
  name: { color: colors.textPrimary, fontWeight: '800', fontSize: 20, marginTop: 12 },
  department: { color: colors.sectionGreen, fontSize: 13, fontWeight: '600' },
  bio: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 10 },
  filmographyTitle: {
    alignSelf: 'flex-start',
    color: colors.textPrimary,
    fontWeight: '700',
    fontSize: 16,
    marginTop: 20,
    marginBottom: 4,
  },
  grid: { padding: 12, gap: 4 },
  card: { flex: 1 / 3, padding: 6 },
  poster: { width: '100%', aspectRatio: 2 / 3, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  cardTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', marginTop: 6 },
  cardCharacter: { color: colors.textSecondary, fontSize: 11, marginTop: 1 },
});
