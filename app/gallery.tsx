// Full-screen, swipeable poster/photo viewer - a real routed screen
// (`presentation: 'transparentModal'`, keeps the screen underneath
// visually mounted behind it), not a plain `<Modal>`. Two prior attempts
// at making a non-routed `<Modal>` version correctly close (not navigate
// the screen behind it) on Android system back both failed, confirmed
// identical on web too - ruling out anything JS-level (`BackHandler`,
// `navigation.addListener('beforeRemove', ...)`) as ever having been the
// real interception point, since `react-native-screens`' native-stack
// handles back for the *routed screen underneath* structurally, below
// where either could ever intercept it. As a real route, system back just
// natively pops this one stack entry - the same reliable mechanism every
// other screen in this app already depends on, no back-handling code
// needed here at all.
//
// Opened via `router.push({ pathname: '/gallery', params: {...} })` from
// movie/series/discover-detail/person-detail pages (TMDB-based) or the
// Lidarr artist page (hero photo + each album cover) - callers only pass
// identifiers, everything else is re-fetched here from `useServers()`,
// same as any other detail screen in this app fetching fresh off its own
// `useLocalSearchParams` id rather than being handed pre-fetched data.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lidarrApi, lidarrImageUrl, LidarrImage } from '../src/api/lidarr';
import { ServiceConfig } from '../src/api/types';
import { tmdbApi, tmdbImageUrl } from '../src/api/tmdb';
import { useServers } from '../src/context/ServersContext';
import { colors } from '../src/theme/colors';

interface GalleryPoster {
  full: string;
  thumb: string;
}

const TOP_BAR_HEIGHT = 56;
const THUMB_WIDTH = 52;
const THUMB_HEIGHT = 78;
const THUMB_GAP = 8;
const THUMB_STRIP_HEIGHT = THUMB_HEIGHT + 24;

// Maps every image entry with a resolvable URL to the gallery's plain
// {full, thumb} shape - same helper `app/artist/[id]/index.tsx` used to
// have locally, moved here since this is now the only place that needs it.
function toGalleryImages(images: LidarrImage[], config: ServiceConfig, entity: { type: 'artist' | 'album'; id: number }): GalleryPoster[] {
  return images
    .filter((img) => lidarrImageUrl(img, config, entity))
    .map((img) => ({ full: lidarrImageUrl(img, config, entity, 1000)!, thumb: lidarrImageUrl(img, config, entity, 250)! }));
}

