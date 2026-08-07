// Native (iOS/Android) date field for the Discover filter sheet's release-
// date range. Web has its own separate `DateField.web.tsx` - the native
// `@react-native-community/datetimepicker` package ships no web build at
// all (its `index.js` does a bare, non-platform-suffixed `import
// RNDateTimePicker from './datetimepicker'`, and there's no
// `datetimepicker.web.js`), so Metro fails to resolve it for a web bundle
// even inside a runtime `Platform.OS` check - that check happens too late,
// after static import resolution already failed. Splitting into a `.web.tsx`
// sibling file is the standard fix: Metro picks the right file per target
// platform, so the native-only package is never even referenced when
// building for web.
import { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import RNDateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { colors } from '../theme/colors';

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function DateField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
}: {
  label: string;
  value?: string; // ISO yyyy-mm-dd
  onChange: (value: string | undefined) => void;
  minimumDate?: Date;
  maximumDate?: Date;
}) {
  const [iosPickerOpen, setIosPickerOpen] = useState(false);
  const dateValue = value ? new Date(value) : new Date();

  // Android has no inline picker convention like iOS - the OS-level modal
  // dialog is opened imperatively and reports back via callback, matching
  // every other native Android date-picker integration.
  const openPicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: dateValue,
        mode: 'date',
        minimumDate,
        maximumDate,
        onChange: (event, date) => {
          if (event.type === 'set' && date) onChange(toIso(date));
        },
      });
    } else {
      setIosPickerOpen(true);
    }
  };

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.valueRow} onPress={openPicker}>
        <Text style={styles.value}>{value ?? 'Any'}</Text>
        {value ? (
          <Pressable hitSlop={8} onPress={() => onChange(undefined)}>
            <Text style={styles.clear}>Clear</Text>
          </Pressable>
        ) : null}
      </Pressable>
      {Platform.OS === 'ios' ? (
        <Modal visible={iosPickerOpen} transparent animationType="fade" onRequestClose={() => setIosPickerOpen(false)}>
          <Pressable style={styles.backdrop} onPress={() => setIosPickerOpen(false)}>
            <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
              <RNDateTimePicker
                value={dateValue}
                mode="date"
                display="inline"
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                onChange={(_event, date) => {
                  if (date) onChange(toIso(date));
                }}
              />
              <Pressable style={styles.doneButton} onPress={() => setIosPickerOpen(false)}>
                <Text style={styles.doneButtonText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1 },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 4 },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  value: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  clear: { color: colors.sectionGreen, fontSize: 12, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  sheet: { backgroundColor: colors.surface, borderRadius: 16, padding: 16 },
  doneButton: { marginTop: 12, alignItems: 'center', paddingVertical: 10 },
  doneButtonText: { color: colors.sectionGreen, fontWeight: '700', fontSize: 15 },
});
