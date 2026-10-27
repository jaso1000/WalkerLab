// A titled horizontal row of cards. A plain ScrollView rather than a FlatList: rows hold at most a
// few dozen cards, and every card stays mounted, so D-pad focus can always reach the next one (a
// virtualized list can unmount the card focus is about to move to, and the remote stops at the
// edge). Scrolling is react-native-tvos's item snapping (TV_LIST, see ui.tsx): each card sits in a
// SNAP_START wrapper, so the focused card glides to the row's start (just inside the side padding), and
// the Row itself is SNAP_START, so a page of rows glides the focused row, title and all, to the top.
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SNAP_START, TV_LIST } from './ui';
import { colors } from '../../src/theme/colors';

interface Props {
  title: string;
  accent: string;
  count?: number;
  empty?: string;
  error?: string;
  children: React.ReactNode;
}

export const ROW_SIDE_PADDING = 40;

export function Row({ title, accent, count, empty, error, children }: Props) {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <View style={styles.row} {...SNAP_START}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {count != null && count > 0 && <Text style={[styles.count, { color: accent }]}>{count}</Text>}
      </View>
      {hasChildren ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          {...TV_LIST}
          {...({ snapToItemPadding: ROW_SIDE_PADDING } as object)}
          contentContainerStyle={styles.content}
          style={styles.scroller}
        >
          {React.Children.map(children, (child) => (
            <View {...SNAP_START}>{child}</View>
          ))}
        </ScrollView>
      ) : (
        <Text style={[styles.empty, error && { color: colors.danger }]}>{error ?? empty ?? 'Nothing here'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: ROW_SIDE_PADDING, marginBottom: 8 },
  // Discover's section title, at TV size; `accent` tints the count, the row's one touch of colour.
  title: { color: colors.textPrimary, fontSize: 20, fontWeight: '700' },
  count: { fontSize: 15, fontWeight: '600', marginLeft: 10 },
  // Vertical padding leaves room for the focused card's scale and outline.
  scroller: { overflow: 'visible' },
  content: { paddingHorizontal: ROW_SIDE_PADDING, paddingVertical: 10, gap: 18 },
  empty: { color: colors.textMuted, fontSize: 14, paddingHorizontal: ROW_SIDE_PADDING, paddingVertical: 12 },
});
