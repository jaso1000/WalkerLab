// Building blocks shared by the TV section screens: the screen header with its tab chips, focusable
// list rows (the TV's version of the phone's cards and rows), a progress bar, stat tiles and the
// empty / loading / not-configured states. Colours from src/theme, sizes for a 10-foot screen.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../../src/theme/colors';
import { FocusCard } from './FocusCard';

export const SIDE = 40;

/** A section's title row, with its tabs (Discover-style pills; OK on one selects it) below. */
export function ScreenHeader({
  title,
  tint,
  count,
  subtitle,
  tabs,
  active,
  onTab,
  right,
}: {
  title: string;
  tint: string;
  count?: number;
  subtitle?: string;
  tabs?: readonly string[];
  active?: number;
  onTab?: (index: number) => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {count != null ? <Text style={[styles.count, { color: tint }]}>{count}</Text> : null}
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={{ flex: 1 }} />
        {right}
      </View>
      {tabs && onTab ? <TabChips tabs={tabs} active={active ?? 0} onChange={onTab} tint={tint} /> : null}
    </View>
  );
}

export function TabChips({ tabs, active, onChange, tint }: { tabs: readonly string[]; active: number; onChange: (i: number) => void; tint: string }) {
  return (
    <View style={styles.tabs}>
      {tabs.map((t, i) => (
        <Chip key={t} label={t} on={i === active} tint={tint} onPress={() => onChange(i)} />
      ))}
    </View>
  );
}

export function Chip({ label, on, tint, onPress, onFocus, icon }: { label: string; on?: boolean; tint: string; onPress?: () => void; onFocus?: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <FocusCard radius={16} scale={1.05} style={[styles.chip, on && { backgroundColor: tint }]} onPress={onPress} onFocus={onFocus}>
      {icon ? <Ionicons name={icon} size={14} color={on ? colors.background : tint} /> : null}
      <Text style={[styles.chipText, on && { color: colors.background }]}>{label}</Text>
    </FocusCard>
  );
}

/** A small action button for a header or a row of actions. */
export function SmallButton({ icon, label, tint, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; tint: string; onPress: () => void }) {
  return (
    <FocusCard radius={16} scale={1.05} style={styles.chip} onPress={onPress}>
      <Ionicons name={icon} size={15} color={tint} />
      <Text style={styles.chipText}>{label}</Text>
    </FocusCard>
  );
}

export function ProgressBar({ value, tint, height = 6 }: { value: number; tint: string; height?: number }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <View style={{ width: `${Math.round(pct * 100)}%`, height, borderRadius: height / 2, backgroundColor: tint }} />
    </View>
  );
}

/** One focusable line in a list: optional poster/icon, title, subtitle, right-side meta and progress. */
export function ListRow({
  title,
  subtitle,
  meta,
  metaColor,
  icon,
  tint = colors.textSecondary,
  thumb,
  progress,
  onPress,
  onFocus,
  preferredFocus,
  children,
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  metaColor?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  tint?: string;
  thumb?: React.ReactNode;
  progress?: number;
  onPress?: () => void;
  onFocus?: () => void;
  preferredFocus?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <FocusCard radius={12} scale={1.015} style={styles.row} onPress={onPress} onFocus={onFocus} preferredFocus={preferredFocus}>
      {thumb}
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: `${tint}26` }]}>
          <Ionicons name={icon} size={20} color={tint} />
        </View>
      ) : null}
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.rowSub} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {progress != null ? (
          <View style={{ marginTop: 8 }}>
            <ProgressBar value={progress} tint={tint} />
          </View>
        ) : null}
        {children}
      </View>
      {meta ? (
        <Text style={[styles.rowMeta, metaColor ? { color: metaColor } : null]} numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
    </FocusCard>
  );
}

export function StatTiles({ stats, tint }: { stats: { label: string; value: string }[]; tint: string }) {
  return (
    <View style={styles.stats}>
      {stats.map((s) => (
        <View key={s.label} style={styles.stat}>
          <Text style={[styles.statValue, { color: tint }]}>{s.value}</Text>
          <Text style={styles.statLabel}>{s.label}</Text>
        </View>
      ))}
    </View>
  );
}

export function Loading({ tint }: { tint: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={tint} size="large" />
    </View>
  );
}

export function Message({ text, error }: { text: string; error?: boolean }) {
  return <Text style={[styles.message, error && { color: colors.danger }]}>{text}</Text>;
}

/** The phone's NotConfigured: a section whose service has no settings yet, with a way to Settings. */
export function NotConfigured({ service }: { service: string }) {
  return (
    <View style={styles.center}>
      <Text style={styles.ncTitle}>{service} isn't connected yet</Text>
      <Text style={styles.ncText}>Add it on your phone and restore the profile here, or set it up in Settings.</Text>
      <FocusCard radius={10} scale={1.05} style={[styles.chip, { marginTop: 18, backgroundColor: colors.accent }]} onPress={() => router.replace('/settings' as never)} preferredFocus>
        <Text style={[styles.chipText, { color: colors.background }]}>Go to Settings</Text>
      </FocusCard>
    </View>
  );
}

