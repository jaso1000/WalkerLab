// Spinning a wheel on the TV (the phone's app/spin/[wheelId]): the wheel's posters run past a marker
// and ease to a stop on a random title - an Animated translate on the native driver, so the spin
// stays smooth on this hardware. Then Open (the title's page) or Spin again. With "remove title after
// landing" on, landed titles leave the wheel when you leave the screen, as on the phone; titles
// already landed on this visit are not picked again.
import { router, useLocalSearchParams } from 'expo-router';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
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
const LAPS = 8;
const SPIN_MS = 5200;

export default function TvSpinWheel() {
  const { wheelId } = useLocalSearchParams<{ wheelId: string }>();
  const { activeProfileId } = useProfiles();
  const { width } = useWindowDimensions();
  const [wheel, setWheel] = useState<Wheel | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [landed, setLanded] = useState<WheelItem | null>(null);
  const x = useRef(new Animated.Value(0)).current;
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

  if (!wheel) return <Loading tint={colors.spin} />;
  const items = wheel.items;
  const strip = Array.from({ length: LAPS + 2 }, () => items).flat();
  const centerOffset = width / 2 - TILE_W / 2;

  const spin = () => {
    const available = items.filter((i) => !(wheel.removeAfterSpin && landedIds.current.has(i.id)));
    if (available.length === 0) {
      alert('Nothing left to spin', "You've landed on every title in this wheel already - leave and come back to reset it.");
      return;
    }
    const target = available[Math.floor(Math.random() * available.length)];
    const lap = LAPS - 1 - Math.floor(Math.random() * 2);
    const flatIndex = lap * items.length + items.indexOf(target);
    setLanded(null);
    setSpinning(true);
    x.setValue(0);
    Animated.timing(x, {
      toValue: -flatIndex * STEP,
      duration: SPIN_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  stage: { height: TILE_H + 40, marginTop: 30, overflow: 'hidden', justifyContent: 'center' },
  strip: { flexDirection: 'row', gap: GAP },
  tile: { width: TILE_W, height: TILE_H, borderRadius: 12, overflow: 'hidden', backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  tileText: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', padding: 8 },
  marker: { position: 'absolute', top: 8, width: TILE_W + 12, height: TILE_H + 24, borderRadius: 16, borderWidth: 4, borderColor: colors.spin },
  result: { alignItems: 'center', marginTop: 24 },
  resultTitle: { color: colors.textPrimary, fontSize: 26, fontWeight: '700' },
  buttons: { flexDirection: 'row', gap: 14, marginTop: 16 },
  empty: { color: colors.textMuted, fontSize: 16, padding: 40 },
});
