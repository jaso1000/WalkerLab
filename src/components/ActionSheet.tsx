// Themed bottom-sheet action menu (tap-anywhere-to-open-actions pattern used
// by Overseerr requests, the profile switcher, etc) - a lighter-weight
// alternative to `PromptModal` for a simple list of tappable choices plus a
// Cancel button.
import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

export interface ActionSheetOption {
  label: string;
  destructive?: boolean;
  onPress: () => void;
  // Optional leading icon (e.g. the bottom-tab "More" sheet's per-section
  // rows) - every other existing call site omits these and is unaffected.
  icon?: keyof typeof Ionicons.glyphMap;
  tint?: string;
}

// Renders `options` as a bottom sheet under `title`; tapping the backdrop or
// Cancel calls `onClose` without running any option's `onPress`. Options
// styled `destructive: true` render in the danger color (e.g. "Delete").
export function ActionSheet({
  visible,
  title,
  options,
  onClose,
}: {
  visible: boolean;
  title: string;
  options: ActionSheetOption[];
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{title}</Text>
          {options.map((option) => (
            <Pressable
              key={option.label}
              style={[styles.option, styles.optionRow]}
              onPress={() => {
                onClose();
                option.onPress();
              }}
            >
              {option.icon ? (
                <Ionicons name={option.icon} size={18} color={option.tint ?? colors.textSecondary} />
              ) : null}
              <Text style={[styles.optionText, option.destructive && styles.optionTextDestructive]}>
                {option.label}
              </Text>
            </Pressable>
          ))}
          <Pressable style={[styles.option, styles.cancel]} onPress={onClose}>
            <Text style={styles.optionText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 8, paddingBottom: 24 },
  title: { color: colors.textSecondary, fontSize: 13, fontWeight: '700', padding: 14, letterSpacing: 0.5 },
  option: { paddingVertical: 14, paddingHorizontal: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  // Applied to every option row regardless of whether it has an icon - a
  // lone Text child in a row behaves identically to block layout, so this
  // is a no-op visually for existing icon-less callers.
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // flexShrink/minWidth: a long section name (renamed via Settings, no
  // length limit enforced there) next to a leading icon needs these to
  // wrap instead of overflow - see downloads.tsx's file-path overflow fix
  // earlier this session for the full explanation of why both are needed.
  optionText: { color: colors.textPrimary, fontSize: 16, fontWeight: '600', flexShrink: 1, minWidth: 0 },
  optionTextDestructive: { color: colors.danger },
  cancel: { marginTop: 4 },
});
