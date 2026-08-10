// "Currently Streaming On" section for movie/series/Discover detail pages -
// per-title watch availability in the user's own default region (Settings >
// TMDB (Discover) > Default Region), as opposed to `LogoRow`'s region-wide
// catalog row (Discover's Streaming Service browse row). Only subscription/
// free/ad-supported offers are shown - `rent`/`buy` are a different one-off-
// payment concept and out of scope for "streaming on". Renders nothing when
// TMDB has no data for the title in that region (common - not every title is
// available everywhere), matching `ReviewSources`' vanish-when-empty
// convention.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { TmdbWatchProvider, TmdbWatchProvidersRegion, tmdbImageUrl } from '../api/tmdb';
import { colors } from '../theme/colors';

// Combines flatrate/free/ads into one deduped list (a provider offering both
// a free ad-supported tier and a paid subscription would otherwise appear
// twice) - `rent`/`buy` intentionally excluded.
export function streamingProviders(region: TmdbWatchProvidersRegion | undefined): TmdbWatchProvider[] {
  if (!region) return [];
  const combined = [...(region.flatrate ?? []), ...(region.free ?? []), ...(region.ads ?? [])];
  const seen = new Set<number>();
  return combined.filter((p) => (seen.has(p.provider_id) ? false : (seen.add(p.provider_id), true)));
}

// Renders as a sub-section *inside* the caller's own Details card, styled
// to match that card's `InfoRow` list (same icon + grey label + top
// hairline divider, label on the left with the "value" - here a logo strip
// instead of plain text - pushed to the row's right edge) rather than
// looking like a bolted-on separate widget. `tint` should match whichever
// color that page's own InfoRow icons already use (colors.accent on the
// Radarr movie page, colors.sonarr on the Sonarr series page, colors.
// sectionGreen on Discover) so this row doesn't stand out as off-theme.
export function StreamingProviders({
  providers,
  link,
  tint = colors.accent,
}: {
  providers: TmdbWatchProvider[];
  link?: string;
  tint?: string;
}) {
  if (providers.length === 0) return null;
  return (
    <View style={styles.container}>
      <Ionicons name="play-circle-outline" size={16} color={tint} style={styles.icon} />
      <Text style={styles.label}>Currently Streaming On</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.logoScroll}
        contentContainerStyle={styles.logos}
      >
        {providers.map((p) => (
          <Pressable
            key={p.provider_id}
            style={styles.tile}
            disabled={!link}
            onPress={link ? () => Linking.openURL(link) : undefined}
          >
            <Image
              source={{ uri: tmdbImageUrl(p.logo_path, 'w185') }}
              style={styles.logo}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  icon: { marginRight: 10 },
  label: { color: colors.textSecondary, fontSize: 13 },
  logoScroll: { flex: 1 },
  logos: { flexGrow: 1, justifyContent: 'flex-end', alignItems: 'center', gap: 8 },
  tile: { width: 34, height: 34, borderRadius: 9, overflow: 'hidden', backgroundColor: colors.surfaceAlt },
  logo: { width: '100%', height: '100%' },
});