/**
 * Loads something for a screen and keeps it fresh: runs `fn` when `deps` change (and `enabled`), and
 * again on `reload()`. Errors are kept as text; the last good value stays on screen meanwhile.
 */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], enabled = true) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const reload = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const value = await run();
      if (mine !== seq.current) return;
      setData(value);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [run]);
  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);
  return { data, error, loading: loading && data === undefined, reload, setData };
}

/** Polls `reload` every `ms` while the screen is mounted (queues, torrents, now playing). */
export function usePoll(reload: () => void, ms: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(reload, ms);
    return () => clearInterval(t);
  }, [reload, ms, enabled]);
}

/**
 * A text box for the TV: a clear focus outline (TextInput has none of its own on Android TV), and the
 * on-screen keyboard - or the Google TV phone app's keyboard, which can paste - opens on OK.
 */
export function TvTextField({
  value,
  onChangeText,
  placeholder,
  secure,
  onSubmit,
  preferredFocus,
  style,
  autoFocus,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  onSubmit?: () => void;
  preferredFocus?: boolean;
  style?: object;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      secureTextEntry={secure}
      autoCapitalize="none"
      autoCorrect={false}
      autoFocus={autoFocus}
      returnKeyType="done"
      onSubmitEditing={onSubmit}
      hasTVPreferredFocus={preferredFocus}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.input, focused && styles.inputFocused, style]}
    />
  );
}

/** An on/off row for settings and options. */
export function ToggleRow({ label, value, onChange, tint, subtitle }: { label: string; value: boolean; onChange: (v: boolean) => void; tint: string; subtitle?: string }) {
  return (
    <FocusCard radius={12} scale={1.015} style={styles.row} onPress={() => onChange(!value)}>
      <View style={styles.rowBody}>
        <Text style={styles.rowTitle}>{label}</Text>
        {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.toggle, value && { backgroundColor: tint }]}>
        <View style={[styles.knob, value && { alignSelf: 'flex-end' }]} />
      </View>
    </FocusCard>
  );
}

/**
 * Spread on every scroll view and list (and TV_GRID on poster grids - the same thing). Android's own
 * scroll-to-focus scrolls only far enough to show the focused box and stops short on quick presses
 * (each press starts from wherever the list is mid-way), so outlines were cut off and lists lurched.
 * react-native-tvos's `snapToAlignment="item"` replaces it: on every focus change the list smooth-scrolls
 * to where the focused item's `scrollSnapAlign` says - the middle by default (every FocusCard carries
 * `center`), the start for a row's cards and the top for a whole Row (tv/components/Row), or the very
 * top for a detail page's buttons (ButtonRow). The outermost such View between the focused card and the
 * scroll view decides, so a grid cell or Row overrides the card inside it. react-native-tvos only props,
 * hence the casts.
 */
export const TV_LIST = { snapToAlignment: 'item', scrollAnimationEnabled: true } as object;
export const TV_GRID = TV_LIST;
export const SNAP_CELL = { scrollSnapAlign: 'center' } as object;
export const SNAP_START = { scrollSnapAlign: 'start' } as object;

/**
 * Every FlatList sits in one of these. On a TV, react-native-tvos wraps a FlatList's scroll view in a
 * TVFocusGuideView that takes no style, and that wrapper sizes itself to its *parent's* full height -
 * so a list under a header ran off the bottom of the screen by the header's height, Android treated
 * the rows down there as on screen, and focus walked off the visible area without the list scrolling.
 * A flex: 1 frame of its own makes that parent exactly the space the list has.
 */
export function ListFrame({ children }: { children: React.ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}

export const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

const styles = StyleSheet.create({
  header: { paddingLeft: SIDE, paddingRight: 150, paddingTop: 22, paddingBottom: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  title: { color: colors.textPrimary, fontSize: 28, fontWeight: '700' },
  count: { fontSize: 18, fontWeight: '600' },
  subtitle: { color: colors.textSecondary, fontSize: 15 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 15, paddingVertical: 7, backgroundColor: colors.surfaceAlt },
  chipText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  track: { backgroundColor: colors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.surface },
  rowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1 },
  rowTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  rowSub: { color: colors.textSecondary, fontSize: 13, marginTop: 3 },
  rowMeta: { color: colors.textSecondary, fontSize: 13, fontWeight: '600', maxWidth: 220, textAlign: 'right' },
  stats: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  stat: { minWidth: 150, paddingHorizontal: 18, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.surface },
  statValue: { fontSize: 24, fontWeight: '800' },
  statLabel: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  message: { color: colors.textMuted, fontSize: 15, paddingHorizontal: SIDE, paddingVertical: 24 },
  ncTitle: { color: colors.textPrimary, fontSize: 22, fontWeight: '700' },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 2,
    borderRadius: 10,
    color: colors.textPrimary,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  inputFocused: { borderColor: colors.textPrimary },
  toggle: { width: 46, height: 26, borderRadius: 13, backgroundColor: colors.surfaceAlt, padding: 3 },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.textPrimary },
  ncText: { color: colors.textSecondary, fontSize: 15, marginTop: 8, textAlign: 'center', maxWidth: 520 },
});
