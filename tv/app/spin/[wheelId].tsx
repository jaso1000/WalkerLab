// Spinning a wheel on the TV (the phone's app/spin/[wheelId]): the wheel's posters run past a marker
// and ease to a stop on a random title - an Animated translate on the native driver, so the spin
// stays smooth on this hardware. Then Open (the title's page) or Spin again. With "remove title after
// landing" on, landed titles leave the wheel when you leave the screen, as on the phone; titles
// already landed on this visit are not picked again.
//
// Same spin rules as the phone (keep the two in step): the lap count scales with the wheel's size
// (lapsFor), about 45% of spins on a 3+ title wheel play one of four near-miss "fake-outs" before
// landing, and a pointer above the marker ticks as each poster passes it. The winner is always picked
// first; the fake-outs only change the path the strip takes to get there.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useProfiles } from '../../../src/context/ProfilesContext';
import { alert } from '../../../src/lib/alert';
import { getWheels, saveWheel, Wheel, WheelItem, wheelItemHref } from '../../../src/lib/wheels';
import { colors } from '../../../src/theme/colors';
import { ActionButton } from '../../components/Detail';
import { Loading, ScreenHeader } from '../../components/ui';
import { tvRoute } from '../../lib/routes';

const TILE_W = 150;
const TILE_H = 225;
const GAP = 22;
const STEP = TILE_W + GAP;
const SPIN_MS = 5200;
const POINTER_SIZE = 30;

// Same lap rule as the phone's lapsFor: small wheels get MAX_LAPS, big ones fewer so the strip never
// mounts more than MAX_TOTAL_TILES posters. Needs a few spare laps after the target for the overshoot.
const MAX_LAPS = 16;
const MIN_LAPS = 6;
const MAX_TOTAL_TILES = MAX_LAPS * 30;
function lapsFor(itemCount: number): number {
  if (itemCount <= 0) return MAX_LAPS;
  return Math.max(MIN_LAPS, Math.min(MAX_LAPS, Math.floor(MAX_TOTAL_TILES / itemCount)));
}

// One leg of a spin: move the strip to `toValue` over a share of SPIN_MS.
function leg(x: Animated.Value, toValue: number, share: number, easing: (t: number) => number) {
  return Animated.timing(x, { toValue, duration: SPIN_MS * share, easing, useNativeDriver: true });
}

