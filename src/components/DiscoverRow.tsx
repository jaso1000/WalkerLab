// Discover's horizontally-scrolling preview row (Trending/Popular/Upcoming/
// Recently Released) - a titled row of poster cards, optionally with a
// tappable "See All ›" title that opens the full infinite-scroll grid.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MediaKind } from '../lib/discoverCategories';
import { colors } from '../theme/colors';

// Small corner badge on a poster card (in-library/downloaded/deleted status -
// see `badgeForMovie`/`badgeForSeries` in `libraryStatus.ts`).
export interface DiscoverCardBadge {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

export interface DiscoverCardItem {
  id: number;
  title: string;
  posterUrl?: string;
  rating?: number;
  badge?: DiscoverCardBadge;
  // Only set for Discover's "All" tab's mixed rows - lets one row's press
  // handler route each item to the right per-type destination. Movies/TV
  // Shows tab rows leave this undefined; their onPressItem closures already
  // know their fixed type without needing it.
  mediaType?: MediaKind;
}

export function DiscoverRow({
  title,
  items,
  onPressItem,
  onPressTitle,
}: {
  title: string;
  items: DiscoverCardItem[];
  onPressItem: (id: number, mediaType?: MediaKind) => void;
  /** When provided, the title becomes tappable (with a chevron) - used to open the full, infinite-scroll category view. */
  onPressTitle?: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      {onPressTitle ? (
        <TouchableOpacity
          style={styles.sectionTitleRow}
          onPress={onPressTitle}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.sectionTitle}>{title}</Text>
          <View style={styles.seeAll}>
            <Text style={styles.seeAllText}>See All</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.sectionGreen} />
          </View>
        </TouchableOpacity>
      ) : (
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => (
          <Pressable key={item.id} style={styles.card} onPress={() => onPressItem(item.id, item.mediaType)}>
            {item.posterUrl ? (
              <Image source={{ uri: item.posterUrl }} style={styles.poster} cachePolicy="memory-disk" />
            ) : (
              <View style={[styles.poster, styles.posterPlaceholder]} />
            )}
            {item.badge ? (
              <View style={[styles.badge, { backgroundColor: item.badge.color }]}>
                <Ionicons name={item.badge.icon} size={12} color={colors.background} />
              </View>
            ) : null}
            <Text style={styles.cardTitle} numberOfLines={2}>
              {item.title}
            </Text>
            {item.rating ? (
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={11} color={colors.sectionGreen} />
                <Text style={styles.ratingText}>{item.rating.toFixed(1)}</Text>
              </View>
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 18 },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginHorizontal: 16,
  },
  sectionTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllText: { color: colors.sectionGreen, fontSize: 13, fontWeight: '600' },
  row: { paddingHorizontal: 16, gap: 12 },
  card: { width: 110 },
  poster: { width: 110, height: 165, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  badge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', marginTop: 6 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 2 },
  ratingText: { color: colors.textSecondary, fontSize: 11 },
});
