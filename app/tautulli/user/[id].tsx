// Per-user watch history (Tautulli Users tab's "tap a user to see their
// history") - header with the user's name, then the same infinite-scroll
// history list the main Stats screen's History tab uses, filtered to this
// one user_id. Styled like `discover/person/[id].tsx`'s header/back-button
// shell.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TautulliHistoryItem, tautulliApi } from '../../../src/api/tautulli';
import { TautulliHistoryCard } from '../../../src/components/TautulliHistoryCard';
import { useServers } from '../../../src/context/ServersContext';
import { alert } from '../../../src/lib/alert';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

const PAGE_SIZE = 25;

export default function TautulliUserHistoryScreen() {
  const tabBarClearance = useTabBarClearance();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const userId = Number(id);
  const { servers } = useServers();
  const config = servers.tautulli;

  const [history, setHistory] = useState<TautulliHistoryItem[]>([]);
  const [start, setStart] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreLock = useRef(false);

  const load = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    try {
      const res = await tautulliApi.getHistory(config, { start: 0, length: PAGE_SIZE, userId });
      setHistory(res.data);
      setStart(res.data.length);
      setTotal(res.recordsFiltered);
    } catch (e) {
      alert('Failed to load history', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, userId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const loadMore = () => {
    if (!config || loadMoreLock.current || history.length >= total) return;
    loadMoreLock.current = true;
    setLoadingMore(true);
    tautulliApi
      .getHistory(config, { start, length: PAGE_SIZE, userId })
      .then((res) => {
        setHistory((prev) => [...prev, ...res.data]);
        setStart((s) => s + res.data.length);
        setTotal(res.recordsFiltered);
      })
      .finally(() => {
        setLoadingMore(false);
        loadMoreLock.current = false;
      });
  };

  if (!config) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyText}>Tautulli isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>
          {name ?? 'Watch History'}
        </Text>
        <View style={{ width: 38 }} />
      </View>

      {loading && history.length === 0 ? (
        <ActivityIndicator color={colors.tautulli} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={history}
          keyExtractor={(item) => String(item.row_id)}
          contentContainerStyle={[history.length === 0 ? styles.emptyContainer : styles.list, { paddingBottom: tabBarClearance }]}
          onEndReachedThreshold={0.5}
          onEndReached={loadMore}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.tautulli} style={{ marginVertical: 16 }} /> : null}
          ListEmptyComponent={<Text style={styles.emptyText}>No watch history yet.</Text>}
          renderItem={({ item }) => <TautulliHistoryCard item={item} config={config} />}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary, textAlign: 'center', marginTop: 40 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitle: { flex: 1, textAlign: 'center', color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  list: { padding: 16 },
});
