// Web counterpart to `DateField.tsx` - see that file's header comment for
// why this needs to be a separate `.web.tsx` file rather than a runtime
// `Platform.OS` branch. The browser's own native `<input type="date">`
// gives a real calendar picker for free with zero extra dependency here.
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/colors';

// Renders as a raw DOM element rather than an RN component, so this
// deliberately steps around React Native's own JSX.IntrinsicElements
// typings (which don't include 'input') rather than fighting them - a
// standard, narrowly-scoped escape hatch for a web-only file.
const Input = 'input' as any;

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
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Input
        type="date"
        value={value ?? ''}
        min={minimumDate ? minimumDate.toISOString().slice(0, 10) : undefined}
        max={maximumDate ? maximumDate.toISOString().slice(0, 10) : undefined}
        onChange={(e: { target: { value: string } }) => onChange(e.target.value || undefined)}
        style={{
          backgroundColor: colors.surfaceAlt,
          color: colors.textPrimary,
          border: 'none',
          borderRadius: 10,
          padding: '10px 12px',
          fontSize: 14,
          fontFamily: 'inherit',
          width: '100%',
          // A raw `<input>`'s default min-content width can exceed its flex
          // parent's allocated share - the exact `min-width: auto` flex-
          // shrink pitfall this codebase already hit once with grid cards
          // (see movies.tsx et al.) and worked around with `minWidth: 0` up
          // the flex chain. `box-sizing` matters here too since `padding`
          // would otherwise add on top of the declared 100% width.
          minWidth: 0,
          boxSizing: 'border-box',
          colorScheme: 'dark',
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  field: { flex: 1, minWidth: 0 },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 4 },
});
