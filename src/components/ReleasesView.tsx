// Shared interactive release-search screen for Sonarr/Radarr - lists
// results from `getReleases`, lets the user filter by title client-side,
// and grabs whichever release they tap via `onGrab`. Used at every
// drill-down level (series/season/episode for Sonarr, movie for Radarr).
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ArrRelease } from '../api/types';
import { alert } from '../lib/alert';
import { formatBytes } from '../lib/format';
import { useTabBarClearance } from '../lib/tabBarClearance';
import { colors } from '../theme/colors';

export function ReleasesView({
  title,
  releases,
  loading,
  grabbingGuid,
  onGrab,
  onClose,
  tint = colors.accent,
  tintMuted = colors.accentMuted,
}: {
  title: string;
  releases: ArrRelease[];
  loading: boolean;
  grabbingGuid: string | null;
  onGrab: (release: ArrRelease) => void;
  onClose: () => void;
  tint?: string;
  tintMuted?: string;
}) {
  const [query, setQuery] = useState('');
  const tabBarClearance = useTabBarClearance();

  // Client-side title filter over the already-fetched release list - the
  // Sonarr/Radarr release-search endpoints have no server-side text filter
  // of their own.
  const visible = useMemo(() => {
    if (!query.trim()) return releases;
    const q = query.toLowerCase();
    return releases.filter((r) => r.title.toLowerCase().includes(q));
  }, [releases, query]);

  // A rejected release doesn't mean it can't be grabbed - the quality
  // profile just wouldn't have picked it automatically - so tapping one
  // surfaces why it was rejected first, rather than silently either
  // blocking the grab or attempting it with no explanation. "Grab Anyway"
  // proceeds into the screen's own existing grab-confirmation flow.
  const handlePress = (item: ArrRelease) => {
    if (!item.rejected) {
      onGrab(item);
      return;
    }
    const reasons = item.rejections?.length ? item.rejections.map((r) => `• ${r}`).join('\n') : 'No reason given.';
    alert('Release Rejected', reasons, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Grab Anyway', onPress: () => onGrab(item) },
    ]);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Ionicons name="close" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Releases ({releases.length})</Text>
      </View>
      <Text style={styles.subtitle} numberOfLines={2}>
        {title}
      </Text>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={16} color={colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search releases"
          placeholderTextColor={colors.textMuted}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {loading ? (
        <ActivityIndicator color={tint} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.guid}
          contentContainerStyle={[styles.list, { paddingBottom: tabBarClearance }]}
          ListEmptyComponent={<Text style={styles.empty}>No releases found.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.row}
              disabled={!!grabbingGuid}
              onPress={() => handlePress(item)}
            >
              <Text style={styles.rowTitle} numberOfLines={2}>
                {item.title}
              </Text>
              <View style={styles.rowMeta}>
                {item.rejected ? <Ionicons name="alert-circle" size={16} color={colors.danger} /> : null}
                <View style={[styles.qualityPill, { backgroundColor: tintMuted }]}>
                  <Text style={[styles.qualityPillText, { color: tint }]}>{item.quality.quality.name}</Text>
                </View>
                <Text style={styles.metaText}>{formatBytes(item.size)}</Text>
                <Text style={styles.metaText}>· {Math.round(item.age)}d</Text>
                <Text style={[styles.metaTextAccent, { color: tint }]}>· {item.indexer}</Text>
              </View>
              {grabbingGuid === item.guid ? <ActivityIndicator color={tint} style={{ marginTop: 8 }} /> : null}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { color: colors.textPrimary, fontSize: 20, fontWeight: '800' },
  subtitle: { color: colors.textSecondary, paddingHorizontal: 16, marginTop: 4 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderRadius: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
  },
  // 16px avoids iOS Safari's auto-zoom-on-focus for small inputs - see movies.tsx.
  searchInput: { flex: 1, color: colors.textPrimary, paddingVertical: 10, fontSize: 16 },
  list: { padding: 16, gap: 10 },
  row: { backgroundColor: colors.surface, borderRadius: 12, padding: 12 },
  rowTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' },
  qualityPill: { backgroundColor: colors.accentMuted, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  qualityPillText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  metaText: { color: colors.textSecondary, fontSize: 12 },
  metaTextAccent: { color: colors.accent, fontSize: 12, fontWeight: '600' },
  empty: { color: colors.textSecondary, textAlign: 'center', marginTop: 24 },
});
