// Dual-thumb range slider (runtime/rating/vote-count filters on the Discover
// browse screen). Custom-built rather than a third-party slider package -
// `react-native-gesture-handler` and `react-native-reanimated` are already
// real dependencies (reanimated proved out this session in
// `SwipeTabBar.tsx`), so a `Gesture.Pan()` + shared-value slider needed no
// new dependency and no extra native prebuild step, unlike every off-the-
// shelf range-slider package, which are native modules.
//
// Thumb position/track-fill are pure UI-thread `useAnimatedStyle` outputs
// (smooth regardless of JS-thread load), matching the animation approach
// this session already established. The numeric label text is plain React
// state instead, updated via `runOnJS` on every drag frame - unlike the
// tab-swipe indicator this replaces no *ambient*, always-running animation,
// it only runs while a finger is actually on a thumb, so the JS-thread hop
// for text is a normal, cheap tradeoff here (Reanimated has no clean way to
// mutate a plain `Text` node's characters purely on the UI thread).
import { useCallback, useEffect, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { colors } from '../theme/colors';

const THUMB_SIZE = 24;

export function RangeSlider({
  min,
  max,
  step = 1,
  value,
  onValueChange,
  formatLabel = (v: number) => String(v),
  tint = colors.sectionGreen,
}: {
  min: number;
  max: number;
  step?: number;
  value: [number, number];
  onValueChange: (value: [number, number]) => void;
  formatLabel?: (value: number) => string;
  tint?: string;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [liveLabel, setLiveLabel] = useState<[number, number]>(value);

  const lowX = useSharedValue(0);
  const highX = useSharedValue(0);
  const lowStartX = useSharedValue(0);
  const highStartX = useSharedValue(0);
  const trackWidthShared = useSharedValue(0);

  const valueToX = useCallback((v: number, width: number) => ((v - min) / (max - min || 1)) * width, [min, max]);
  const xToValue = useCallback(
    (x: number, width: number) => {
      if (width <= 0) return min;
      const raw = min + (x / width) * (max - min);
      const stepped = Math.round(raw / step) * step;
      return Math.min(max, Math.max(min, stepped));
    },
    [min, max, step]
  );

  // Re-syncs thumb pixel positions whenever the track is first measured or
  // the controlled `value` prop changes from outside this component (e.g.
  // the filter sheet's own "Clear Filters" resetting it back to defaults).
  useEffect(() => {
    trackWidthShared.value = trackWidth;
    if (trackWidth > 0) {
      lowX.value = valueToX(value[0], trackWidth);
      highX.value = valueToX(value[1], trackWidth);
    }
    setLiveLabel(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackWidth, value[0], value[1]]);

  const reportLow = (x: number) => setLiveLabel(([, hi]) => [xToValue(x, trackWidth), hi]);
  const reportHigh = (x: number) => setLiveLabel(([lo]) => [lo, xToValue(x, trackWidth)]);
  const commit = () => onValueChange([xToValue(lowX.value, trackWidth), xToValue(highX.value, trackWidth)]);

  const lowGesture = Gesture.Pan()
    .hitSlop(14)
    .onStart(() => {
      lowStartX.value = lowX.value;
    })
    .onUpdate((e) => {
      const next = Math.min(Math.max(lowStartX.value + e.translationX, 0), highX.value);
      lowX.value = next;
      runOnJS(reportLow)(next);
    })
    .onEnd(() => {
      runOnJS(commit)();
    });

  const highGesture = Gesture.Pan()
    .hitSlop(14)
    .onStart(() => {
      highStartX.value = highX.value;
    })
    .onUpdate((e) => {
      const next = Math.min(Math.max(highStartX.value + e.translationX, lowX.value), trackWidthShared.value);
      highX.value = next;
      runOnJS(reportHigh)(next);
    })
    .onEnd(() => {
      runOnJS(commit)();
    });

  const lowThumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: lowX.value - THUMB_SIZE / 2 }] }));
  const highThumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: highX.value - THUMB_SIZE / 2 }] }));
  const fillStyle = useAnimatedStyle(() => ({ left: lowX.value, width: Math.max(0, highX.value - lowX.value) }));

  return (
    <View style={styles.wrapper}>
      <View style={styles.labelsRow}>
        <Text style={styles.label}>{formatLabel(liveLabel[0])}</Text>
        <Text style={styles.label}>{formatLabel(liveLabel[1])}</Text>
      </View>
      <View style={styles.track} onLayout={(e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width)}>
        <View style={styles.trackBg} />
        <Animated.View style={[styles.trackFill, { backgroundColor: tint }, fillStyle]} />
        <GestureDetector gesture={lowGesture}>
          <Animated.View style={[styles.thumb, { borderColor: tint }, lowThumbStyle]} />
        </GestureDetector>
        <GestureDetector gesture={highGesture}>
          <Animated.View style={[styles.thumb, { borderColor: tint }, highThumbStyle]} />
        </GestureDetector>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Horizontal inset matters here, not just cosmetics: without it, a thumb
  // resting at the track's min/max (its usual starting position) sits only
  // a few px from the true screen edge - well inside the iOS/Android
  // edge-swipe-back gesture's hot zone, so a drag meant for the thumb gets
  // stolen by the OS back gesture instead.
  // A first pass at this (16px here, on top of the filter sheet's own 16px
  // content padding) still wasn't enough in practice - confirmed live, back
  // gestures were still winning. The reason: what actually matters is the
  // *touchable* zone's distance from the true edge, not the padding number
  // itself. A thumb at position 0 is drawn centered on the track's edge (so
  // half its own width, THUMB_SIZE/2, already overhangs into the padding),
  // and each thumb's Pan gesture below adds `hitSlop(14)` on top of that to
  // make it easier to grab - both eat back into the padding before the OS's
  // hot zone is actually cleared. 32px here (on top of the sheet's 16px)
  // nets out to roughly 32+16-12-14 = 22px of real clearance, comfortably
  // past typical edge-gesture zones (~20-24dp, more on some phones/
  // sensitivity settings) - if this ever needs revisiting, account for that
  // full formula, not just this raw number.
  wrapper: { paddingVertical: 8, paddingHorizontal: 32 },
  labelsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  label: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
  track: { height: THUMB_SIZE, justifyContent: 'center' },
  trackBg: { position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt },
  trackFill: { position: 'absolute', height: 4, borderRadius: 2 },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: colors.textPrimary,
    borderWidth: 3,
  },
});
