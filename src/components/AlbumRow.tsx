// Discover Music's "New Releases" row - same titled-row shape as
// `ArtistRow`/`DiscoverRow`, but each card is an album (real artwork
// already included from Apple's chart response, no async per-card lookup
// needed the way `ArtistRow` requires) with a two-line caption (album title
// + artist name). Tapping a card opens the *artist's* Discover page - there
// is no per-album detail page in this app, and the artist page is the only
// real destination this feature has to offer.
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';
// Horizontal and lives inside Discover's own outer horizontal swipeable tab
// pager - see `DiscoverRow`'s own comment on why gesture-handler's
// ScrollView (not the plain react-native one) is required here.
import { ScrollView } from 'react-native-gesture-handler';
import { colors } from '../theme/colors';

export interface AlbumRowItem {
  id: string;
  title: string;
  artistName: string;
  artworkUrl: string;
}

export function AlbumRow({
  title,
  items,
  onPressItem,
}: {
  title: string;
  items: AlbumRowItem[];
  onPressItem: (item: AlbumRowItem) => void;
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
            <Image source={{ uri: item.artworkUrl }} style={styles.art} contentFit="cover" cachePolicy="memory-disk" />
            <Text style={styles.albumTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.artistName} numberOfLines={1}>
              {item.artistName}
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
  card: { width: 120 },
  art: { width: 120, height: 120, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  albumTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '700', marginTop: 6 },
  artistName: { color: colors.textSecondary, fontSize: 11, marginTop: 1 },
});
