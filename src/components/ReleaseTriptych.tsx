// Shared three-column Theatrical/Digital/Physical release-date display for
// movie detail pages (Radarr's own detail page and Discover's) - Sonarr/TV
// has no equivalent since it only has per-episode air dates, not a release
// triptych.
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

// One column of the triptych (icon + label + date, or "Unknown" if the
// movie hasn't had that release type yet).
function ReleaseColumn({
  icon,
  label,
  value,
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tint: string;
}) {
  return (
    <View style={styles.col}>
      <Ionicons name={icon} size={20} color={tint} />
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export function ReleaseTriptych({
  theatrical,
  digital,
  physical,
  tint = colors.accent,
}: {
  theatrical?: string;
  digital?: string;
  physical?: string;
  tint?: string;
}) {
  return (
    <View style={styles.row}>
      <ReleaseColumn icon="film-outline" label="Theaters" value={theatrical ?? 'Unknown'} tint={tint} />
      <ReleaseColumn icon="cloud-outline" label="Digital" value={digital ?? 'Unknown'} tint={tint} />
      <ReleaseColumn icon="disc-outline" label="Physical" value={physical ?? 'Unknown'} tint={tint} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  col: { alignItems: 'center', gap: 4, flex: 1 },
  label: { color: colors.textSecondary, fontSize: 12 },
  value: { color: colors.textPrimary, fontSize: 13, fontWeight: '700' },
});
