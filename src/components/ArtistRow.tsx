// Discover Music's horizontally-scrolling artist row (Top Artists/Recently
// Added) - same titled-row shape as `DiscoverRow`, but keyed by artist
// *name* instead of a numeric id (Last.fm artists have no stable numeric
// id, only a name and an inconsistently-populated mbid), and each card
// resolves its own artwork asynchronously via `itunesApi` (Last.fm's own
// images are broken - see src/api/lastfm.ts's header comment) rather than
// receiving a pre-resolved `posterUrl` up front like TMDB cards do.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
// Horizontal and lives inside Discover's own outer horizontal swipeable tab
// pager - see `DiscoverRow`'s own comment on why gesture-handler's
// ScrollView (not the plain react-native one) is required here.
import { ScrollView } from 'react-native-gesture-handler';
import { itunesApi } from '../api/itunes';
import { colors } from '../theme/colors';

export interface ArtistRowItem {
  name: string;
  inLibrary?: boolean;
  // Set only when this artist is already a real Lidarr library entry (e.g.
  // the Music tab's Recently Added row) - lets a shared `onPressItem`
  // handler route straight to `/artist/{id}` instead of the Discover
  // artist-by-name detail page, the same `if (item.id) {...}` idiom
  // `app/artist/add.tsx`'s own search results already use.
  id?: number;
}

// Resolves its own art on mount via `itunesApi.searchArtistArtwork` (which
// caches in-memory by name), instead of the row pre-fetching every card's
// art up front - keeps the row itself simple and lets cards mount/resolve
// independently, same "fetch, then fill in" shape `LogoRow`'s Studios row
// already uses for TMDB company logos.
function ArtistCard({ item, onPress, tint }: { item: ArtistRowItem; onPress: () => void; tint: string }) {
  const [artUrl, setArtUrl] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    itunesApi.searchArtistArtwork(item.name).then((url) => {
      if (!cancelled) setArtUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [item.name]);

  return (
    <Pressable style={styles.card} onPress={onPress}>
      {artUrl ? (
        <Image source={{ uri: artUrl }} style={styles.art} contentFit="cover" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.art, styles.artPlaceholder]}>
          <Ionicons name="musical-notes" size={26} color={colors.textMuted} />
        </View>
      )}
      {item.inLibrary ? (
        <View style={[styles.badge, { backgroundColor: tint }]}>
          <Ionicons name="checkmark" size={12} color={colors.background} />
        </View>
      ) : null}
      <Text style={styles.cardTitle} numberOfLines={2}>
        {item.name}
      </Text>
    </Pressable>
  );
}

export function ArtistRow({
  title,
  items,
  onPressItem,
  onPressTitle,
  tint = colors.lastfm,
}: {
  title: string;
  items: ArtistRowItem[];
  onPressItem: (item: ArtistRowItem) => void;
  /** When provided, the title becomes tappable (with a chevron) - opens the full infinite-scroll grid. */
  onPressTitle?: () => void;
  tint?: string;
}) {
  if (items.length === 0) return null;
  return (
    <View style={styles.section}>
      {onPressTitle ? (
        <TouchableOpacity style={styles.sectionTitleRow} onPress={onPressTitle} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.sectionTitle}>{title}</Text>
          <View style={styles.seeAll}>
            <Text style={[styles.seeAllText, { color: tint }]}>See All</Text>
            <Ionicons name="chevron-forward" size={16} color={tint} />
          </View>
        </TouchableOpacity>
      ) : (
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>{title}</Text>
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {items.map((item) => (
          <ArtistCard key={item.name} item={item} onPress={() => onPressItem(item)} tint={tint} />
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
  seeAllText: { fontSize: 13, fontWeight: '600' },
  row: { paddingHorizontal: 16, gap: 12 },
  card: { width: 104, alignItems: 'center' },
  art: { width: 104, height: 104, borderRadius: 12, backgroundColor: colors.surfaceAlt },
  artPlaceholder: { alignItems: 'center', justifyContent: 'center' },
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
  cardTitle: { color: colors.textPrimary, fontSize: 12, fontWeight: '600', marginTop: 6, textAlign: 'center' },
});
