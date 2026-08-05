// Full-screen, swipeable poster viewer opened by tapping a poster on a
// movie/series detail page (never from a list/grid view). Lazily fetches
// every available poster from TMDB's `/movie|tv/{id}/images` endpoint (the
// detail payload itself only ever carries one, TMDB's own current pick) -
// falls back to just that single already-known poster if TMDB isn't
// configured, the id hasn't resolved yet, or the fetch comes back empty.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ServiceConfig } from '../api/types';
import { tmdbApi, tmdbImageUrl } from '../api/tmdb';
import { colors } from '../theme/colors';

interface GalleryPoster {
  full: string;
  thumb: string;
}

const TOP_BAR_HEIGHT = 56;
const THUMB_WIDTH = 52;
const THUMB_HEIGHT = 78;
const THUMB_GAP = 8;
const THUMB_STRIP_HEIGHT = THUMB_HEIGHT + 24;

export function PosterGalleryModal({
  visible,
  onClose,
  tmdbConfig,
  mediaType,
  tmdbId,
  fallbackPosterUrl,
}: {
  visible: boolean;
  onClose: () => void;
  tmdbConfig: ServiceConfig | undefined;
  mediaType: 'movie' | 'tv';
  tmdbId: number | undefined;
  // The poster already on hand from the detail page itself - shown
  // immediately as the only page if the full gallery can't be fetched, so
  // tapping the poster always opens to *something* full-screen.
  fallbackPosterUrl?: string;
}) {
  const { width, height } = useWindowDimensions();
  const [posters, setPosters] = useState<GalleryPoster[] | null>(null);
  const [index, setIndex] = useState(0);
  const mainListRef = useRef<FlatList<GalleryPoster>>(null);
  const thumbListRef = useRef<FlatList<GalleryPoster>>(null);

  // Re-fetches (and resets scroll position) fresh every time the modal is
  // opened rather than caching across opens - this is a rarely-repeated
  // action, so simplicity wins over avoiding a redundant network call.
  useEffect(() => {
    if (!visible) return;
    setIndex(0);
    const fallback: GalleryPoster[] = fallbackPosterUrl ? [{ full: fallbackPosterUrl, thumb: fallbackPosterUrl }] : [];
    if (!tmdbConfig || !tmdbId) {
      setPosters(fallback);
      return;
    }
    setPosters(null);
    const fetchImages = mediaType === 'movie' ? tmdbApi.movieImages(tmdbConfig, tmdbId) : tmdbApi.tvImages(tmdbConfig, tmdbId);
    fetchImages
      .then((res) => {
        const items = res.posters
          .map((p) => {
            const full = tmdbImageUrl(p.file_path, 'w780');
            const thumb = tmdbImageUrl(p.file_path, 'w185');
            return full && thumb ? { full, thumb } : null;
          })
          .filter((p): p is GalleryPoster => !!p);
        setPosters(items.length > 0 ? items : fallback);
      })
      .catch(() => setPosters(fallback));
  }, [visible, tmdbConfig, tmdbId, mediaType, fallbackPosterUrl]);

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

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView edges={['top']} style={styles.topBar}>
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
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
            <Text style={styles.emptyText}>No posters available.</Text>
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
    </Modal>
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
