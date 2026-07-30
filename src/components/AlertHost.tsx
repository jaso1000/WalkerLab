// The single renderer for `src/lib/alert.ts`'s themed alert system - mount
// this once near the app root (see `app/_layout.tsx`) and every `alert()`
// call from anywhere in the app will show up here, styled to match the app
// instead of using the OS's native alert dialog.
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppAlertState, registerAlertListener } from '../lib/alert';
import { colors } from '../theme/colors';

export function AlertHost() {
  const [state, setState] = useState<AppAlertState | null>(null);

  // Registers itself as THE listener on mount, unregisters on unmount -
  // there should only ever be one `AlertHost` mounted at a time.
  useEffect(() => {
    registerAlertListener(setState);
    return () => registerAlertListener(null);
  }, []);

  if (!state) return null;

  // A plain horizontal row works fine for the common 1-2 button case, but
  // three buttons (e.g. Recreate's Cancel/Recreate/"Recreate + Pull Latest
  // Image") can't fit the longer labels on one line at the dialog's fixed
  // width - they'd overflow past its edges instead of wrapping. Stacking
  // vertically instead avoids that regardless of label length, matching
  // how native alert dialogs (e.g. iOS's own) handle 3+ options.
  const stacked = state.buttons.length > 2;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setState(null)}>
      <Pressable style={styles.backdrop} onPress={() => setState(null)}>
        <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
          <Text style={styles.title}>{state.title}</Text>
          {state.message ? <Text style={styles.message}>{state.message}</Text> : null}
          <View style={stacked ? styles.buttonColumn : styles.buttonRow}>
            {state.buttons.map((button, index) => (
              <Pressable
                key={index}
                style={styles.button}
                onPress={() => {
                  setState(null);
                  button.onPress?.();
                }}
              >
                <Text
                  style={[
                    styles.buttonText,
                    stacked && styles.buttonTextStacked,
                    button.style === 'cancel' && styles.buttonTextCancel,
                    button.style === 'destructive' && styles.buttonTextDestructive,
                  ]}
                >
                  {button.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: colors.surface, borderRadius: 14, padding: 20, width: '100%', maxWidth: 340 },
  title: { color: colors.textPrimary, fontSize: 17, fontWeight: '700' },
  message: { color: colors.textSecondary, fontSize: 14, marginTop: 8, lineHeight: 20 },
  buttonRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 20 },
  // Default `alignItems: 'stretch'` makes each button's Pressable fill the
  // dialog's full width, so its Text has real width to wrap within instead
  // of overflowing - `buttonTextStacked`'s `textAlign: 'right'` keeps the
  // same right-aligned look the row layout has.
  buttonColumn: { flexDirection: 'column', gap: 14, marginTop: 20 },
  button: { paddingVertical: 4 },
  buttonText: { color: colors.brand, fontSize: 14, fontWeight: '700' },
  buttonTextStacked: { textAlign: 'right' },
  buttonTextCancel: { color: colors.textSecondary },
  buttonTextDestructive: { color: colors.danger },
});
