// Shared bottom-sheet sort/group picker for TV Shows/Movies list screens -
// tapping a field toggles its sort direction if already active, or selects
// it ascending if not (see callers' `onSelect` handlers for that toggle
// logic - this component only reports which key was tapped).
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export interface SortField {
  key: string;
  label: string;
}

export function SortMenu({
  visible,
  fields,
  activeKey,
  activeAsc,
  defaultKey = null,
  groupHeaders,
  onSelect,
  onSetDefault,
  onToggleGroupHeaders,
  onClose,
}: {
  visible: boolean;
  fields: SortField[];
  activeKey: string;
  activeAsc: boolean;
  defaultKey?: string | null;
  // "Set as default" and "Group headers" are TV Shows/Movies-specific
  // (per-tab remembered sort + section grouping) - both optional so a
  // simpler screen (e.g. Containers, which just needs a plain sort picker)
  // can reuse this component without either row rendering at all.
  groupHeaders?: boolean;
  onSelect: (key: string) => void;
  onSetDefault?: () => void;
  onToggleGroupHeaders?: (value: boolean) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Sort By</Text>

          {fields.map((field) => {
            // Shows the current sort direction arrow only next to the
            // active field, and a "Default" pill on whichever field is the
            // remembered default for this tab (may differ from `activeKey`
            // if the user picked a one-off sort without saving it).
            const isActive = field.key === activeKey;
            const isDefault = field.key === defaultKey;
            return (
              <Pressable
                key={field.key}
                style={styles.row}
                onPress={() => {
                  onClose();
                  onSelect(field.key);
                }}
              >
                <Text style={styles.label}>{field.label}</Text>
                <View style={styles.rowRight}>
                  {isDefault ? (
                    <View style={styles.defaultPill}>
                      <Text style={styles.defaultPillText}>Default</Text>
                    </View>
                  ) : null}
                  {isActive ? (
                    <Ionicons name={activeAsc ? 'arrow-up' : 'arrow-down'} size={16} color={colors.accent} />
                  ) : null}
                </View>
              </Pressable>
            );
          })}

          {onSetDefault ? (
            <Pressable
              style={styles.linkRow}
              onPress={() => {
                onClose();
                onSetDefault();
              }}
            >
              <Text style={styles.linkText}>Set as default for this tab</Text>
            </Pressable>
          ) : null}

          {onToggleGroupHeaders ? (
            <View style={styles.toggleRow}>
              <Text style={styles.label}>Group headers</Text>
              <Switch
                value={!!groupHeaders}
                onValueChange={onToggleGroupHeaders}
                trackColor={{ false: colors.surfaceAlt, true: colors.accentMuted }}
                thumbColor={groupHeaders ? colors.accent : colors.textMuted}
              />
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 28 },
  title: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', paddingBottom: 8, letterSpacing: 0.5 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  label: { color: colors.textPrimary, fontSize: 16, fontWeight: '600' },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  defaultPill: { backgroundColor: colors.accentMuted, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  defaultPillText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
  linkRow: { paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  linkText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
