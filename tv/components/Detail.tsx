// Shared pieces of the TV Shows / Movies detail pages: a full-bleed backdrop faded into the
// background on the left and bottom (text stays readable over any artwork), the title block, and
// action buttons. Anything that removes files sits behind a menu and a confirm, never on a button.
// The top button row brings its page back to the top when focus lands on it (ButtonRow), so Up from
// the content below shows the title again in one press.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { MediaKind } from '../../src/lib/discoverCategories';
import { colors } from '../../src/theme/colors';
import { openInPlex, openInWholphin } from '../lib/openIn';
import { FocusCard } from './FocusCard';
import { ROW_SIDE_PADDING } from './Row';

export function Backdrop({ uri }: { uri?: string }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {uri ? <Image source={{ uri }} style={styles.backdrop} contentFit="cover" transition={250} /> : null}
      <LinearGradient
        colors={[colors.background, 'rgba(19,20,25,0.88)', 'rgba(19,20,25,0.25)', 'rgba(19,20,25,0)']}
        locations={[0, 0.3, 0.62, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(19,20,25,0)', 'rgba(19,20,25,0.6)', colors.background]}
        locations={[0.35, 0.65, 0.92]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

export function TitleBlock({ title, logo, meta, genres, overview }: { title: string; logo?: string; meta: (string | undefined | false)[]; genres?: string[]; overview?: string }) {
  const [logoFailed, setLogoFailed] = useState(false);
  return (
    <View style={styles.titleBlock}>
      {logo && !logoFailed ? (
        <Image source={{ uri: logo }} style={styles.logo} contentFit="contain" contentPosition="left" onError={() => setLogoFailed(true)} />
      ) : (
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
      )}
      <Text style={styles.meta}>{meta.filter(Boolean).join('   ·   ')}</Text>
      {genres && genres.length > 0 ? <Text style={styles.genres}>{genres.slice(0, 4).join('  /  ')}</Text> : null}
      {overview ? (
        <Text style={styles.overview} numberOfLines={4}>
          {overview}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A detail page's row of ActionButtons. Its large scrollSnapOffset makes a TV_LIST page glide all the
 * way back to the top (the snap target is clamped at 0) whenever one of its buttons takes focus, so the
 * title shows again in one press.
 */
export function ButtonRow({ style, children }: { style?: StyleProp<ViewStyle>; children: React.ReactNode }) {
  return (
    <View style={[detailStyles.buttons, style]} {...({ scrollSnapOffset: 5000 } as object)}>
      {children}
    </View>
  );
}

export function ActionButton({
  icon,
  label,
  tint,
  primary,
  onPress,
  preferredFocus,
  nextFocusDown,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tint: string;
  primary?: boolean;
  onPress: () => Promise<void> | void;
  preferredFocus?: boolean;
  nextFocusDown?: number;
}) {
  const [busy, setBusy] = useState(false);
  const fg = primary ? colors.background : colors.textPrimary;
  return (
    <FocusCard
      radius={10}
      scale={1.05}
      preferredFocus={preferredFocus}
      nextFocusDown={nextFocusDown}
      style={[styles.button, primary ? { backgroundColor: tint } : { backgroundColor: colors.surfaceAlt }]}
      onPress={async () => {
        if (busy) return;
        setBusy(true);
        try {
          await onPress();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <ActivityIndicator size="small" color={fg} /> : <Ionicons name={icon} size={18} color={primary ? fg : tint} />}
      <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
    </FocusCard>
  );
}

/** "Open in Wholphin" and "Open in Plex", for a title on a detail page (see tv/lib/openIn). */
export function OpenInButtons({
  title,
  year,
  kind,
  onError,
  nextFocusDown,
}: {
  title: string;
  year?: number;
  kind: MediaKind;
  onError: (message: string) => void;
  nextFocusDown?: number;
}) {
  const run = (fn: () => Promise<void>) => async () => {
    try {
      await fn();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not open the app');
    }
  };
  return (
    <>
      <ActionButton icon="play-circle-outline" label="Wholphin" tint="#AA5CC3" nextFocusDown={nextFocusDown} onPress={run(() => openInWholphin(title))} />
      <ActionButton icon="play-circle-outline" label="Plex" tint="#E5A00D" nextFocusDown={nextFocusDown} onPress={run(() => openInPlex(title, year, kind))} />
    </>
  );
}

/** One line of feedback under the buttons ("Search started"), cleared after a few seconds. */
export function useNotice() {
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const show = (text: string, error = false) => {
    setNotice({ text, error });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 5000);
  };
  const view = notice ? <Text style={[styles.notice, notice.error && { color: colors.danger }]}>{notice.text}</Text> : <Text style={styles.notice}> </Text>;
  return { show, view };
}

export const detailStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: ROW_SIDE_PADDING + 16, paddingTop: 70, paddingBottom: 40 },
  buttons: { flexDirection: 'row', gap: 14, marginTop: 22 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  error: { color: colors.danger, fontSize: 16, padding: 60 },
  sectionTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '700', marginTop: 26, marginBottom: 10 },
});

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  titleBlock: { maxWidth: 560 },
  logo: { width: 380, height: 110, marginBottom: 12 },
  title: { color: colors.textPrimary, fontSize: 40, fontWeight: '700', marginBottom: 10 },
  meta: { color: colors.textPrimary, fontSize: 15, fontWeight: '500' },
  genres: { color: colors.textSecondary, fontSize: 14, marginTop: 6 },
  overview: { color: colors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 14 },
  button: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 20, paddingVertical: 11 },
  buttonText: { fontSize: 15, fontWeight: '600' },
  notice: { color: colors.success, fontSize: 14, marginTop: 12 },
});
