// Compact inline IMDb/Rotten Tomatoes rating chip - used as the glance-value
// rating on TV Shows/Movies *list* rows. NOT used on detail pages anymore;
// `ReviewSources` is the sole full ratings display there (see its own header
// comment for why). `compact` shrinks text/icon size for tight list rows.
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export function RatingBadges({
  imdb,
  rottenTomatoes,
  compact = false,
  tint = colors.accent,
}: {
  imdb?: number;
  rottenTomatoes?: number;
  compact?: boolean;
  tint?: string;
}) {
  if (imdb === undefined && rottenTomatoes === undefined) return null;

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {imdb !== undefined ? (
        <View style={styles.badge}>
          <Ionicons name="star" size={compact ? 11 : 14} color={tint} />
          <Text style={[styles.text, compact && styles.textCompact]}>{imdb.toFixed(1)}</Text>
        </View>
      ) : null}
      {rottenTomatoes !== undefined ? (
        <View style={styles.badge}>
          <Text style={compact ? styles.tomatoCompact : styles.tomato}>🍅</Text>
          <Text style={[styles.text, compact && styles.textCompact]}>{Math.round(rottenTomatoes)}%</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowCompact: { gap: 8 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  text: { color: colors.textPrimary, fontWeight: '700', fontSize: 13 },
  textCompact: { color: colors.textSecondary, fontWeight: '600', fontSize: 12 },
  tomato: { fontSize: 13 },
  tomatoCompact: { fontSize: 11 },
});
