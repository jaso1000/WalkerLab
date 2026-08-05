// Settings > Navigation: reorder which sections are primary bottom-bar/
// sidebar icons vs tucked into the "More" overflow - used by both the
// phone-width floating pill and the tablet-width persistent sidebar (see
// src/components/AdaptiveNav.tsx and src/lib/tabOrder.ts). Deliberately
// uses up/down buttons rather than drag-and-drop - no such dependency
// exists in this app today, and this achieves the same reordering outcome
// with far less risk (this session hit several real gesture-conflict bugs
// elsewhere).
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfiles } from '../../src/context/ProfilesContext';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { useServiceEnabled } from '../../src/context/ServiceEnabledContext';
import { SECTION_META } from '../../src/lib/sectionMeta';
import { sectionEnabled } from '../../src/lib/serviceMeta';
import { StartupSectionId } from '../../src/lib/startupScreen';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { DEFAULT_TAB_ORDER, getTabOrder, PRIMARY_TAB_COUNT, setTabOrder } from '../../src/lib/tabOrder';
import { colors } from '../../src/theme/colors';

export default function NavigationSettingsScreen() {
  const { activeProfileId } = useProfiles();
  const { isEnabled } = useServiceEnabled();
  const { names } = useSectionNames();
  const tabBarClearance = useTabBarClearance();
  const [order, setOrder] = useState<StartupSectionId[]>(DEFAULT_TAB_ORDER);

  // Re-reads on every focus, matching [service].tsx's own startup-screen
  // pattern - reflects a change made elsewhere immediately on return here.
  useFocusEffect(
    useCallback(() => {
      getTabOrder(activeProfileId).then(setOrder);
    }, [activeProfileId])
  );

  const moveItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target], next[index]];
    setOrder(next);
    setTabOrder(activeProfileId, next);
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.topBarTitleRow}>
          <Ionicons name="swap-horizontal-outline" size={18} color={colors.brand} />
          <Text style={styles.topBarTitle}>Navigation</Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: tabBarClearance }]}>
        <View style={styles.card}>
          <Text style={styles.sectionLabel}>SECTION ORDER</Text>
          <Text style={styles.hint}>
            The first {PRIMARY_TAB_COUNT} shown below are the primary icons - the rest live in the "More" menu. On a
            tablet-width screen these appear in an always-visible side panel instead of a bottom bar.
          </Text>
          {order.map((id, index) => {
            const enabled = sectionEnabled(id, isEnabled);
            const meta = SECTION_META[id];
            return (
              <View key={id}>
                {index === 0 ? <Text style={styles.dividerLabel}>PRIMARY</Text> : null}
                {index === PRIMARY_TAB_COUNT ? <Text style={styles.dividerLabel}>MORE MENU</Text> : null}
                <View style={styles.orderRow}>
                  <Ionicons name={meta.icon} size={18} color={enabled ? meta.tint : colors.textMuted} />
                  <Text style={[styles.orderRowLabel, !enabled && styles.orderRowLabelDisabled]} numberOfLines={1}>
                    {names[id]}
                  </Text>
                  <View style={styles.orderButtons}>
                    <TouchableOpacity
                      style={styles.orderButton}
                      disabled={index === 0}
                      onPress={() => moveItem(index, -1)}
                    >
                      <Ionicons name="chevron-up" size={20} color={index === 0 ? colors.textMuted : colors.textPrimary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.orderButton}
                      disabled={index === order.length - 1}
                      onPress={() => moveItem(index, 1)}
                    >
                      <Ionicons
                        name="chevron-down"
                        size={20}
                        color={index === order.length - 1 ? colors.textMuted : colors.textPrimary}
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  topBarTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  container: { padding: 16, gap: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, gap: 4 },
  sectionLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 8 },
  hint: { color: colors.textMuted, fontSize: 12, lineHeight: 16, marginTop: 8 },
  dividerLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginTop: 12, marginBottom: 4 },
  orderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  orderRowLabel: { flex: 1, color: colors.textPrimary, fontSize: 15, fontWeight: '600', flexShrink: 1, minWidth: 0 },
  orderRowLabelDisabled: { color: colors.textMuted },
  orderButtons: { flexDirection: 'row', gap: 4 },
  orderButton: { padding: 4 },
});
