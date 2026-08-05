// Web-only "change admin password" dialog, reached from Settings. Mirrors
// PromptModal.tsx's dialog styling, but needs three fields (current/new/
// confirm) rather than PromptModal's single-field shape, so it's its own
// small component instead of a chain of PromptModal prompts.
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { apiFetch } from '../lib/backendApi';
import { alert } from '../lib/alert';
import { colors } from '../theme/colors';

export function ChangePasswordModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
  };

  const close = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const submit = async () => {
    if (!currentPassword || newPassword.length < 8) {
      alert('Missing info', 'Enter your current password and a new password of at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      alert("Passwords don't match", 'Re-enter the new password to confirm it.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/api/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } });
      reset();
      onClose();
      alert('Password changed', 'Your admin password has been updated.');
    } catch (e) {
      alert('Failed to change password', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>Change Password</Text>
          <TextInput
            style={styles.input}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Current password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="off"
            autoFocus
          />
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="New password (min. 8 characters)"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="off"
          />
          <TextInput
            style={styles.input}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Confirm new password"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="off"
            onSubmitEditing={submit}
          />
          <View style={styles.buttonRow}>
            <Pressable onPress={close} disabled={submitting}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={submit} disabled={submitting}>
              {submitting ? <ActivityIndicator color={colors.brand} /> : <Text style={styles.confirmText}>Save</Text>}
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
    // 16px avoids iOS Safari's auto-zoom-on-focus for small inputs - see movies.tsx.
    fontSize: 16,
  },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, alignItems: 'center' },
  cancelText: { color: colors.textSecondary, fontSize: 14, fontWeight: '700' },
  confirmText: { color: colors.brand, fontSize: 14, fontWeight: '700' },
});
