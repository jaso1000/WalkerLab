// TV versions of the phone's DiscoverRow and LogoRow (src/components), fed the same items from
// src/lib/discoverRows. The phone's tappable "See All ›" title becomes a "See all" tile at the end
// of the row, since a row title is not something the D-pad can land on.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { DiscoverCardItem } from '../../src/components/DiscoverRow';
import { LogoRowItem } from '../../src/components/LogoRow';
import { colors } from '../../src/theme/colors';
import { POSTER_H, POSTER_W, PosterTile } from './Cards';
import { FocusCard } from './FocusCard';
import { Row } from './Row';

export function DiscoverPosterRow({
  title,
  items,
  onPressItem,
  onSeeAll,
  preferredFocus,
}: {
  title: string;
  items: DiscoverCardItem[];
  onPressItem: (item: DiscoverCardItem) => void;
  onSeeAll?: () => void;
  preferredFocus?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <Row title={title} accent={colors.sectionGreen}>
      {items.map((item, i) => (
        <PosterTile
          key={`${item.mediaType ?? ''}-${item.id}`}
          title={item.title}
          poster={item.posterUrl}
          recyclingKey={`${item.mediaType ?? ''}-${item.id}`}
          badge={item.badge}
          subtitle={
            item.rating ? (
              <Text>
                <Ionicons name="star" size={11} color={colors.sectionGreen} /> {item.rating.toFixed(1)}
              </Text>
            ) : undefined
          }
          onPress={() => onPressItem(item)}
          preferredFocus={preferredFocus && i === 0}
        />
      ))}
      {onSeeAll ? <DiscoverSeeAll onPress={onSeeAll} /> : null}
    </Row>
  );
}

/** The "See all" tile that ends a row. */
export function DiscoverSeeAll({ onPress }: { onPress: () => void }) {
  return (
    <View style={{ width: POSTER_W }}>
      <FocusCard style={styles.seeAll} onPress={onPress}>
        <Ionicons name="chevron-forward-circle-outline" size={40} color={colors.sectionGreen} />
        <Text style={styles.seeAllText}>See all</Text>
      </FocusCard>
    </View>
  );
}

export function LogoTileRow({
  title,
  items,
  onPressItem,
  light,
  icon = 'business-outline',
}: {
  title: string;
  items: LogoRowItem[];
  onPressItem: (item: LogoRowItem) => void;
  /** Shown when an item has no logo (genres never do). */
  icon?: keyof typeof Ionicons.glyphMap;
  /** Studio logos are dark ink meant for a light page: a soft off-white tile, as on the phone. */
  light?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <Row title={title} accent={colors.sectionGreen}>
      {items.map((item) => (
        <View key={item.id} style={styles.logoCell}>
          <FocusCard radius={18} style={[styles.logoBox, light && { backgroundColor: colors.textPrimary }]} onPress={() => onPressItem(item)}>
            {item.logoUrl ? (
              <Image source={{ uri: item.logoUrl }} style={styles.logo} contentFit="contain" cachePolicy="memory-disk" />
            ) : (
              <Ionicons name={icon} size={34} color={colors.textMuted} />
            )}
          </FocusCard>
          <Text style={styles.logoName} numberOfLines={2}>
            {item.name}
          </Text>
        </View>
      ))}
    </Row>
  );
}

const styles = StyleSheet.create({
  seeAll: {
    width: POSTER_W,
    height: POSTER_H,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.sectionGreenMuted,
  },
  seeAllText: { color: colors.sectionGreen, fontSize: 15, fontWeight: '700' },
  logoCell: { width: 112, alignItems: 'center' },
  logoBox: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center', padding: 16, backgroundColor: colors.surfaceAlt },
  logo: { width: '100%', height: '100%' },
  logoName: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', marginTop: 8, textAlign: 'center' },
});
