import { Ionicons } from '@expo/vector-icons';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme/colors';

// Metacritic's own site convention: green (favorable) / amber (mixed) /
// red (unfavorable) at these specific thresholds.
function metacriticColor(score: number): string {
  if (score >= 61) return colors.success;
  if (score >= 40) return colors.accent;
  return colors.danger;
}

interface ReviewItem {
  key: string;
  icon?: keyof typeof Ionicons.glyphMap;
  emoji?: string;
  label: string;
  value: string;
  color: string;
  url?: string;
}

// Standalone ratings strip, separate from the movie/series/Discover detail
// panel by design - see PLAN.md item 23. Only shows sources we can actually
// get for free: Radarr/OMDb/TMDB. No RT audience score (Popcornmeter) - that
// needs RT's own paid API, which this app doesn't have.
//
// This is now the *only* ratings display on a title's detail page (the
// compact hero RatingBadges chip was removed to avoid showing the same
// IMDb/RT numbers twice). Each item links out to that source: IMDb/TMDB
// link straight to the title's page (we have stable ids for those); RT and
// Metacritic have no such id available from OMDb, so they link to a search
// on that site instead.
export function ReviewSources({
  imdb,
  rottenTomatoes,
  metacritic,
  tmdb,
  imdbId,
  tmdbId,
  mediaType = 'movie',
  title,
}: {
  imdb?: number;
  rottenTomatoes?: number;
  metacritic?: number;
  tmdb?: number;
  imdbId?: string;
  tmdbId?: number;
  mediaType?: 'movie' | 'tv';
  title?: string;
}) {
  // Used to build a same-site search URL for RT/Metacritic, which have no
  // stable per-title id/slug available from OMDb.
  const searchQuery = title ? encodeURIComponent(title) : undefined;
  // Built conditionally per-source so a title missing one rating (e.g. no
  // Metacritic score) just omits that chip instead of showing a blank one.
  const items: ReviewItem[] = [];
  if (rottenTomatoes !== undefined) {
    items.push({
      key: 'rt',
      emoji: '🍅',
      label: 'Rotten Tomatoes',
      value: `${Math.round(rottenTomatoes)}%`,
      color: rottenTomatoes >= 60 ? '#FA320A' : colors.textSecondary,
      url: searchQuery ? `https://www.rottentomatoes.com/search?search=${searchQuery}` : undefined,
    });
  }
  if (imdb !== undefined) {
    items.push({
      key: 'imdb',
      icon: 'star',
      label: 'IMDb',
      value: imdb.toFixed(1),
      color: '#F5C518',
      url: imdbId ? `https://www.imdb.com/title/${imdbId}/` : undefined,
    });
  }
  if (metacritic !== undefined) {
    items.push({
      key: 'meta',
      label: 'Metacritic',
      value: String(Math.round(metacritic)),
      color: metacriticColor(metacritic),
      url: searchQuery ? `https://www.metacritic.com/search/${searchQuery}/` : undefined,
    });
  }
  if (tmdb !== undefined) {
    items.push({
      key: 'tmdb',
      icon: 'film',
      label: 'TMDB',
      value: `${Math.round(tmdb * 10)}%`,
      color: '#01B4E4',
      url: tmdbId ? `https://www.themoviedb.org/${mediaType}/${tmdbId}` : undefined,
    });
  }

  if (items.length === 0) return null;

  return (
    <View style={styles.card}>
      {items.map((item) => (
        <TouchableOpacity
          key={item.key}
          style={styles.item}
          disabled={!item.url}
          activeOpacity={item.url ? 0.6 : 1}
          onPress={item.url ? () => Linking.openURL(item.url!) : undefined}
        >
          {item.icon ? (
            <Ionicons name={item.icon} size={16} color={item.color} />
          ) : (
            <Text style={styles.emoji}>{item.emoji}</Text>
          )}
          <Text style={[styles.value, { color: item.color }]}>{item.value}</Text>
          <Text style={styles.label}>{item.label}</Text>
          {item.url ? <Ionicons name="open-outline" size={12} color={colors.textMuted} /> : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    margin: 16,
    marginTop: 14,
    gap: 18,
  },
  item: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  emoji: { fontSize: 16 },
  value: { fontWeight: '800', fontSize: 14 },
  label: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
});
