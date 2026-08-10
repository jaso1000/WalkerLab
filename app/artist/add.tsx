import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lidarrApi, lidarrImageUrl, LidarrArtist } from '../../src/api/lidarr';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { colors } from '../../src/theme/colors';

// Add Artist flow: Lidarr's own name search, then straight into the real
// Discover artist page (`app/discover/music/[name].tsx`) for anything not
// already in the library - that page has the bio/tags/similar-artists info
// plus its own inline "Add to Lidarr" form, so this screen doesn't need a
// second copy of that form; it's purely search-and-redirect.
export default function AddArtistScreen() {
  const tabBarClearance = useTabBarClearance();
  const { servers } = useServers();
  const config = servers.lidarr;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LidarrArtist[]>([]);
  const [searching, setSearching] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced Lidarr name search, same 350ms pattern as Add Series/Movie.
  const runSearch = useCallback(
    (text: string) => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
      if (!config || !text.trim()) {
        setResults([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      searchDebounce.current = setTimeout(() => {
        lidarrApi
          .searchArtists(config, text.trim())
          .then(setResults)
          .catch((e) => alert('Search failed', e instanceof Error ? e.message : 'Unknown error'))
          .finally(() => setSearching(false));
      }, 350);
    },
    [config]
  );

  const handleQueryChange = (text: string) => {
    setQuery(text);
    runSearch(text);
  };

  // Already-in-library results open the real artist detail page directly.
  // New results go to the Discover artist page instead of a local form.
  const openResult = (item: LidarrArtist) => {
    if (item.id) {
      router.push(`/artist/${item.id}`);
      return;
    }
    router.push(`/discover/music/${encodeURIComponent(item.artistName)}`);
  };

  if (!config) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyText}>Lidarr isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Add Artist</Text>
        <View style={{ width: 38 }} />
      </View>

      <View style={styles.searchRow}>
        <View style={styles.searchInputWrapper}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search for an artist"
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={handleQueryChange}
            returnKeyType="search"
            autoFocus
          />
          {query ? (
            <TouchableOpacity onPress={() => handleQueryChange('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <FlatList
        data={results}
        keyExtractor={(item, index) => `${item.artistName}-${index}`}
        contentContainerStyle={[styles.list, { paddingBottom: tabBarClearance }]}
        ListHeaderComponent={searching ? <ActivityIndicator color={colors.lidarr} style={{ marginBottom: 12 }} /> : null}
        renderItem={({ item }) => {
          const poster = item.images.find((i) => i.coverType === 'poster');
          const posterUrl = lidarrImageUrl(poster, config, { type: 'artist', id: item.id });
          const inLibrary = Boolean(item.id);
          return (
            <TouchableOpacity style={styles.resultRow} onPress={() => openResult(item)}>
              {posterUrl ? (
                <Image source={{ uri: posterUrl }} style={styles.resultPoster} cachePolicy="memory-disk" />
              ) : (
                <View style={[styles.resultPoster, styles.posterPlaceholder]} />
              )}
              <View style={styles.resultInfo}>
                <Text style={styles.resultTitle} numberOfLines={2}>
                  {item.artistName}
                </Text>
                {inLibrary ? <Text style={styles.resultMeta}>In Library</Text> : null}
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 8 },
  iconButton: { padding: 8, width: 38 },
  topBarTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 17 },
  searchRow: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  searchInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 24,
    paddingHorizontal: 16,
    height: 48,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 16 },
  list: { padding: 16, gap: 10 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 14, padding: 10, marginBottom: 10 },
  resultPoster: { width: 46, height: 69, borderRadius: 6, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  resultInfo: { flex: 1 },
  resultTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 14 },
  resultMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
});
