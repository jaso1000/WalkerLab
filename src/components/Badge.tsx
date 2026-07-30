// Small colored status pill (e.g. series status, quality tags) - each
// `BadgeTone` maps to a muted background + matching foreground text color
// from the shared palette, so badges stay visually consistent everywhere
// they're used.
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export type BadgeTone = 'success' | 'accent' | 'danger' | 'info' | 'sonarr' | 'muted';

const TONE_STYLES: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: colors.successMuted, fg: colors.success },
  accent: { bg: colors.accentMuted, fg: colors.accent },
  danger: { bg: colors.dangerMuted, fg: colors.danger },
  info: { bg: colors.infoMuted, fg: colors.info },
  sonarr: { bg: colors.sonarrMuted, fg: colors.sonarr },
  muted: { bg: colors.surfaceAlt, fg: colors.textSecondary },
};

export function Badge({ label, tone }: { label: string; tone: BadgeTone }) {
  const { bg, fg } = TONE_STYLES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[styles.text, { color: fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginTop: 6 },
  text: { fontSize: 12, fontWeight: '600' },
});
