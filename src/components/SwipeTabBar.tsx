// Animated sliding-indicator tab bar driven by a swipeable page view's
// `scrollX` shared value (see callers pairing this with a horizontal paged
// ScrollView) - the indicator position/width and label colors interpolate
// directly off the live scroll position rather than snapping only once a
// swipe settles, so the highlight tracks your finger in real time. Auto-
// scrolls horizontally to keep the active tab in view when there are more
// tabs than fit on screen (e.g. TV Shows' 6 tabs).
//
// Built on react-native-reanimated rather than the classic Animated API:
// the indicator interpolates `left`/`width` and the label interpolates
// `color`, neither of which the classic API's native driver supports, so a
// classic-Animated version of this component is stuck running every frame
// of every swipe on the JS thread. Reanimated's worklets run this same
// per-frame interpolation on the UI thread instead, so it can't be blocked
// by JS thread work (data loading, list rendering) happening at the same
// time - this is the single most-exercised animation in the app (every
// tabbed screen uses it), so it's the highest-value place for that to
// matter.
import { useEffect, useRef, useState } from 'react';
import { LayoutChangeEvent, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  interpolateColor,
  runOnJS,
  SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { colors } from '../theme/colors';

// Measured on-screen position/width of one tab label, used to place the
// sliding indicator and to auto-scroll the active tab into view.
interface TabLayout {
  x: number;
  width: number;
}

// One tab's label, split out into its own component so it can call its own
// `useAnimatedStyle` - the color interpolation depends on this tab's own
// index, and hooks can't be called a variable number of times inside a
// `.map()` on the parent.
function TabLabel({
  tab,
  index,
  active,
  scrollX,
  pageWidth,
  onLayout,
  onPress,
}: {
  tab: string;
  index: number;
  active: boolean;
  scrollX: SharedValue<number>;
  pageWidth: number;
  onLayout: (e: LayoutChangeEvent) => void;
  onPress: () => void;
}) {
  const colorStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      scrollX.value,
      [(index - 1) * pageWidth, index * pageWidth, (index + 1) * pageWidth],
      [colors.textSecondary, colors.textPrimary, colors.textSecondary]
    ),
  }));
  return (
    <TouchableOpacity style={styles.tab} onPress={onPress} onLayout={onLayout}>
      <Animated.Text style={[styles.label, colorStyle, active && styles.labelActive]}>{tab}</Animated.Text>
    </TouchableOpacity>
  );
}

