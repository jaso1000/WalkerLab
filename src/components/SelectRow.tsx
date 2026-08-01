// Small shared settings-list row primitives: a tappable label+value row that
// opens a picker/screen (`SelectRow`), and a label+toggle row (`SwitchRow`).
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Switch, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme/colors';

// A row showing a label, the currently-selected value, and a chevron -
// tapping it hands off to `onPress` (typically opening a picker sheet or
// sub-screen). Purely presentational; selection state lives in the caller.
export function SelectRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.valueGroup}>
        <Text style={styles.value}>{value}</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
      </View>
    </TouchableOpacity>
  );
}

// A label + on/off toggle row. `tint` lets callers match the switch's "on"
// color to whatever service/section it belongs to (e.g. Sonarr blue on
// series-only screens) instead of always using the generic accent color.
export function SwitchRow({
  label,
  value,
  onChange,
  tint = colors.accent,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  tint?: string;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.surfaceAlt, true: `${tint}55` }}
        thumbColor={value ? tint : colors.textMuted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  label: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  // flexShrink + minWidth: 0 on both the group and the Text itself - needed
  // at both levels for a long value (e.g. a root folder path) to actually
  // shrink/wrap instead of overflowing past the row on web. See the same
  // fix in app/(drawer)/downloads.tsx for the full explanation of why
  // flexShrink alone isn't enough in real CSS flexbox.
  valueGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 },
  value: { color: colors.textSecondary, fontSize: 14, flexShrink: 1, minWidth: 0 },
});
