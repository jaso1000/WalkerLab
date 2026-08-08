import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lidarrApi, lidarrImageUrl, LidarrArtist, LidarrQualityProfile, LidarrRootFolder } from '../../src/api/lidarr';
import { ActionSheet, ActionSheetOption } from '../../src/components/ActionSheet';
import { SelectRow, SwitchRow } from '../../src/components/SelectRow';
import { useServers } from '../../src/context/ServersContext';
import { alert } from '../../src/lib/alert';
import { LIDARR_MONITOR_OPTIONS, LidarrMonitorOption } from '../../src/lib/constants';
import { getLastQualityProfileId, setLastQualityProfileId } from '../../src/lib/preferences';
import { useTabBarClearance } from '../../src/lib/tabBarClearance';
import { colors } from '../../src/theme/colors';

// Add Artist flow: Lidarr's own name search, then this screen's own
// lightweight config form. Simpler than `series/add.tsx` - there's no
// Discover/TMDB surface for music to resolve into, so an already-searched
// result either opens the real artist detail page or goes straight to the
// config form, no intermediate resolve step.
export default function AddArtistScreen() {
  const tabBarClearance = useTabBarClearance();
  const { servers } = useServers();
  const config = servers.lidarr;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LidarrArtist[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<LidarrArtist | null>(null);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [profiles, setProfiles] = useState<LidarrQualityProfile[]>([]);
  const [rootFolders, setRootFolders] = useState<LidarrRootFolder[]>([]);
  const [qualityProfileId, setQualityProfileId] = useState<number | null>(null);
  const [rootFolderPath, setRootFolderPath] = useState<string | null>(null);
  const [monitorOption, setMonitorOption] = useState<LidarrMonitorOption>('all');
  const [searchOnAdd, setSearchOnAdd] = useState(true);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);

  // Loads Lidarr's profile/root-folder options once, defaulting the
  // quality profile to whatever was last used for a Lidarr add.
  useFocusEffect(
    useCallback(() => {
      if (!config) return;
      lidarrApi.getQualityProfiles(config).then(async (list) => {
        setProfiles(list);
        const remembered = await getLastQualityProfileId('lidarr');
        setQualityProfileId((prev) => prev ?? list.find((p) => p.id === remembered)?.id ?? list[0]?.id ?? null);
      });
      lidarrApi.getRootFolders(config).then((list) => {
        setRootFolders(list);
        setRootFolderPath((prev) => prev ?? list[0]?.path ?? null);
      });
    }, [config])
  );

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

  // Already-in-library results just open the real artist detail page. New
  // results show this screen's own config form.
  const openResult = (item: LidarrArtist) => {
    if (item.id) {
      router.push(`/artist/${item.id}`);
      return;
    }
    setSelected(item);
  };

  // Adds the selected artist using this form's own config fields,
  // remembers the chosen quality profile for next time, and returns on
  // success.
  const submit = async () => {
    if (!config || !selected || !qualityProfileId || !rootFolderPath || !selected.foreignArtistId) return;
    setAdding(true);
    try {
      await lidarrApi.addArtist(config, {
        artistName: selected.artistName,
        foreignArtistId: selected.foreignArtistId,
        qualityProfileId,
        rootFolderPath,
        monitorOption,
        searchOnAdd,
      });
      await setLastQualityProfileId('lidarr', qualityProfileId);
      alert('Added', `${selected.artistName} was added to Lidarr.`);
      router.back();
    } catch (e) {
      alert('Failed to add', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAdding(false);
    }
  };

  if (!config) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyText}>Lidarr isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  if (selected) {
    const poster = selected.images.find((i) => i.coverType === 'poster');
    const posterUrl = lidarrImageUrl(poster, config, { type: 'artist', id: selected.id });
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.iconButton} onPress={() => setSelected(null)}>
            <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.topBarTitle}>Add Artist</Text>
          <View style={{ width: 38 }} />
        </View>
        <ScrollView contentContainerStyle={[styles.configContainer, { paddingBottom: tabBarClearance }]}>
          <View style={styles.configHeader}>
            {posterUrl ? (
              <Image source={{ uri: posterUrl }} style={styles.poster} cachePolicy="memory-disk" />
            ) : (
              <View style={[styles.poster, styles.posterPlaceholder]} />
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.configTitle}>{selected.artistName}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <SelectRow
              label="Quality Profile"
              value={profiles.find((p) => p.id === qualityProfileId)?.name ?? 'Select'}
              onPress={() =>
                setMenu({
                  title: 'Quality Profile',
                  options: profiles.map((p) => ({ label: p.name, onPress: () => setQualityProfileId(p.id) })),
                })
              }
            />
            <SelectRow
              label="Root Folder"
              value={rootFolderPath ?? 'Select'}
              onPress={() =>
                setMenu({
                  title: 'Root Folder',
                  options: rootFolders.map((f) => ({ label: f.path, onPress: () => setRootFolderPath(f.path) })),
                })
              }
            />
            <SelectRow
              label="Monitor"
              value={LIDARR_MONITOR_OPTIONS.find((o) => o.value === monitorOption)?.label ?? 'All Albums'}
              onPress={() =>
                setMenu({
                  title: 'Monitor',
                  options: LIDARR_MONITOR_OPTIONS.map((o) => ({ label: o.label, onPress: () => setMonitorOption(o.value) })),
                })
              }
            />
            <SwitchRow label="Search on Add" value={searchOnAdd} onChange={setSearchOnAdd} tint={colors.lidarr} />
          </View>

          <TouchableOpacity
            style={[styles.addButton, (adding || !qualityProfileId || !rootFolderPath) && styles.addButtonDisabled]}
            onPress={submit}
            disabled={adding || !qualityProfileId || !rootFolderPath}
          >
            <Text style={styles.addButtonText}>{adding ? 'Adding…' : 'Add Artist'}</Text>
          </TouchableOpacity>
        </ScrollView>

        <ActionSheet
          visible={!!menu}
          title={menu?.title ?? ''}
          options={menu?.options ?? []}
          onClose={() => setMenu(null)}
        />
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
  configContainer: { padding: 16, gap: 14 },
  configHeader: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  poster: { width: 70, height: 105, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  configTitle: { color: colors.textPrimary, fontWeight: '800', fontSize: 18 },
  card: { backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 16 },
  addButton: { backgroundColor: colors.lidarr, borderRadius: 10, padding: 14, alignItems: 'center' },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: { color: colors.textPrimary, fontWeight: '800', fontSize: 16 },
});
