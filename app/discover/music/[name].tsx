import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { itunesApi } from '../../../src/api/itunes';
import { lastfmApi, LastfmArtistInfo, LastfmSimilarArtist, LastfmTrack, stripBioHtml } from '../../../src/api/lastfm';
import { lidarrApi, LidarrArtist, LidarrMetadataProfile, LidarrQualityProfile, LidarrRootFolder } from '../../../src/api/lidarr';
import { ActionSheet, ActionSheetOption } from '../../../src/components/ActionSheet';
import { ArtistRow } from '../../../src/components/ArtistRow';
import { SelectRow, SwitchRow } from '../../../src/components/SelectRow';
import { TagList } from '../../../src/components/TagList';
import { useServers } from '../../../src/context/ServersContext';
import { alert } from '../../../src/lib/alert';
import { LIDARR_MONITOR_OPTIONS, LidarrMonitorOption } from '../../../src/lib/constants';
import { capitalizeWords } from '../../../src/lib/format';
import { getLastQualityProfileId, setLastQualityProfileId } from '../../../src/lib/preferences';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

// Discover Music's artist detail page - Last.fm-backed bio/tags/similar
// artists/top tracks, with cover art from iTunes (Last.fm's own images are
// broken, see src/api/lastfm.ts). Keyed by artist *name*, not a numeric id -
// nothing has one until the artist is actually added to Lidarr. Has its own
// inline "Add to Lidarr" form (quality/metadata profile, root folder,
// monitor, search-on-add) for parity with the movie/TV Discover detail
// pages, rather than handing off to a separate screen - `app/artist/add.tsx`
// now redirects here for exactly this reason, so this is the one place
// that form exists.

