// Shared Cast & Crew section for movie/series/Discover detail pages - shows
// Directors and Writers as their own labeled groups above the general cast
// list (both capped with their own "Show All", independently expandable),
// each row tappable through to that person's filmography page.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { TmdbCastMember, TmdbCrewCredit, tmdbImageUrl } from '../api/tmdb';
import { colors } from '../theme/colors';

const CAST_INITIAL_COUNT = 6;
const CREW_INITIAL_COUNT = 2;

// One tappable person row (photo + name + optional subtitle, e.g. character
// name for cast or nothing for crew) - shared by both the cast and
// director/writer lists below.
function PersonRow({ id, name, profile_path, subtitle }: TmdbCrewCredit & { subtitle?: string }) {
  const photo = tmdbImageUrl(profile_path, 'w185');
  return (
    <Pressable style={styles.castRow} onPress={() => router.push(`/discover/person/${id}`)}>
      {photo ? (
        <Image source={{ uri: photo }} style={styles.castPhoto} cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.castPhoto, styles.castPhotoPlaceholder]} />
      )}
      <View style={styles.castInfo}>
        <Text style={styles.castName} numberOfLines={1}>
          {name}
        </Text>
        {subtitle ? (
          <Text style={styles.castCharacter} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// Renders (in order) a Directors group, a Writers group, then the general
// Cast list, each independently expandable via its own "Show All". Renders
// nothing at all if there's no cast or crew data to show.
export function CastCrewSection({
  cast,
  directors = [],
  writers = [],
  tint = colors.accent,
}: {
  cast: TmdbCastMember[];
  directors?: TmdbCrewCredit[];
  writers?: TmdbCrewCredit[];
  tint?: string;
}) {
  const [directorsExpanded, setDirectorsExpanded] = useState(false);
  const [writersExpanded, setWritersExpanded] = useState(false);
  const [castExpanded, setCastExpanded] = useState(false);

  if (cast.length === 0 && directors.length === 0 && writers.length === 0) return null;

  const visibleDirectors = directorsExpanded ? directors : directors.slice(0, CREW_INITIAL_COUNT);
  const visibleWriters = writersExpanded ? writers : writers.slice(0, CREW_INITIAL_COUNT);
  const visibleCast = castExpanded ? cast : cast.slice(0, CAST_INITIAL_COUNT);
  // Only label the cast list "Cast" when there are director/writer groups
  // above it to disambiguate from - a cast-only page (no crew data) doesn't
  // need the extra label.
  const hasCrewGroups = directors.length > 0 || writers.length > 0;

  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Cast &amp; Crew</Text>

      {directors.length > 0 ? (
        <View style={styles.creditGroup}>
          <Text style={styles.creditLabel}>{directors.length > 1 ? 'Directors' : 'Director'}</Text>
          <View style={styles.castList}>
            {visibleDirectors.map((d) => (
              <PersonRow key={d.id} {...d} />
            ))}
          </View>
          {directors.length > CREW_INITIAL_COUNT ? (
            <TouchableOpacity style={styles.showAllLink} onPress={() => setDirectorsExpanded((v) => !v)}>
              <Text style={[styles.showAllLinkText, { color: tint }]}>
                {directorsExpanded ? 'Show Less' : `Show All (${directors.length})`}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
      {writers.length > 0 ? (
        <View style={styles.creditGroup}>
          <Text style={styles.creditLabel}>{writers.length > 1 ? 'Writers' : 'Writer'}</Text>
          <View style={styles.castList}>
            {visibleWriters.map((w) => (
              <PersonRow key={w.id} {...w} />
            ))}
          </View>
          {writers.length > CREW_INITIAL_COUNT ? (
            <TouchableOpacity style={styles.showAllLink} onPress={() => setWritersExpanded((v) => !v)}>
              <Text style={[styles.showAllLinkText, { color: tint }]}>
                {writersExpanded ? 'Show Less' : `Show All (${writers.length})`}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {cast.length > 0 ? (
        <View style={styles.creditGroup}>
          {hasCrewGroups ? <Text style={styles.creditLabel}>Cast</Text> : null}
          <View style={styles.castList}>
            {visibleCast.map((member) => (
              <PersonRow key={member.id} id={member.id} name={member.name} profile_path={member.profile_path} subtitle={member.character} />
            ))}
          </View>
        </View>
      ) : null}

      {cast.length > CAST_INITIAL_COUNT ? (
        <TouchableOpacity style={styles.showAllButton} onPress={() => setCastExpanded((v) => !v)}>
          <Text style={[styles.showAllText, { color: tint }]}>
            {castExpanded ? 'Show Less' : `Show All (${cast.length})`}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, margin: 16, marginTop: 14, gap: 4 },
  sectionTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  creditGroup: { marginTop: 8 },
  creditLabel: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 8 },
  castList: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, columnGap: 12 },
  castRow: { flexDirection: 'row', alignItems: 'center', gap: 10, width: '48%' },
  castPhoto: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt },
  castPhotoPlaceholder: {},
  castInfo: { flex: 1, minWidth: 0 },
  castName: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  castCharacter: { color: colors.textSecondary, fontSize: 12, marginTop: 1 },
  showAllButton: { alignSelf: 'center', marginTop: 10, paddingVertical: 6, paddingHorizontal: 12 },
  showAllText: { fontSize: 13, fontWeight: '700' },
  showAllLink: { alignSelf: 'flex-start', marginTop: 8 },
  showAllLinkText: { fontSize: 12, fontWeight: '700' },
});
