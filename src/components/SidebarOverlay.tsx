// Off-canvas sidebar shown at the tabletMedium nav tier (640-1024px, see
// src/lib/navChrome.ts) - the same <Sidebar> content the tabletLarge tier
// renders bare/pinned, but here absolutely positioned (full height, fixed
// SIDEBAR_WIDTH - NOT full screen width) and slid in/out via an
// Animated.Value translateX (same technique SwipeTabBar.tsx already uses for
// its sliding tab indicator, no new animation library), with a
// semi-transparent backdrop behind it that fades in/out on the same value
// and closes the sidebar on tap. Sidebar itself stays a plain content
// component - all of the "it's an overlay" behavior (positioning, animation,
// backdrop, closing itself after a real navigation or via its own close
// button) lives here instead.
import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { Sidebar } from './Sidebar';
import { SIDEBAR_WIDTH } from '../lib/navChrome';
import { StartupSectionId } from '../lib/startupScreen';

export function SidebarOverlay({
  visible,
  order,
  onClose,
}: {
  visible: boolean;
  order: StartupSectionId[];
  onClose: () => void;
}) {
  const translateX = useRef(new Animated.Value(-SIDEBAR_WIDTH)).current;

  useEffect(() => {
    Animated.timing(translateX, {
      toValue: visible ? 0 : -SIDEBAR_WIDTH,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [visible, translateX]);

  const backdropOpacity = translateX.interpolate({
    inputRange: [-SIDEBAR_WIDTH, 0],
    outputRange: [0, 1],
  });

  return (
    <>
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}
        pointerEvents={visible ? 'auto' : 'none'}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View style={[styles.panel, { transform: [{ translateX }] }]} pointerEvents={visible ? 'auto' : 'none'}>
        <Sidebar order={order} onNavigate={onClose} onClose={onClose} />
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.5)' },
  panel: { position: 'absolute', left: 0, top: 0, bottom: 0, width: SIDEBAR_WIDTH, zIndex: 10, elevation: 10 },
});