function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={colors.sectionGreen} style={styles.infoIcon} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function DiscoverArtistScreen() {
  const tabBarClearance = useTabBarClearance();
  const { name } = useLocalSearchParams<{ name: string }>();
  const { servers } = useServers();
  const lastfmConfig = servers.lastfm;
  const lidarrConfig = servers.lidarr;

  const [artist, setArtist] = useState<LastfmArtistInfo | null>(null);
  const [similar, setSimilar] = useState<LastfmSimilarArtist[]>([]);
  const [tracks, setTracks] = useState<LastfmTrack[]>([]);
  const [artUrl, setArtUrl] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // Lidarr's own name lookup (`/artist/lookup`) doubles as both "is this
  // already in the library" (real `.id`) and "how do I add it"
  // (`.foreignArtistId`) - same result shape `app/artist/add.tsx`'s search
  // already relies on, just resolved fresh here by this page's own name
  // instead of whatever the user originally typed.
  const [lookupResult, setLookupResult] = useState<LidarrArtist | null>(null);
  const [checkingLibrary, setCheckingLibrary] = useState(false);

  const [profiles, setProfiles] = useState<LidarrQualityProfile[]>([]);
  const [metadataProfiles, setMetadataProfiles] = useState<LidarrMetadataProfile[]>([]);
  const [rootFolders, setRootFolders] = useState<LidarrRootFolder[]>([]);
  const [qualityProfileId, setQualityProfileId] = useState<number | null>(null);
  const [metadataProfileId, setMetadataProfileId] = useState<number | null>(null);
  const [rootFolderPath, setRootFolderPath] = useState<string | null>(null);
  const [monitorOption, setMonitorOption] = useState<LidarrMonitorOption>('all');
  const [searchOnAdd, setSearchOnAdd] = useState(true);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);

  const load = useCallback(async () => {
    if (!lastfmConfig || !name) return;
    setLoading(true);
    try {
      const [info, sim, top] = await Promise.all([
        lastfmApi.artistInfo(lastfmConfig, name),
        lastfmApi.similarArtists(lastfmConfig, name),
        lastfmApi.topTracks(lastfmConfig, name),
      ]);
      setArtist(info);
      setSimilar(sim);
      setTracks(top);
    } catch (e) {
      alert('Failed to load artist', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [lastfmConfig, name]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!name) return;
    itunesApi.searchArtistArtwork(name).then(setArtUrl).catch((e) => console.error('Failed to load artist artwork', e));
  }, [name]);

  useFocusEffect(
    useCallback(() => {
      if (!lidarrConfig || !name) {
        setLookupResult(null);
        return;
      }
      setCheckingLibrary(true);
      lidarrApi
        .searchArtists(lidarrConfig, name)
        .then((results) => {
          setLookupResult(results.find((a) => a.artistName.toLowerCase() === name.toLowerCase()) ?? results[0] ?? null);
        })
        .catch(() => setLookupResult(null))
        .finally(() => setCheckingLibrary(false));
    }, [lidarrConfig, name])
  );

  // Loads Lidarr's profile/root-folder options once, defaulting the
  // quality profile to whatever was last used for a Lidarr add, and the
  // metadata profile (a separate required field - see `lidarrApi.addArtist`'s
  // own comment) to the first one.
  useFocusEffect(
    useCallback(() => {
      if (!lidarrConfig) return;
      lidarrApi.getQualityProfiles(lidarrConfig).then(async (list) => {
        setProfiles(list);
        const remembered = await getLastQualityProfileId('lidarr');
        setQualityProfileId((prev) => prev ?? list.find((p) => p.id === remembered)?.id ?? list[0]?.id ?? null);
      });
      lidarrApi.getMetadataProfiles(lidarrConfig).then((list) => {
        setMetadataProfiles(list);
        setMetadataProfileId((prev) => prev ?? list[0]?.id ?? null);
      });
      lidarrApi.getRootFolders(lidarrConfig).then((list) => {
        setRootFolders(list);
        setRootFolderPath((prev) => prev ?? list[0]?.path ?? null);
      });
    }, [lidarrConfig])
  );

  const submit = async () => {
    if (!lidarrConfig || !lookupResult?.foreignArtistId || !qualityProfileId || !metadataProfileId || !rootFolderPath) return;
    setAdding(true);
    try {
      await lidarrApi.addArtist(lidarrConfig, {
        artistName: lookupResult.artistName,
        foreignArtistId: lookupResult.foreignArtistId,
        qualityProfileId,
        metadataProfileId,
        rootFolderPath,
        monitorOption,
        searchOnAdd,
      });
      await setLastQualityProfileId('lidarr', qualityProfileId);
      alert('Added', `${lookupResult.artistName} was added to Lidarr.`);
      router.back();
    } catch (e) {
      alert('Failed to add', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setAdding(false);
    }
  };

  if (!lastfmConfig) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyText}>Last.fm isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  if (loading || !artist) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.sectionGreen} />
      </SafeAreaView>
    );
  }

  const bio = artist.bio?.summary ? stripBioHtml(artist.bio.summary) : undefined;
  const tags = artist.tags?.tag?.map((t) => capitalizeWords(t.name)) ?? [];
  const listeners = artist.stats?.listeners ? Number(artist.stats.listeners).toLocaleString() : undefined;
  const playcount = artist.stats?.playcount ? Number(artist.stats.playcount).toLocaleString() : undefined;
  const similarItems = similar.map((a) => ({ name: a.name }));
  const inLibraryId = lookupResult?.id || undefined;

  const openSimilar = (item: { name: string }) => router.push(`/discover/music/${encodeURIComponent(item.name)}`);

  return (
    <View style={styles.screen}>
      <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: tabBarClearance }}>
        <View style={styles.hero}>
          {artUrl ? (
            <Image source={{ uri: artUrl }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          ) : null}
          <LinearGradient colors={['transparent', colors.background]} style={styles.heroGradient} />
          <SafeAreaView edges={['top']} style={styles.heroTopBar}>
            <TouchableOpacity style={styles.circleButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
          </SafeAreaView>
          <View style={styles.heroBottom}>
            <Text style={styles.title}>{artist.name}</Text>
            {listeners || playcount ? (
              <Text style={styles.meta}>
                {[listeners ? `${listeners} listeners` : null, playcount ? `${playcount} plays` : null].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.addSection}>
          {checkingLibrary ? (
            <ActivityIndicator color={colors.lidarr} style={{ marginTop: 12 }} />
          ) : inLibraryId ? (
            <TouchableOpacity style={[styles.addButton, { backgroundColor: colors.lidarr }]} onPress={() => router.push(`/artist/${inLibraryId}`)}>
              <Text style={styles.addButtonText}>Already in Library — View</Text>
            </TouchableOpacity>
          ) : !lidarrConfig ? (
            <Text style={styles.emptyText}>Connect Lidarr in Settings to add this artist.</Text>
          ) : !lookupResult?.foreignArtistId ? (
            <Text style={styles.emptyText}>This artist couldn&apos;t be matched in Lidarr&apos;s own catalog, so it can&apos;t be added automatically.</Text>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Add to Lidarr</Text>
              <View style={styles.formCard}>
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
                  label="Metadata Profile"
                  value={metadataProfiles.find((p) => p.id === metadataProfileId)?.name ?? 'Select'}
                  onPress={() =>
                    setMenu({
                      title: 'Metadata Profile',
                      options: metadataProfiles.map((p) => ({ label: p.name, onPress: () => setMetadataProfileId(p.id) })),
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
                style={[
                  styles.addButton,
                  { backgroundColor: colors.lidarr },
                  (adding || !qualityProfileId || !metadataProfileId || !rootFolderPath) && styles.addButtonDisabled,
                ]}
                onPress={submit}
                disabled={adding || !qualityProfileId || !metadataProfileId || !rootFolderPath}
              >
                <Text style={styles.addButtonText}>{adding ? 'Adding…' : 'Add Artist'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>

        {bio ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>About</Text>
            <Text style={styles.bio}>{bio}</Text>
          </View>
        ) : null}

        <TagList tags={tags} tint={colors.sectionGreen} />

        <ArtistRow title="Similar Artists" items={similarItems} onPressItem={openSimilar} tint={colors.sectionGreen} />

        {tracks.length > 0 ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Top Tracks</Text>
            {tracks.map((track, i) => (
              <InfoRow key={`${track.name}-${i}`} icon="musical-note-outline" label={track.name} value={track.listeners ? `${Number(track.listeners).toLocaleString()} listeners` : undefined} />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ActionSheet visible={!!menu} title={menu?.title ?? ''} options={menu?.options ?? []} onClose={() => setMenu(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: colors.textSecondary, textAlign: 'center' },
  hero: { minHeight: 220, justifyContent: 'flex-end', backgroundColor: colors.surfaceAlt },
  heroGradient: { ...StyleSheet.absoluteFill },
  heroTopBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 4 },
  circleButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBottom: { padding: 16, gap: 4 },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '800' },
  meta: { color: colors.textSecondary, fontSize: 13 },
  addSection: { padding: 16, gap: 10 },
  addButton: { borderRadius: 10, padding: 14, alignItems: 'center' },
  addButtonDisabled: { opacity: 0.5 },
  addButtonText: { fontWeight: '800', fontSize: 16, color: colors.background },
  formCard: { backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 16 },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, margin: 16, marginTop: 14, gap: 8 },
  sectionTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  bio: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  infoIcon: { marginRight: 10 },
  infoLabel: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  infoValue: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
});