export default function GalleryScreen() {
  const { mediaType, tmdbId, fallbackPosterUrl, lidarrEntityType, lidarrEntityId } = useLocalSearchParams<{
    mediaType?: string;
    tmdbId?: string;
    fallbackPosterUrl?: string;
    lidarrEntityType?: string;
    lidarrEntityId?: string;
  }>();
  const { servers } = useServers();
  const tmdbConfig = servers.tmdb;
  const lidarrConfig = servers.lidarr;

  const { width, height } = useWindowDimensions();
  const [posters, setPosters] = useState<GalleryPoster[] | null>(null);
  const [index, setIndex] = useState(0);
  const mainListRef = useRef<FlatList<GalleryPoster>>(null);
  const thumbListRef = useRef<FlatList<GalleryPoster>>(null);

  useEffect(() => {
    setIndex(0);
    const fallback: GalleryPoster[] = fallbackPosterUrl ? [{ full: fallbackPosterUrl, thumb: fallbackPosterUrl }] : [];

    if (lidarrEntityType && lidarrEntityId && lidarrConfig) {
      const id = Number(lidarrEntityId);
      if (lidarrEntityType === 'album') {
        lidarrApi
          .getAlbumById(lidarrConfig, id)
          .then((album) => setPosters(toGalleryImages(album.images, lidarrConfig, { type: 'album', id })))
          .catch(() => setPosters([]));
        return;
      }
      // Artist: falls back to the most recent album with a cover image if
      // the artist has no photo of its own - same behavior the artist page
      // used to compute locally before this became a shared route.
      Promise.all([lidarrApi.getArtistById(lidarrConfig, id), lidarrApi.getAlbums(lidarrConfig, id)])
        .then(([artist, albums]) => {
          const own = toGalleryImages(artist.images, lidarrConfig, { type: 'artist', id });
          if (own.length > 0) {
            setPosters(own);
            return;
          }
          const sorted = [...albums].sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
          const fallbackAlbum = sorted.find((a) => a.images.some((i) => i.coverType === 'cover'));
          setPosters(fallbackAlbum ? toGalleryImages(fallbackAlbum.images, lidarrConfig, { type: 'album', id: fallbackAlbum.id }) : []);
        })
        .catch(() => setPosters([]));
      return;
    }

    if (!tmdbConfig || !tmdbId || !mediaType) {
      setPosters(fallback);
      return;
    }
    setPosters(null);
    const id = Number(tmdbId);
    const fetchImages =
      mediaType === 'movie'
        ? tmdbApi.movieImages(tmdbConfig, id).then((res) => res.posters)
        : mediaType === 'tv'
          ? tmdbApi.tvImages(tmdbConfig, id).then((res) => res.posters)
          : tmdbApi.personImages(tmdbConfig, id).then((res) => res.profiles);
    fetchImages
      .then((images) => {
        const items = images
          .map((p) => {
            const full = tmdbImageUrl(p.file_path, 'w780');
            const thumb = tmdbImageUrl(p.file_path, 'w185');
            return full && thumb ? { full, thumb } : null;
          })
          .filter((p): p is GalleryPoster => !!p);
        setPosters(items.length > 0 ? items : fallback);
      })
      .catch(() => setPosters(fallback));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaType, tmdbId, fallbackPosterUrl, lidarrEntityType, lidarrEntityId, tmdbConfig, lidarrConfig]);

  // Tapping a thumbnail jumps the main pager straight to it - `index`
  // updates optimistically rather than waiting for the resulting `onScroll`
  // to catch up, so the thumbnail strip's own highlight/centering effect
  // below reacts immediately instead of one frame behind.
  const jumpTo = (i: number) => {
    setIndex(i);
    mainListRef.current?.scrollToIndex({ index: i, animated: true });
  };

  // Keeps the active thumbnail scrolled into view as the main pager moves,
  // the same "auto-scroll the strip to center the active item" pattern
  // SwipeTabBar already uses for its own tab labels. Both lists define
  // uniform-size `getItemLayout`, so `scrollToIndex` never needs the
  // measure-then-retry dance a variable-size list would require.
  useEffect(() => {
    if (!posters || posters.length < 2) return;
    thumbListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
  }, [index, posters]);

  const showThumbStrip = posters && posters.length > 1;
  const pageHeight = height - TOP_BAR_HEIGHT - (showThumbStrip ? THUMB_STRIP_HEIGHT : 0);
  const close = () => router.back();

  return (
    <View style={styles.backdrop}>
      <Stack.Screen options={{ presentation: 'transparentModal', animation: 'fade', headerShown: false }} />
      <SafeAreaView edges={['top']} style={styles.topBar}>
        <TouchableOpacity style={styles.closeButton} onPress={close}>
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        {posters && posters.length > 1 ? (
          <Text style={styles.counter}>
            {index + 1} / {posters.length}
          </Text>
        ) : null}
        <View style={styles.closeButton} />
      </SafeAreaView>

      {posters === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.textPrimary} />
        </View>
      ) : posters.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>{mediaType === 'tv' || mediaType === 'movie' ? 'No posters available.' : 'No photos available.'}</Text>
        </View>
      ) : (
        <>
          <FlatList
            ref={mainListRef}
            style={styles.flex}
            data={posters}
            keyExtractor={(item, i) => `${item.full}-${i}`}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            // `onMomentumScrollEnd` alone doesn't reliably fire on
            // react-native-web - browsers handle touch-scroll momentum in
            // their own compositor, so RNW's approximation of "momentum
            // end" can simply never fire, leaving the counter stuck at 1
            // no matter how far you swipe (same root cause as
            // SwipeTabBar's own onSettle-off-scrollX fix). Driving the
            // index off a throttled onScroll instead works on every
            // platform.
            onScroll={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
            scrollEventThrottle={32}
            renderItem={({ item }) => (
              <View style={[styles.page, { width, height: pageHeight }]}>
                <Image source={{ uri: item.full }} style={styles.image} contentFit="contain" cachePolicy="memory-disk" />
              </View>
            )}
          />

          {showThumbStrip ? (
            <FlatList
              ref={thumbListRef}
              style={styles.thumbStrip}
              data={posters}
              keyExtractor={(item, i) => `${item.thumb}-${i}`}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.thumbStripContent}
              getItemLayout={(_, i) => ({ length: THUMB_WIDTH + THUMB_GAP, offset: (THUMB_WIDTH + THUMB_GAP) * i, index: i })}
              onScrollToIndexFailed={() => {}}
              renderItem={({ item, index: i }) => (
                <TouchableOpacity onPress={() => jumpTo(i)}>
                  <Image
                    source={{ uri: item.thumb }}
                    style={[styles.thumb, i === index && styles.thumbActive]}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                  />
                </TouchableOpacity>
              )}
            />
          ) : null}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.96)' },
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8 },
  closeButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  counter: { color: colors.textPrimary, fontWeight: '600', fontSize: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary },
  page: { alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  thumbStrip: { height: THUMB_STRIP_HEIGHT, flexGrow: 0 },
  thumbStripContent: { paddingHorizontal: 12, gap: THUMB_GAP, alignItems: 'center' },
  thumb: {
    width: THUMB_WIDTH,
    height: THUMB_HEIGHT,
    borderRadius: 6,
    backgroundColor: colors.surfaceAlt,
    opacity: 0.5,
  },
  thumbActive: {
    opacity: 1,
    borderWidth: 2,
    borderColor: colors.textPrimary,
  },
});
