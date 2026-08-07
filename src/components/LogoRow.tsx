// Discover's horizontally-scrolling picture row for Streaming Service and
// Studios (`app/discover.tsx`) - same titled-row shape as `DiscoverRow`, but
// each card is a service/studio logo tile instead of a title's poster, and
// there's no "See All" (both are fixed, curated lists, not paginated
// categories).
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
// Horizontal and lives inside this screen's own outer horizontal swipeable
// tab pager - same nested-scroll situation `DiscoverRow` already documents
// at length, gesture-handler's ScrollView is needed here too so a drag over
// the row scrolls it instead of switching tabs on native.
import { ScrollView } from 'react-native-gesture-handler';
import { colors } from '../theme/colors';

export interface LogoRowItem {
  id: number;
  name: string;
  logoUrl?: string;
}

export function LogoRow({
  title,
  items,
  onPressItem,
  logoBackground = colors.surfaceAlt,
  logoTintColor,
}: {
  title: string;
  items: LogoRowItem[];
  onPressItem: (item: LogoRowItem) => void;
  logoBackground?: string;
  // Streaming-provider logos are TMDB's own app-icon-style tiles - always
  // opaque, already high-contrast against anything. Studio logos are plain
  // flat artwork (often black ink, transparent background) meant to sit on
  // a light page background, the way they'd appear on a studio's own site -
  // against this app's default dark tile they were nearly invisible
  // (confirmed live: Disney/Pixar/Lucasfilm's logos all but disappeared).
  // Rather than lighten the tile to match, callers with that kind of logo
  // can pass a solid tint instead: expo-image's `tintColor` treats the
  // source as an alpha mask and recolors every opaque pixel to this color,
  // turning e.g. a black-ink logo into a clean white silhouette that stays
  // legible on the app's normal dark tile. Multi-color logos lose their
  // real color this way (flattened to one solid tint) - an intentional
  // tradeoff for consistent legibility over exact studio branding.
  logoTintColor?: string;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      <View style={styles.sectionTitleRow}>
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => (
          <Pressable key={item.id} style={styles.card} onPress={() => onPressItem(item)}>
            <View style={[styles.logoBox, { backgroundColor: logoBackground }]}>
              {item.logoUrl ? (
                <Image
                  source={{ uri: item.logoUrl }}
                  style={styles.logo}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  tintColor={logoTintColor}
                />
              ) : null}
            </View>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {item.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 18 },
  sectionTitleRow: { marginBottom: 10, marginHorizontal: 16 },
  sectionTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  row: { paddingHorizontal: 16, gap: 12 },
  card: { width: 92, alignItems: 'center' },
  logoBox: {
    width: 92,
    height: 92,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  logo: { width: '100%', height: '100%' },
  cardTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', marginTop: 6, textAlign: 'center' },
});
