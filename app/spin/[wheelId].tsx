import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { HeaderTitle } from '../../src/components/HeaderTitle';
import { useProfiles } from '../../src/context/ProfilesContext';
import { alert } from '../../src/lib/alert';
import { useContentWidth } from '../../src/lib/responsive';
import { SECTION_META } from '../../src/lib/sectionMeta';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { getWheels, saveWheel, Wheel, WheelItem } from '../../src/lib/wheels';
import { colors } from '../../src/theme/colors';

// The actual spin: a horizontal strip of the wheel's posters, repeated many
// times end to end, slides under a fixed center pointer and decelerates to
// a stop on a pre-chosen random item - a roulette/slot-machine style spin
// rather than a literal pie wheel (which would need react-native-svg, not
// a dependency this app has - see PLAN.md's "Spin" write-up for the full
// reasoning). The target item is picked FIRST, then the animation's end
// position is computed to land exactly on it - not "spin randomly and see
// where it stops," which would need continuous re-measuring mid-flight.
// Bigger now that the result card below no longer needs room for its own
// poster (removed as a duplicate of the winning tile already visible in
// the strip itself) - that freed-up space goes to the wheel instead.
const TILE_WIDTH = 260;
const TILE_GAP = 20;
const ITEM_WIDTH = TILE_WIDTH + TILE_GAP;
// Bumped from 12 - the overshoot variant below needs a couple of spare
// laps of strip *after* where the target normally would have landed, on
// top of the laps needed for a full-length spin before it.
const LAPS = 16;
const SPIN_DURATION = 5200;
// Just tall enough for one row of posters plus the flapper above it - not
// `flex: 1`, so the strip sits right under the header instead of centering
// itself in whatever space is left over (which read as "floating in the
// middle of a mostly-empty screen").
const VIEWPORT_HEIGHT = TILE_WIDTH * 1.5 + 40;

function buildStrip(items: WheelItem[]): WheelItem[] {
  const strip: WheelItem[] = [];
  for (let lap = 0; lap < LAPS; lap++) strip.push(...items);
  return strip;
}

