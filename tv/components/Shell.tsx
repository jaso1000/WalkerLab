// Every top-level TV screen sits in this shell: a slim icon rail on the left (the phone's
// CompactSidebar idea) that widens over the content to show section names while focus is on it, and
// the screen beside it. Left from the content's first column lands on the rail; Right leaves it.
// Sections switch with router.replace - they are siblings, so Back from one leaves the app, as other
// TV apps do.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useProfiles } from '../../src/context/ProfilesContext';
import { SectionId } from '../../src/lib/sectionNames';
import { colors } from '../../src/theme/colors';
import { useNavSections } from '../lib/sections';
import { FocusCard } from './FocusCard';
import { TV_LIST } from './ui';

export const RAIL_WIDTH = 76;
const RAIL_OPEN_WIDTH = 250;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function SideRail({ active }: { active: SectionId }) {
  const sections = useNavSections();
  const { activeProfile } = useProfiles();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus moving between two rail items fires blur then focus: close only if nothing on the rail
  // picked focus back up a moment later.
  const focusIn = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const focusOut = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 80);
  };
  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  const item = (key: string, icon: keyof typeof Ionicons.glyphMap, label: string, tint: string, on: boolean, onPress: () => void) => (
    <RailItem key={key} icon={icon} label={label} tint={tint} on={on} open={open} onPress={onPress} onFocus={focusIn} onBlur={focusOut} />
  );

  return (
    <View style={[styles.rail, open && styles.railOpen]}>
      <View style={styles.brand}>
        <Image source={require('../../assets/walkerlab-icon.png')} style={styles.logo} />
        {open ? (
          <Text style={styles.brandText}>
            Walker<Text style={{ color: colors.brand }}>Lab</Text>
          </Text>
        ) : null}
      </View>
      {/* Up to 12 sections is taller than the screen: the list scrolls, and Android keeps the focused one in view.
          A ScrollView clips its content, so the rail's side padding lives inside it: room for the focused
          item's scale and outline. */}
      <ScrollView {...TV_LIST} style={styles.items} contentContainerStyle={styles.itemsContent} showsVerticalScrollIndicator={false}>
        {sections
          .filter((s) => s.id !== 'settings')
          .map((s) => item(s.id, s.icon, s.label, s.tint, s.id === active, () => s.id !== active && router.replace(s.href as never)))}
      </ScrollView>
      <View style={styles.footer}>
        {sections
          .filter((s) => s.id === 'settings')
          .map((s) => item(s.id, s.icon, s.label, colors.textSecondary, active === 'settings', () => active !== 'settings' && router.replace(s.href as never)))}
        {item('profile', 'server-outline', activeProfile.name, colors.textSecondary, false, () => router.push('/setup'))}
      </View>
    </View>
  );
}

function RailItem({
  icon,
  label,
  tint,
  on,
  open,
  onPress,
  onFocus,
  onBlur,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
  on: boolean;
  open: boolean;
  onPress: () => void;
  onFocus: () => void;
  onBlur: () => void;
}) {
  return (
    <FocusCard radius={14} scale={1.03} style={[styles.item, on && { backgroundColor: `${tint}26` }]} onPress={onPress} onFocus={onFocus} onBlur={onBlur}>
      <View style={[styles.iconCircle, { backgroundColor: on ? tint : `${tint}26` }]}>
        <Ionicons name={icon} size={19} color={on ? colors.background : tint} />
      </View>
      {open ? (
        <Text style={[styles.label, on && { color: colors.textPrimary, fontWeight: '700' }]} numberOfLines={1}>
          {label}
        </Text>
      ) : null}
    </FocusCard>
  );
}

export function Shell({ active, children }: { active: SectionId; children: React.ReactNode }) {
  const now = useClock();
  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        {children}
        <Text style={styles.clock} pointerEvents="none">
          {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </Text>
      </View>
      <SideRail active={active} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, marginLeft: RAIL_WIDTH },
  clock: { position: 'absolute', top: 22, right: 40, color: colors.textPrimary, fontSize: 20, fontWeight: '300' },
  rail: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: RAIL_WIDTH,
    backgroundColor: colors.background,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: 18,
    zIndex: 10,
  },
  railOpen: { width: RAIL_OPEN_WIDTH, backgroundColor: colors.surface, elevation: 16 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 17, marginBottom: 10, height: 38 },
  logo: { width: 34, height: 34, borderRadius: 8 },
  brandText: { color: colors.textPrimary, fontSize: 19, fontWeight: '700' },
  items: { flex: 1 },
  itemsContent: { gap: 3, paddingHorizontal: 10, paddingVertical: 6 },
  footer: { gap: 3, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 6, paddingHorizontal: 10 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 5, backgroundColor: 'transparent' },
  iconCircle: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  label: { color: colors.textSecondary, fontSize: 15, fontWeight: '600', flex: 1 },
});