export default function TvSpinWheel() {
  const { wheelId } = useLocalSearchParams<{ wheelId: string }>();
  const { activeProfileId } = useProfiles();
  const { width } = useWindowDimensions();
  const [wheel, setWheel] = useState<Wheel | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState<WheelItem | null>(null);
  const x = useRef(new Animated.Value(0)).current;
  const pointerTilt = useRef(new Animated.Value(0)).current;
  const landedIds = useRef<Set<string>>(new Set());
  const wheelRef = useRef<Wheel | null>(null);
  wheelRef.current = wheel;

  useEffect(() => {
    getWheels(activeProfileId)
      .then((ws) => setWheel(ws.find((w) => w.id === wheelId) ?? null))
      .catch((e) => alert('Failed to load wheel', e instanceof Error ? e.message : 'Unknown error'));
  }, [activeProfileId, wheelId]);

  // Remove-after-landing applies on leaving, so a title stays visible while its result is on screen.
  useEffect(
    () => () => {
      const w = wheelRef.current;
      if (!w?.removeAfterSpin || landedIds.current.size === 0) return;
      const next = { ...w, items: w.items.filter((i) => !landedIds.current.has(i.id)), updatedAt: new Date().toISOString() };
      saveWheel(activeProfileId, next).catch(() => {});
    },
    [activeProfileId]
  );

  // The ticking pointer: whenever the poster under the marker changes, flick the pointer aside and let
  // it spring back. Driven by the strip's real position, so the ticks slow down as the spin does. The
  // listener only reads the value; the tilt itself runs on the native driver.
  useEffect(() => {
    let lastTile: number | null = null;
    const id = x.addListener(({ value }) => {
      const tile = Math.floor(-value / STEP + 0.5);
      if (lastTile !== null && tile !== lastTile) {
        pointerTilt.stopAnimation();
        Animated.sequence([
          Animated.timing(pointerTilt, { toValue: 26, duration: 45, useNativeDriver: true }),
          Animated.spring(pointerTilt, { toValue: 0, damping: 5, stiffness: 300, useNativeDriver: true }),
        ]).start();
      }
      lastTile = tile;
    });
    return () => x.removeListener(id);
  }, [x, pointerTilt]);

  const items = wheel?.items ?? [];
  const laps = lapsFor(items.length);
  const strip = useMemo(() => Array.from({ length: laps }, () => items).flat(), [items, laps]);
  const pointerRotate = pointerTilt.interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] });

  if (!wheel) return <Loading tint={colors.spin} />;
  const centerOffset = width / 2 - TILE_W / 2;

  const spin = () => {
    const available = items.filter((i) => !(wheel.removeAfterSpin && landedIds.current.has(i.id)));
    if (available.length === 0) {
      alert('Nothing left to spin', "You've landed on every title in this wheel already - leave and come back to reset it.");
      return;
    }
    const target = available[Math.floor(Math.random() * available.length)];
    const count = items.length;
    // A couple of laps short of the end, leaving strip after the target for the overshoot.
    const lap = laps - 3 - Math.floor(Math.random() * 2);
    const targetFlat = lap * count + items.indexOf(target);
    const lastFlat = laps * count - 1;
    const at = (flatIndex: number) => -flatIndex * STEP;
    const end = at(targetFlat);

    // Near-miss beats, same odds and shapes as the phone.
    const shouldTease = count >= 3 && Math.random() < 0.45;
    const variant = shouldTease ? 1 + Math.floor(Math.random() * 4) : 0;
    let animation: Animated.CompositeAnimation;
    if (variant === 1) {
      // Single tease: hard brake near one wrong title, then carries on.
      const tease = Math.max(0, targetFlat - (2 + Math.floor(Math.random() * 3)));
      const share = 0.55 + Math.random() * 0.15;
      animation = Animated.sequence([
        leg(x, at(tease), share, Easing.out(Easing.cubic)),
        leg(x, end, 1 - share, Easing.inOut(Easing.cubic)),
      ]);
    } else if (variant === 2) {
      // Double tease: two separate near-misses before the real winner.
      const tease1 = Math.max(0, targetFlat - (7 + Math.floor(Math.random() * 3)));
      const tease2 = Math.max(0, targetFlat - (2 + Math.floor(Math.random() * 3)));
      animation = Animated.sequence([
        leg(x, at(tease1), 0.42, Easing.out(Easing.cubic)),
        leg(x, at(tease2), 0.33, Easing.inOut(Easing.cubic)),
        leg(x, end, 0.25, Easing.inOut(Easing.cubic)),
      ]);
    } else if (variant === 3) {
      // Overshoot: rolls just past the winner, then rolls back onto it.
      const past = Math.min(lastFlat, targetFlat + 1 + Math.floor(Math.random() * 2));
      animation = Animated.sequence([
        leg(x, at(past), 0.85, Easing.out(Easing.cubic)),
        leg(x, end, 0.15, Easing.inOut(Easing.quad)),
      ]);
    } else if (variant === 4) {
      // Long hover: creeps to a near-stop on the title before the winner, then inches onto it.
      animation = Animated.sequence([
        leg(x, at(Math.max(0, targetFlat - 1)), 0.82, Easing.out(Easing.cubic)),
        leg(x, end, 0.18, Easing.inOut(Easing.cubic)),
      ]);
    } else {
      animation = leg(x, end, 1, Easing.out(Easing.cubic));
    }

    setLanded(null);
    setSpinning(true);
    x.setValue(0);
    animation.start(() => {
      setSpinning(false);
      setLanded(target);
      if (wheel.removeAfterSpin) landedIds.current.add(target.id);
    });
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title={wheel.name} tint={colors.spin} subtitle={`${items.length} titles`} />
      {items.length === 0 ? (
        <Text style={styles.empty}>This wheel has no titles yet - edit it to add some.</Text>
      ) : (
        <>
          <View style={styles.stage}>
            <Animated.View style={[styles.strip, { transform: [{ translateX: Animated.add(x, new Animated.Value(centerOffset)) }] }]}>
              {strip.map((item, i) => (
                <View key={`${item.id}-${i}`} style={styles.tile}>
                  {item.posterUrl ? (
                    <Image source={{ uri: item.posterUrl }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                  ) : (
                    <Text style={styles.tileText}>{item.title}</Text>
                  )}
                </View>
              ))}
            </Animated.View>
            <View pointerEvents="none" style={[styles.marker, { left: width / 2 - TILE_W / 2 - 6 }]} />
            <Animated.View
              pointerEvents="none"
              style={[styles.pointer, { left: width / 2 - POINTER_SIZE / 2, transform: [{ rotate: pointerRotate }] }]}
            >
              <Ionicons name="caret-down" size={POINTER_SIZE} color={colors.spin} />
            </Animated.View>
          </View>
          <View style={styles.result}>
            <Text style={styles.resultTitle} numberOfLines={1}>
              {spinning ? 'Spinning…' : landed ? landed.title : 'Ready when you are'}
            </Text>
            <View style={styles.buttons}>
              <ActionButton icon="shuffle" label={landed ? 'Spin again' : 'Spin'} tint={colors.spin} primary preferredFocus onPress={() => (spinning ? undefined : spin())} />
              {landed && !spinning ? (
                <ActionButton icon="open-outline" label="Open" tint={colors.spin} onPress={() => router.push(tvRoute(wheelItemHref(landed)) as never)} />
              ) : null}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

// The stage is taller than the tile row by enough to fit the pointer above the marker's top edge.
const STAGE_H = TILE_H + 70;
const MARKER_TOP = (STAGE_H - TILE_H) / 2 - 12;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  stage: { height: STAGE_H, marginTop: 20, overflow: 'hidden', justifyContent: 'center' },
  strip: { flexDirection: 'row', gap: GAP },
  tile: { width: TILE_W, height: TILE_H, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  tileText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', padding: 8 },
  marker: { position: 'absolute', top: MARKER_TOP, width: TILE_W + 12, height: TILE_H + 24, borderRadius: 16, borderWidth: 4, borderColor: colors.spin },
  pointer: { position: 'absolute', top: MARKER_TOP - POINTER_SIZE + 8, transformOrigin: 'top' },
  result: { alignItems: 'center', marginTop: 24 },
  resultTitle: { color: colors.textPrimary, fontSize: 26, fontWeight: '700' },
  buttons: { flexDirection: 'row', gap: 14, marginTop: 16 },
  empty: { color: colors.textMuted, fontSize: 16, padding: 40 },
});