export default function SpinWheelScreen() {
  const { wheelId } = useLocalSearchParams<{ wheelId: string }>();
  const { activeProfileId } = useProfiles();
  const width = useContentWidth();
  const tabBarClearance = useTabBarClearance();

  const [wheel, setWheel] = useState<Wheel | null | undefined>(undefined); // undefined = loading, null = not found
  const [strip, setStrip] = useState<WheelItem[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<WheelItem | null>(null);

  const translateX = useSharedValue(0);
  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));

  // The flapper: a real prize wheel has a fixed flexible pointer that gets
  // pushed aside by each peg as the wheel turns, then springs back - here,
  // "which tile boundary is currently under the pointer" is just
  // `translateX` divided into tile-widths, so watching that value for a
  // change (via useAnimatedReaction, entirely on the UI thread) and firing
  // a quick rotate-then-spring-back on every change reproduces the same
  // effect without needing to hand-roll physics. Because it's driven by
  // the strip's own actual position rather than a fixed timer, the ticks
  // naturally slow down as the spin decelerates, exactly like the real
  // thing.
  const flapperRotation = useSharedValue(0);
  useAnimatedReaction(
    () => Math.floor(translateX.value / ITEM_WIDTH),
    (current, previous) => {
      if (previous !== null && current !== previous) {
        flapperRotation.value = withSequence(withTiming(26, { duration: 45 }), withSpring(0, { damping: 5, stiffness: 300 }));
      }
    }
  );
  const flapperStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${flapperRotation.value}deg` }] }));

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      (async () => {
        try {
          const wheels = await getWheels(activeProfileId);
          if (cancelled) return;
          const found = wheels.find((w) => w.id === wheelId) ?? null;
          setWheel(found);
          if (found) setStrip(buildStrip(found.items));
        } catch (e) {
          if (!cancelled) alert('Failed to load wheel', e instanceof Error ? e.message : 'Unknown error');
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [activeProfileId, wheelId])
  );

  // With "remove after landing" on, a landed item shouldn't vanish from
  // the strip the instant it lands (confirmed live: rebuilding the strip
  // right away made the just-won poster disappear before you could even
  // see it) - instead it's queued here and only actually removed, and
  // persisted, once you leave this screen (back or navigate elsewhere).
  // The strip itself is never rebuilt while you're still looking at it;
  // `spin()` below just excludes queued ids from what a *future* spin in
  // this same session can land on again.
  const pendingRemovalIds = useRef<Set<string>>(new Set());

  useFocusEffect(
    useCallback(() => {
      return () => {
        const ids = pendingRemovalIds.current;
        if (ids.size === 0) return;
        pendingRemovalIds.current = new Set();
        (async () => {
          try {
            const wheels = await getWheels(activeProfileId);
            const current = wheels.find((w) => w.id === wheelId);
            if (!current) return;
            const nextItems = current.items.filter((i) => !ids.has(i.id));
            const nextWheel: Wheel = { ...current, items: nextItems, updatedAt: new Date().toISOString() };
            await saveWheel(activeProfileId, nextWheel);
          } catch (e) {
            console.error('Failed to remove landed items from wheel', e);
          }
        })();
      };
    }, [activeProfileId, wheelId])
  );

  const onSpinSettled = useCallback(
    (item: WheelItem) => {
      setSpinning(false);
      setResult(item);
      if (wheel?.removeAfterSpin) pendingRemovalIds.current.add(item.id);
    },
    [wheel]
  );

  const spin = () => {
    if (!wheel || wheel.items.length === 0 || spinning) return;
    // Items already landed on this session (queued for removal on leave,
    // see pendingRemovalIds above) shouldn't be landable on again even
    // though they're still visibly in the strip - picked from this
    // filtered pool, but resolved back to its real position in the full
    // `wheel.items` list just below, since that's what the strip's own
    // per-lap tile layout is actually built from.
    const availableItems = wheel.items.filter((i) => !pendingRemovalIds.current.has(i.id));
    if (availableItems.length === 0) {
      alert('Nothing left to spin', "You've landed on every title in this wheel already - leave and come back to reset it.");
      return;
    }
    setResult(null);
    setSpinning(true);
    const itemsLength = wheel.items.length;
    const target = availableItems[Math.floor(Math.random() * availableItems.length)];
    const targetIndex = wheel.items.findIndex((i) => i.id === target.id);
    // Lands a couple of laps short of the very last one - keeps the same
    // long, full-distance spin as before, while still leaving spare strip
    // *after* the target for the variant that overshoots past it before
    // rolling back (the tease variants only ever look backward, which the
    // many preceding laps already comfortably cover).
    const lap = LAPS - 3 - Math.floor(Math.random() * 2);
    const targetFlatIndex = lap * itemsLength + targetIndex;
    const totalTiles = LAPS * itemsLength;
    const translateFor = (flatIndex: number) => -(flatIndex * ITEM_WIDTH + ITEM_WIDTH / 2 - width / 2);
    const targetTranslateX = translateFor(targetFlatIndex);

    translateX.value = 0;

    // A handful of distinct "near miss" beats - real prize-wheel apps mix
    // several of these rather than reusing one, so it doesn't get
    // predictable. Whether one happens at all stays at the same ~45%
    // chance as before; when one does, which kind is picked at random too.
    const shouldTease = itemsLength >= 3 && Math.random() < 0.45;
    const variant = shouldTease ? 1 + Math.floor(Math.random() * 4) : 0;

    if (variant === 1) {
      // Single tease: hard brake near one wrong item, then carries on.
      const teaseFlatIndex = Math.max(0, targetFlatIndex - (2 + Math.floor(Math.random() * 3)));
      const teasePortion = 0.55 + Math.random() * 0.15;
      translateX.value = withSequence(
        withTiming(translateFor(teaseFlatIndex), { duration: SPIN_DURATION * teasePortion, easing: Easing.out(Easing.cubic) }),
        withTiming(
          targetTranslateX,
          { duration: SPIN_DURATION * (1 - teasePortion), easing: Easing.inOut(Easing.cubic) },
          (finished) => {
            if (finished) runOnJS(onSpinSettled)(target);
          }
        )
      );
    } else if (variant === 2) {
      // Double tease: two separate near-misses before the real target.
      const tease1 = Math.max(0, targetFlatIndex - (7 + Math.floor(Math.random() * 3)));
      const tease2 = Math.max(0, targetFlatIndex - (2 + Math.floor(Math.random() * 3)));
      translateX.value = withSequence(
        withTiming(translateFor(tease1), { duration: SPIN_DURATION * 0.42, easing: Easing.out(Easing.cubic) }),
        withTiming(translateFor(tease2), { duration: SPIN_DURATION * 0.33, easing: Easing.inOut(Easing.cubic) }),
        withTiming(targetTranslateX, { duration: SPIN_DURATION * 0.25, easing: Easing.inOut(Easing.cubic) }, (finished) => {
          if (finished) runOnJS(onSpinSettled)(target);
        })
      );
    } else if (variant === 3) {
      // Overshoot: rolls just past the target, then rolls back onto it -
      // like real momentum carrying a wheel a little too far.
      const overshootFlatIndex = Math.min(totalTiles - 1, targetFlatIndex + 1 + Math.floor(Math.random() * 2));
      translateX.value = withSequence(
        withTiming(translateFor(overshootFlatIndex), { duration: SPIN_DURATION * 0.85, easing: Easing.out(Easing.cubic) }),
        withTiming(targetTranslateX, { duration: SPIN_DURATION * 0.15, easing: Easing.inOut(Easing.quad) }, (finished) => {
          if (finished) runOnJS(onSpinSettled)(target);
        })
      );
    } else if (variant === 4) {
      // Long hover: creeps down to almost a dead stop right next to the
      // target, lingers there, then finally inches onto it.
      const hoverFlatIndex = Math.max(0, targetFlatIndex - 1);
      translateX.value = withSequence(
        withTiming(translateFor(hoverFlatIndex), { duration: SPIN_DURATION * 0.82, easing: Easing.out(Easing.cubic) }),
        withTiming(targetTranslateX, { duration: SPIN_DURATION * 0.18, easing: Easing.inOut(Easing.cubic) }, (finished) => {
          if (finished) runOnJS(onSpinSettled)(target);
        })
      );
    } else {
      translateX.value = withTiming(
        targetTranslateX,
        { duration: SPIN_DURATION, easing: Easing.out(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(onSpinSettled)(target);
        }
      );
    }
  };

  if (wheel === undefined) return null;
  if (wheel === null) {
    return (
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: true, headerTitle: 'Wheel', headerStyle: { backgroundColor: colors.background } }} />
        <View style={styles.center}>
          <Text style={styles.emptyText}>This wheel couldn&apos;t be found.</Text>
        </View>
      </View>
    );
  }

  const isEmpty = wheel.items.length === 0;

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackVisible: true,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.textPrimary,
          headerTitleAlign: 'left',
          headerTitle: () => <HeaderTitle icon={SECTION_META.spin.icon} tint={colors.spin} title={wheel.name} />,
          headerRight: () => (
            <TouchableOpacity
              style={styles.headerButton}
              onPress={() => router.push({ pathname: '/spin/builder', params: { wheelId: wheel.id } })}
            >
              <Ionicons name="create-outline" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          ),
        }}
      />

      {isEmpty ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>This wheel is empty.</Text>
          <TouchableOpacity onPress={() => router.push({ pathname: '/spin/builder', params: { wheelId: wheel.id } })}>
            <Text style={[styles.emptyLink, { color: colors.spin }]}>Add some titles</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.viewport}>
            <Animated.View style={[styles.strip, stripStyle]}>
              {strip.map((item, i) => (
                <View key={`${item.id}-${i}`} style={styles.tile}>
                  {item.posterUrl ? (
                    <Image source={{ uri: item.posterUrl }} style={styles.tilePoster} cachePolicy="memory-disk" />
                  ) : (
                    <View style={[styles.tilePoster, styles.tilePosterPlaceholder]} />
                  )}
                </View>
              ))}
            </Animated.View>
            <Animated.View pointerEvents="none" style={[styles.flapper, flapperStyle, { left: width / 2 - 15 }]}>
              <Ionicons name="caret-down" size={30} color={colors.spin} />
            </Animated.View>
          </View>

          <View style={styles.resultArea}>
            {result ? (
              // No poster here - the winning title is already showing in
              // the strip above, right under the flapper, so repeating it
              // bigger below was redundant (confirmed live). Just the
              // title and an "Open" button pop in underneath.
              <View style={styles.resultCard}>
                <Text style={styles.resultTitle} numberOfLines={2}>
                  {result.title}
                </Text>
                <TouchableOpacity
                  style={[styles.openButton, { backgroundColor: colors.spin }]}
                  onPress={() => router.push(result.mediaType === 'movie' ? `/movie/${result.libraryId}` : `/series/${result.libraryId}`)}
                >
                  <Text style={styles.openButtonText}>Open</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>

          <View style={[styles.spinBar, { paddingBottom: 16 + tabBarClearance }]}>
            <TouchableOpacity style={[styles.spinButton, { backgroundColor: colors.spin }]} onPress={spin} disabled={spinning}>
              <Text style={styles.spinButtonText}>{spinning ? 'Spinning…' : 'Spin'}</Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  // See builder.tsx's identical comment - the native-stack header here
  // doesn't inset headerRight from the screen edge on its own.
  headerButton: { paddingRight: 16, paddingVertical: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  emptyText: { color: colors.textSecondary, fontSize: 15, textAlign: 'center' },
  emptyLink: { fontWeight: '700', fontSize: 15 },
  // Fixed height (not flex) sized to fit one poster row plus room for the
  // flapper above it - sits right under the header instead of stretching
  // to fill the screen and centering itself in the middle of it.
  viewport: { height: VIEWPORT_HEIGHT, marginTop: 12, overflow: 'hidden', justifyContent: 'flex-end' },
  strip: { flexDirection: 'row' },
  tile: { width: ITEM_WIDTH, alignItems: 'center' },
  tilePoster: { width: TILE_WIDTH, height: TILE_WIDTH * 1.5, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  tilePosterPlaceholder: {},
  // Pivots from its own top edge (`transformOrigin`), like a real prize
  // wheel's flapper mounted at a fixed point above the pegs - the tip
  // (pointing down at the posters) is what actually swings on each tick.
  flapper: { position: 'absolute', top: 2, transformOrigin: 'top' },
  // No longer `flex: 1` - sized to its own content (empty until a result
  // exists) and sitting directly below the viewport, rather than centering
  // in a large leftover flex region. `paddingTop` keeps the result card
  // from butting right up against the strip above it - confirmed live,
  // there was no breathing room between the strip above and the title/
  // Open button popping in below it.
  resultArea: { alignItems: 'center', paddingHorizontal: 16, paddingTop: 32 },
  resultCard: { alignItems: 'center', gap: 10 },
  resultTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', textAlign: 'center', maxWidth: 280 },
  openButton: { paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, marginTop: 4 },
  openButtonText: { color: '#1A1300', fontWeight: '700', fontSize: 15 },
  // A normal in-flow element (not `position: absolute`) - reserves its own
  // space at the bottom of the column instead of floating over content,
  // so it can never overlap the result card or the bottom nav pill.
  spinBar: { alignItems: 'center', paddingTop: 16 },
  spinButton: { paddingHorizontal: 40, paddingVertical: 16, borderRadius: 30, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  spinButtonText: { color: '#1A1300', fontWeight: '700', fontSize: 17 },
});
