// Animated sliding-indicator tab bar driven by a swipeable page view's
// `scrollX` Animated.Value (see callers pairing this with a horizontal
// paged ScrollView) - the indicator position/width and label colors
// interpolate directly off the live scroll position rather than snapping
// only once a swipe settles, so the highlight tracks your finger in
// real time. Auto-scrolls horizontally to keep the active tab in view when
// there are more tabs than fit on screen (e.g. TV Shows' 6 tabs).
import { useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { colors } from '../theme/colors';

// Measured on-screen position/width of one tab label, used to place the
// sliding indicator and to auto-scroll the active tab into view.
interface TabLayout {
  x: number;
  width: number;
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
  scrollX: Animated.Value;
  pageWidth: number;
  tint?: string;
}) {
  const [layoutsByIndex, setLayoutsByIndex] = useState<Record<number, TabLayout>>({});
  const [viewportWidth, setViewportWidth] = useState(0);
  // Tracks which tab is nearest mid-swipe, purely for the bold font-weight
  // snap - the text color itself is driven straight off `scrollX` below so
  // it crossfades live with the drag instead of waiting for the page to
  // settle (that lag was the actual complaint: swiping felt like the
  // highlight was a beat behind your finger).
  const [nearestTab, setNearestTab] = useState(activeTab);
  const scrollRef = useRef<ScrollView>(null);

  // `onSettle` is recreated every render in every caller (it's not wrapped
  // in useCallback anywhere) - a ref avoids re-subscribing the scrollX
  // listener below on every single render while still always calling the
  // latest version.
  const onSettleRef = useRef(onSettle);
  onSettleRef.current = onSettle;

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
  // class-level comment on `nearestTab` above) - separate from the
  // continuous color interpolation below, which needs no listener at all.
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
  useEffect(() => {
    // `scrollX` reports a new value on every scroll frame throughout the
    // whole gesture (drag + momentum deceleration), not just once when the
    // swipe actually lands on a new tab - `setNearestTab`'s functional form
    // already no-ops when `idx` hasn't changed, but `onSettleRef` was being
    // called unconditionally on every single firing regardless. Each call
    // re-invokes the caller's `handleTabChange`, which lazily fires that
    // tab's data load if it hasn't loaded yet - and since that guard is only
    // set once the load's promise *resolves*, dozens of same-tab listener
    // firings before the first request completes fired dozens of duplicate
    // concurrent requests. Imperceptible on native/LAN (each resolves in a
    // few ms, so the guard flips almost immediately), but a real request
    // storm once real network latency is in the picture (e.g. proxied
    // through the Docker/web deployment's cloud tunnel) - confirmed live via
    // the server's proxy logs showing ~35 identical Sonarr requests fired in
    // ~4 seconds while sitting on one tab. Track the last-seen index and only
    // call `onSettle` when it actually changes, matching `onSettle`'s own
    // "just crossed into a new tab" semantics.
    let lastIdx = -1;
    const id = scrollX.addListener(({ value }) => {
      const idx = Math.max(0, Math.min(tabs.length - 1, Math.round(value / pageWidth)));
      setNearestTab((prev) => (prev === idx ? prev : idx));
      if (idx !== lastIdx) {
        lastIdx = idx;
        onSettleRef.current?.(idx);
      }
    });
    return () => scrollX.removeListener(id);
  }, [scrollX, pageWidth, tabs.length]);

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
      {tabs.map((tab, index) => {
        // Crossfades this label between muted/primary text color as the
        // swipe passes through its neighbors, live off `scrollX` - this is
        // what makes the color transition track the drag in real time
        // instead of only flipping once the page settles.
        const color = scrollX.interpolate({
          inputRange: [(index - 1) * pageWidth, index * pageWidth, (index + 1) * pageWidth],
          outputRange: [colors.textSecondary, colors.textPrimary, colors.textSecondary],
          extrapolate: 'clamp',
        });
        return (
          <TouchableOpacity key={tab} style={styles.tab} onPress={() => onChange(index)} onLayout={handleLayout(index)}>
            <Animated.Text style={[styles.label, { color }, nearestTab === index && styles.labelActive]}>
              {tab}
            </Animated.Text>
          </TouchableOpacity>
        );
      })}
      {measured ? (
        // Interpolates the indicator's left/width directly between each
        // tab's measured layout as `scrollX` moves, so it slides smoothly
        // across variable-width labels instead of jumping discretely.
        <Animated.View
          style={[
            styles.indicator,
            {
              backgroundColor: tint,
              left: scrollX.interpolate({ inputRange, outputRange: layouts.map((l) => l.x), extrapolate: 'clamp' }),
              width: scrollX.interpolate({ inputRange, outputRange: layouts.map((l) => l.width), extrapolate: 'clamp' }),
            },
          ]}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', gap: 20, position: 'relative' },
  tab: { paddingBottom: 9 },
  label: { fontSize: 16, fontWeight: '600' },
  labelActive: { fontWeight: '800' },
  indicator: { position: 'absolute', bottom: 0, height: 3, borderRadius: 2 },
});
