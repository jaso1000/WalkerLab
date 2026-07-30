// Shared "Tags" card for movie/series/Discover detail pages - renders TMDB
// keywords (or Radarr/Sonarr tags, depending on caller) as a wrapping row of
// pill chips. Renders nothing when there are no tags to show.
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export function TagList({ tags, tint = colors.accent }: { tags: string[]; tint?: string }) {
  if (tags.length === 0) return null;
  return (
    <View style={styles.card}>
      <Text style={styles.sectionTitle}>Tags</Text>
      <View style={styles.row}>
        {tags.map((tag) => (
          <View key={tag} style={styles.chip}>
            <Ionicons name="pricetag-outline" size={12} color={tint} />
            <Text style={styles.chipText}>{tag}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, margin: 16, marginTop: 14, gap: 10 },
  sectionTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
});
