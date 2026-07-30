// Shared "Server" tab layout for Sonarr/Radarr (icon header, stat grid,
// grouped action rows) - each service screen supplies its own icon/tint/
// stats/actions but shares this same visual shell so the two look
// consistent despite having different underlying data.
import { Ionicons } from '@expo/vector-icons';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors } from '../theme/colors';

// One tappable action row (e.g. "Refresh All", "Search Missing").
export interface ServerAction {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}

export function ServerPanel({
  serviceIcon,
  title,
  version,
  stats,
  actionGroups,
  refreshing,
  onRefresh,
  tint = colors.accent,
}: {
  serviceIcon: keyof typeof Ionicons.glyphMap;
  title: string;
  version: string;
  stats: { label: string; value: string }[];
  // Groups of actions, each group rendered as its own card - lets callers
  // visually separate e.g. "library-wide" actions from "diagnostic" ones.
  actionGroups: ServerAction[][];
  refreshing: boolean;
  onRefresh: () => void;
  tint?: string;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      refreshControl={<RefreshControl tintColor={tint} refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Ionicons name={serviceIcon} size={56} color={tint} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.version}>{version ? `Version ${version}` : ' '}</Text>
      </View>

      <View style={styles.statsCard}>
        <View style={styles.statsRow}>
          {stats.map((stat, index) => (
            <View key={stat.label} style={[styles.statCol, index > 0 && styles.statColDivider]}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {actionGroups.map((group, groupIndex) => (
        <View key={groupIndex} style={styles.actionCard}>
          {group.map((action, index) => (
            <TouchableOpacity
              key={action.label}
              style={[styles.actionRow, index > 0 && styles.actionRowDivider]}
              onPress={action.onPress}
            >
              <Ionicons name={action.icon} size={18} color={tint} />
              <Text style={styles.actionLabel}>{action.label}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  header: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  title: { color: colors.textPrimary, fontSize: 24, fontWeight: '800' },
  version: { color: colors.textSecondary, fontSize: 13 },
  statsCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 14,
    padding: 16,
  },
  statsRow: { flexDirection: 'row' },
  statCol: { flex: 1, alignItems: 'center', gap: 2 },
  statColDivider: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
  statValue: { color: colors.textPrimary, fontSize: 18, fontWeight: '800' },
  statLabel: { color: colors.textSecondary, fontSize: 12 },
  actionCard: { backgroundColor: colors.surface, borderRadius: 14 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  actionRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  actionLabel: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
});
