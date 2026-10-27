// The TV's renderer for src/lib/alert - the phone's AlertHost, with buttons the D-pad can reach and
// see. Every shared confirm flow (remove from library, recreate container, remove from queue...) calls
// `alert(title, message, buttons)` and lands here, so it behaves on the TV exactly as on the phone.
// Also the TV's action menu: a list of options is just an alert with more buttons (stacked).
import { useEffect, useState } from 'react';
import { BackHandler, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppAlertState, registerAlertListener } from '../../src/lib/alert';
import { colors } from '../../src/theme/colors';
import { FocusCard } from './FocusCard';
import { TV_LIST } from './ui';

export function TvAlertHost() {
  const [state, setState] = useState<AppAlertState | null>(null);

  useEffect(() => {
    registerAlertListener(setState);
    return () => registerAlertListener(null);
  }, []);

  useEffect(() => {
    if (!state) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setState(null);
      return true;
    });
    return () => sub.remove();
  }, [state]);

  if (!state) return null;
  const stacked = state.buttons.length > 2;
  // Focus starts on the first non-cancel button for a plain confirm, and on the first option in a menu.
  const preferred = stacked ? 0 : Math.max(0, state.buttons.findIndex((b) => b.style !== 'cancel'));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setState(null)}>
      <View style={styles.backdrop}>
        <View style={[styles.dialog, stacked && styles.dialogWide]}>
          <Text style={styles.title}>{state.title}</Text>
          {state.message ? <Text style={styles.message}>{state.message}</Text> : null}
          {/* A ScrollView clips its content: the padding inside it (offset by the negative margin) leaves room
              for the focused button's scale and outline. */}
          <ScrollView {...TV_LIST} style={styles.buttons} contentContainerStyle={stacked ? styles.column : styles.row}>
            {state.buttons.map((button, index) => (
              <FocusCard
                key={index}
                radius={10}
                scale={1.04}
                preferredFocus={index === preferred}
                style={[styles.button, stacked && styles.buttonStacked, button.style === 'destructive' && styles.buttonDanger]}
                onPress={() => {
                  setState(null);
                  button.onPress?.();
                }}
              >
                <Text
                  style={[
                    styles.buttonText,
                    button.style === 'cancel' && { color: colors.textSecondary },
                    button.style === 'destructive' && { color: colors.danger },
                  ]}
                >
                  {button.text}
                </Text>
              </FocusCard>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  dialog: { backgroundColor: colors.surface, borderRadius: 16, padding: 26, width: 460, borderWidth: 1, borderColor: colors.border },
  dialogWide: { width: 420 },
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  message: { color: colors.textSecondary, fontSize: 15, marginTop: 10, lineHeight: 22 },
  buttons: { maxHeight: 372, marginHorizontal: -10, marginBottom: -8 },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 14, marginTop: 14, padding: 10 },
  column: { gap: 10, marginTop: 12, padding: 10 },
  button: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.surfaceAlt, alignItems: 'center' },
  buttonStacked: { alignItems: 'flex-start', paddingVertical: 12 },
  buttonDanger: { backgroundColor: colors.dangerMuted },
  buttonText: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
});
