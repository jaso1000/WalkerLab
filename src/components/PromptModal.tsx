// Themed single-text-field input dialog (rename profile, enter a backup
// passphrase, etc) - the app's equivalent of iOS's `Alert.prompt`, which
// has no Android/cross-platform built-in equivalent in React Native.
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme/colors';

export function PromptModal({
  visible,
  title,
  placeholder,
  initialValue = '',
  confirmLabel = 'Save',
  secureTextEntry = false,
  multiline = false,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  secureTextEntry?: boolean;
  multiline?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);

  // The modal doesn't unmount between opens, so reset the field each time
  // it's (re)shown rather than leaking the previous prompt's text into this one.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            style={[styles.input, multiline && styles.inputMultiline]}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.textMuted}
            secureTextEntry={secureTextEntry}
            autoCapitalize={secureTextEntry ? 'none' : 'words'}
            multiline={multiline}
            autoFocus
          />
          <View style={styles.buttonRow}>
            <Pressable onPress={onCancel}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => onConfirm(value)}>
              <Text style={styles.confirmText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: colors.surface, borderRadius: 14, padding: 20, width: '100%', maxWidth: 340, gap: 12 },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    backgroundColor: colors.surfaceAlt,
    color: colors.textPrimary,
  },
  inputMultiline: { minHeight: 100, textAlignVertical: 'top' },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20 },
  cancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  confirmText: { color: colors.brand, fontSize: 14, fontWeight: '700' },
});