export function SwipeTabBar({
  tabs,
  activeTab,
  onChange,
  onSettle,
  scrollX,
  pageWidth,
  tint = colors.accent,
}: {
  tabs: readonly string[];
  activeTab: number;
  // Tap path: the caller both updates its own `activeTab` state AND
  // imperatively scrolls the content view to match (there's nothing else
  // that would move the content on a plain tap).
  onChange: (index: number) => void;
  // Swipe-settle path: state-only update, no imperative scroll - the
  // content is already at that position because the user's own gesture put
  // it there. Optional so existing callers that haven't been updated still
  // work (just without this reliability fix). See the effect below for why
  // this exists as a *separate* callback from `onChange` rather than reusing
  // it - calling `onChange` here would re-trigger the caller's own
  // `scrollTo`, fighting the user's finger mid-swipe.
  onSettle?: (index: number) => void;
  scrollX: SharedValue<number>;
  pageWidth: number;
  tint?: string;
}) {
  const [layoutsByIndex, setLayoutsByIndex] = useState<Record<number, TabLayout>>({});
  const [viewportWidth, setViewportWidth] = useState(0);
  // Tracks which tab is nearest mid-swipe, purely for the bold font-weight
  // snap - the text color itself is driven straight off `scrollX` on the UI
  // thread (see TabLabel above) so it crossfades live with the drag instead
  // of waiting for the page to settle (that lag was the actual complaint:
  // swiping felt like the highlight was a beat behind your finger).
  const [nearestTab, setNearestTab] = useState(activeTab);
  const scrollRef = useRef<ScrollView>(null);

  // `onSettle` is recreated every render in every caller (it's not wrapped
  // in useCallback anywhere) - a ref avoids re-subscribing the scrollX
  // reaction below on every single render while still always calling the
  // latest version. Read from the JS thread only (via runOnJS below), never
  // from inside the worklet itself.
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;
  const notifySettle = (idx: number) => onSettleRef.current?.(idx);

  // Records each tab label's real on-screen position/size as it renders -
  // needed because tab labels are variable-width text, so the indicator's
  // target x/width can't be computed analytically ahead of time.
  const handleLayout = (index: number) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    setLayoutsByIndex((prev) => ({ ...prev, [index]: { x, width } }));
  };

  // The sliding indicator only renders once every tab has reported its
  // layout - showing it partially-measured would look glitchy on first mount.
  const measured = tabs.every((_, i) => layoutsByIndex[i]);
  const layouts = tabs.map((_, i) => layoutsByIndex[i]);
  const inputRange = tabs.map((_, i) => i * pageWidth);

  // Tracks the nearest tab purely to drive the bold-label snap (see the
  // class-level comment on `nearestTab` above).
  //
  // Also calls `onSettle` directly from this same continuous signal, not
  // just relying on the caller's `onMomentumScrollEnd` - that event is
  // unreliable on react-native-web for a touch-driven scroll: browsers
  // handle touch momentum/deceleration in their own compositor, and RNW's
  // approximation of a "momentum end" event can simply not fire. Confirmed
  // on a real device as the actual cause of two symptoms that looked
  // unrelated at first: the tab bar not auto-scrolling to reveal the
  // newly-active tab after a swipe, and Upcoming/Activity/History's
  // lazy-load "inconsistently" not triggering - both ultimately depend on
  // the caller's own `activeTab` state updating, which
  // `onMomentumScrollEnd` alone wasn't reliably doing. Driving `onSettle`
  // off `scrollX` instead means it fires the moment the swipe crosses the
  // halfway point rather than waiting for the gesture to fully settle (a
  // minor behavioral difference from native), but that's a reasonable
  // trade for actually being reliable.
  useAnimatedReaction(
    () => Math.max(0, Math.min(tabs.length - 1, Math.round(scrollX.value / pageWidth))),
    (idx, prevIdx) => {
      // `prevIdx` is `null` on the reaction's first run (mount) - skip it,
      // `nearestTab` is already initialized to `activeTab` and there's no
      // real "settle" to report yet, matching the old listener-based
      // version which only ever fired on an actual scrollX change.
      if (prevIdx === null || idx === prevIdx) return;
      runOnJS(setNearestTab)(idx);
      runOnJS(notifySettle)(idx);
    },
    [tabs.length, pageWidth]
  );

  // When the active tab changes (tap, or the swipe-settle path above),
  // scrolls this tab bar horizontally so the newly-active tab is centered
  // in view, in case it was off-screen. The small delay is deliberate: on
  // react-native-web, calling `scrollTo` immediately after a layout
  // measurement changes can silently no-op if the browser hasn't finished
  // committing that layout yet (confirmed on a real device - native's Yoga
  // layout has no equivalent timing gap, so this auto-scroll always worked
  // there, but on web the tab bar could get stuck showing its initial
  // scroll position even once `activeTab` moved past what's visible, e.g.
  // landing on the last of 6 tabs while the first ones stayed pinned
  // on-screen).
  useEffect(() => {
    const active = layoutsByIndex[activeTab];
    if (!active || !viewportWidth) return;
    const centeredX = active.x + active.width / 2 - viewportWidth / 2;
    const target = Math.max(0, centeredX);
    const id = setTimeout(() => {
      scrollRef.current?.scrollTo({ x: target, animated: true });
    }, 50);
    return () => clearTimeout(id);
  }, [activeTab, layoutsByIndex, viewportWidth]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      onLayout={(e) => setViewportWidth(e.nativeEvent.layout.width)}
      contentContainerStyle={styles.container}
    >
      {tabs.map((tab, index) => (
        <TabLabel
          key={tab}
          tab={tab}
          index={index}
          active={nearestTab === index}
          scrollX={scrollX}
          pageWidth={pageWidth}
          onLayout={handleLayout(index)}
          onPress={() => onChange(index)}
        />
      ))}
      {measured ? (
        // Interpolates the indicator's left/width directly between each
        // tab's measured layout as `scrollX` moves, so it slides smoothly
        // across variable-width labels instead of jumping discretely.
        <Indicator tint={tint} scrollX={scrollX} inputRange={inputRange} layouts={layouts as TabLayout[]} />
      ) : null}
    </ScrollView>
  );
}

function Indicator({
  tint,
  scrollX,
  inputRange,
  layouts,
}: {
  tint: string;
  scrollX: SharedValue<number>;
  inputRange: number[];
  layouts: TabLayout[];
}) {
  const indicatorStyle = useAnimatedStyle(() => ({
    left: interpolate(
      scrollX.value,
      inputRange,
      layouts.map((l) => l.x),
      Extrapolation.CLAMP
    ),
    width: interpolate(
      scrollX.value,
      inputRange,
      layouts.map((l) => l.width),
      Extrapolation.CLAMP
    ),
  }));
  return <Animated.View style={[styles.indicator, { backgroundColor: tint }, indicatorStyle]} />;
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', gap: 20, position: 'relative' },
  tab: { paddingBottom: 9 },
  label: { fontSize: 16, fontWeight: '600' },
  labelActive: { fontWeight: '800' },
  indicator: { position: 'absolute', bottom: 0, height: 3, borderRadius: 2 },
});
