import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { HeaderTitle } from '../src/components/HeaderTitle';
import { ActionSheet, ActionSheetOption } from '../src/components/ActionSheet';
import { useProfiles } from '../src/context/ProfilesContext';
import { useSectionNames } from '../src/context/SectionNamesContext';
import { alert } from '../src/lib/alert';
import { SECTION_META } from '../src/lib/sectionMeta';
import { useTabBarClearance } from '../src/lib/tabBarClearance';
import { deleteWheel, getWheels, Wheel } from '../src/lib/wheels';
import { colors } from '../src/theme/colors';

// Spin's home screen - lists every saved wheel for the active profile, tap
// one to open it for spinning, "..." for Edit/Delete, "+ New Wheel" opens
// the builder with no wheelId. Reloads on every focus so a wheel just
// created/edited/spun (which can mutate item counts when "remove after
// landing" is on) in app/spin/builder.tsx or app/spin/[wheelId].tsx shows
// up fresh without a manual pull-to-refresh - same pattern every other
// list-of-user-records screen in this app already uses.
export default function SpinScreen() {
  const { names } = useSectionNames();
  const { activeProfileId } = useProfiles();
  const tabBarClearance = useTabBarClearance();

  const [wheels, setWheelsState] = useState<Wheel[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuFor, setMenuFor] = useState<Wheel | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getWheels(activeProfileId);
      setWheelsState(data);
    } catch (e) {
      alert('Failed to load wheels', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [activeProfileId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const confirmDeleteWheel = (wheel: Wheel) => {
    alert('Delete Wheel', `Delete "${wheel.name}"? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setWheelsState((prev) => prev.filter((w) => w.id !== wheel.id));
          try {
            await deleteWheel(activeProfileId, wheel.id);
          } catch (e) {
            alert('Failed to delete wheel', e instanceof Error ? e.message : 'Unknown error');
            load();
          }
        },
      },
    ]);
  };

  const openMenu = (wheel: Wheel) => setMenuFor(wheel);

  const menuOptions: ActionSheetOption[] = menuFor
    ? [
        { label: 'Edit', onPress: () => router.push({ pathname: '/spin/builder', params: { wheelId: menuFor.id } }) },
        { label: 'Delete', destructive: true, onPress: () => confirmDeleteWheel(menuFor) },
      ]
    : [];

  return (
    <View style={styles.screen}>
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackVisible: false,
          headerLeft: () => null,
          headerStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerTintColor: colors.textPrimary,
          headerTitleAlign: 'left',
          headerTitle: () => <HeaderTitle icon={SECTION_META.spin.icon} tint={SECTION_META.spin.tint} title={names.spin} />,
        }}
      />
      <FlatList
        data={wheels}
        keyExtractor={(w) => w.id}
        contentContainerStyle={[wheels.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: 100 + tabBarClearance }]}
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.empty}>No wheels yet - build one from your Movies or TV library.</Text>
          ) : null
        }
        renderItem={({ item }) => {
          const posters = item.items.filter((i) => i.posterUrl).slice(0, 4);
          return (
            <TouchableOpacity style={styles.card} onPress={() => router.push(`/spin/${item.id}`)}>
              <View style={styles.posterStack}>
                {posters.length > 0 ? (
                  posters.map((p, i) => (
                    <Image key={p.id} source={{ uri: p.posterUrl }} style={[styles.posterThumb, { left: i * 14 }]} cachePolicy="memory-disk" />
                  ))
                ) : (
                  <View style={[styles.posterThumb, styles.posterPlaceholder]}>
                    <Ionicons name={SECTION_META.spin.icon} size={20} color={colors.textMuted} />
                  </View>
                )}
              </View>
              <View style={styles.cardInfo}>
                <View style={styles.cardTitleRow}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.shared ? <Ionicons name="people" size={14} color={colors.textSecondary} /> : null}
                </View>
                <Text style={styles.cardSubtitle}>
                  {item.items.length} title{item.items.length === 1 ? '' : 's'}
                </Text>
              </View>
              <TouchableOpacity style={styles.menuButton} onPress={() => openMenu(item)}>
                <Ionicons name="ellipsis-vertical" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        }}
      />

      <View style={[styles.addBar, { bottom: 16 + tabBarClearance }]}>
        <TouchableOpacity style={styles.addButton} onPress={() => router.push('/spin/builder')}>
          <Ionicons name="add" size={22} color="#1A1300" />
          <Text style={styles.addButtonText}>New Wheel</Text>
        </TouchableOpacity>
      </View>

      {menuFor ? <ActionSheet visible title={menuFor.name} options={menuOptions} onClose={() => setMenuFor(null)} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, gap: 10 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', color: colors.textSecondary, paddingHorizontal: 32 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 12,
  },
  posterStack: { width: 82, height: 60, flexShrink: 0 },
  posterThumb: {
    position: 'absolute',
    width: 40,
    height: 60,
    borderRadius: 6,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  posterPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  cardInfo: { flex: 1, minWidth: 0 },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { color: colors.textPrimary, fontSize: 16, fontWeight: '700', flexShrink: 1, minWidth: 0 },
  cardSubtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 2 },
  menuButton: { padding: 6 },
  addBar: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.spin,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 28,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  addButtonText: { color: '#1A1300', fontWeight: '700', fontSize: 15 },
});
