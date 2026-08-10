import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, ImageBackground, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lidarrApi, lidarrImageUrl, LidarrAlbum, LidarrArtist, LidarrQualityProfile } from '../../../src/api/lidarr';
import { ActionSheet, ActionSheetOption } from '../../../src/components/ActionSheet';
import { Badge } from '../../../src/components/Badge';
import { RatingBadges } from '../../../src/components/RatingBadges';
import { TagList } from '../../../src/components/TagList';
import { useServers } from '../../../src/context/ServersContext';
import { alert } from '../../../src/lib/alert';
import { artistStatusTone, formatBytes, formatDate, titleCase } from '../../../src/lib/format';
import { useTabBarClearance } from '../../../src/lib/tabBarClearance';
import { colors } from '../../../src/theme/colors';

// Lidarr's own artist detail page (as opposed to a Discover browse/add
// page - there's no TMDB/OMDb equivalent for music in this app). Hero
// backdrop, quick-action chips, an album list (each row opening the
// album/track drill-down), overview, and genre tags, all backed by a live
// Lidarr fetch - simpler than `series/[id]/index.tsx` by design, since
// there's no cast/crew, extra ratings, or keyword source to layer on top.

function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string | number }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={colors.lidarr} style={styles.infoIcon} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function ArtistDetailScreen() {
  const tabBarClearance = useTabBarClearance();
  const { id } = useLocalSearchParams<{ id: string }>();
  const artistId = Number(id);
  const { servers } = useServers();
  const config = servers.lidarr;

  const [artist, setArtist] = useState<LidarrArtist | null>(null);
  const [albums, setAlbums] = useState<LidarrAlbum[]>([]);
  const [profiles, setProfiles] = useState<LidarrQualityProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<{ title: string; options: ActionSheetOption[] } | null>(null);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);

  const load = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    try {
      const [a, albumList, profileList] = await Promise.all([
        lidarrApi.getArtistById(config, artistId),
        lidarrApi.getAlbums(config, artistId),
        lidarrApi.getQualityProfiles(config),
      ]);
      setArtist(a);
      setAlbums(albumList);
      setProfiles(profileList);
    } catch (e) {
      alert('Failed to load artist', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, artistId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const toggleArtistMonitored = async () => {
    if (!config || !artist) return;
    const updated = { ...artist, monitored: !artist.monitored };
    setArtist(updated);
    try {
      await lidarrApi.updateArtist(config, updated);
    } catch (e) {
      setArtist(artist);
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const setQualityProfile = async (qualityProfileId: number) => {
    if (!config || !artist) return;
    const updated = { ...artist, qualityProfileId };
    setArtist(updated);
    try {
      await lidarrApi.updateArtist(config, updated);
    } catch (e) {
      setArtist(artist);
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const toggleAlbumMonitored = async (album: LidarrAlbum) => {
    if (!config) return;
    setAlbums((prev) => prev.map((a) => (a.id === album.id ? { ...a, monitored: !a.monitored } : a)));
    try {
      await lidarrApi.updateAlbumsMonitored(config, [album.id], !album.monitored);
    } catch (e) {
      setAlbums((prev) => prev.map((a) => (a.id === album.id ? { ...a, monitored: album.monitored } : a)));
      alert('Failed to update', e instanceof Error ? e.message : 'Unknown error');
    }
  };

  const searchAlbum = async (album: LidarrAlbum) => {
    if (!config) return;
    setBusy(true);
    try {
      await lidarrApi.searchAlbumRelease(config, album.id);
      alert('Search started', `Searching for ${album.title}.`);
    } catch (e) {
      alert('Search failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const searchWholeArtist = async () => {
    if (!config || !artist) return;
    setBusy(true);
    try {
      await lidarrApi.searchArtistRelease(config, artist.id);
      alert('Search started', `Searching for all of ${artist.artistName}.`);
    } catch (e) {
      alert('Search failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const openAlbumMenu = (album: LidarrAlbum) => {
    setMenu({
      title: album.title,
      options: [
        { label: 'Automatic album search', onPress: () => searchAlbum(album) },
        {
          label: 'Manual album search',
          onPress: () =>
            router.push(`/artist/${artistId}/releases?albumId=${album.id}&title=${encodeURIComponent(`${artist?.artistName ?? ''} · ${album.title}`)}`),
        },
        { label: album.monitored ? 'Stop monitoring' : 'Start monitoring', onPress: () => toggleAlbumMonitored(album) },
      ],
    });
  };

  const openArtistMenu = () => {
    if (!artist) return;
    setMenu({
      title: artist.artistName,
      options: [
        { label: 'Automatic artist search', onPress: searchWholeArtist },
        {
          label: 'Manual artist search',
          onPress: () => router.push(`/artist/${artistId}/releases?title=${encodeURIComponent(artist.artistName)}`),
        },
        { label: 'Remove from Library', destructive: true, onPress: removeFromLibrary },
        {
          label: artist.monitored ? 'Stop monitoring artist' : 'Start monitoring artist',
          onPress: toggleArtistMonitored,
        },
      ],
    });
  };

  // 2-way "Remove from Library" prompt (no "delete files too" split like
  // the series detail page - Lidarr's own deleteArtist already accepts a
  // deleteFiles flag directly, no need for a separate bulk track-file
  // delete call first).
  const removeFromLibrary = () => {
    if (!config || !artist) return;
    alert('Remove from Library', `Remove "${artist.artistName}" from Lidarr?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove Only',
        onPress: async () => {
          setBusy(true);
          try {
            await lidarrApi.deleteArtist(config, artist.id, false);
            router.back();
          } catch (e) {
            alert('Failed to remove', e instanceof Error ? e.message : 'Unknown error');
          } finally {
            setBusy(false);
          }
        },
      },
      {
        text: 'Delete Files Too',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await lidarrApi.deleteArtist(config, artist.id, true);
            router.back();
          } catch (e) {
            alert('Failed to remove', e instanceof Error ? e.message : 'Unknown error');
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  };

  if (!config) {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.emptyText}>Lidarr isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  if (loading || !artist) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color={colors.lidarr} />
      </SafeAreaView>
    );
  }

  const sortedAlbums = [...albums].sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
  const artistEntity = { type: 'artist' as const, id: artist.id };
  const backdrop = artist.images.find((i) => i.coverType === 'fanart') ?? artist.images.find((i) => i.coverType === 'poster');
  const poster = artist.images.find((i) => i.coverType === 'poster');
  // Lidarr's artist poster/fanart come from Fanart.tv, which needs its own
  // API key configured in Lidarr's own settings before it populates at all
  // - many instances have no artist-level art as a result, even though
  // album covers (from Cover Art Archive, no extra config needed) work
  // fine. Falls back to the most recent album with a cover image so the
  // page never looks blank just because Fanart.tv isn't set up. The
  // gallery route (`app/gallery.tsx`) replicates this same fallback for
  // whatever the hero photo tap opens, so tapping through shows the same
  // image this page is already displaying.
  const fallbackAlbum = !backdrop && !poster ? sortedAlbums.find((a) => a.images.some((i) => i.coverType === 'cover')) : undefined;
  const fallbackCover = fallbackAlbum?.images.find((i) => i.coverType === 'cover');
  const fallbackEntity = fallbackAlbum ? { type: 'album' as const, id: fallbackAlbum.id } : undefined;
  const backdropUrl =
    lidarrImageUrl(backdrop, config, artistEntity, 780) ??
    (fallbackCover && fallbackEntity ? lidarrImageUrl(fallbackCover, config, fallbackEntity, 780) : undefined);
  const posterUrl =
    lidarrImageUrl(poster, config, artistEntity, 500) ??
    (fallbackCover && fallbackEntity ? lidarrImageUrl(fallbackCover, config, fallbackEntity, 500) : undefined);
  const totalSize = artist.statistics?.sizeOnDisk;
  const profileName = profiles.find((p) => p.id === artist.qualityProfileId)?.name;
  const qualityMenuOptions: ActionSheetOption[] = profiles.map((p) => ({
    label: p.name,
    onPress: () => setQualityProfile(p.id),
  }));

  return (
    <View style={styles.screen}>
      <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: tabBarClearance }}>
        <ImageBackground source={backdropUrl ? { uri: backdropUrl } : undefined} style={styles.hero}>
          <LinearGradient colors={['transparent', colors.background]} style={styles.heroGradient} />
          <SafeAreaView edges={['top']} style={styles.heroTopBar}>
            <TouchableOpacity style={styles.circleButton} onPress={() => router.back()}>
              <Ionicons name="arrow-back" size={22} color={colors.textPrimary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.circleButton} onPress={removeFromLibrary} disabled={busy}>
              <Ionicons name="trash" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
          </SafeAreaView>
          <View style={styles.heroBottom}>
            <TouchableOpacity
              onPress={() => router.push({ pathname: '/gallery', params: { lidarrEntityType: 'artist', lidarrEntityId: String(artist.id) } })}
              disabled={!posterUrl}
            >
              {posterUrl ? (
                <Image source={{ uri: posterUrl }} style={styles.poster} cachePolicy="memory-disk" />
              ) : (
                <View style={[styles.poster, styles.posterPlaceholder]} />
              )}
            </TouchableOpacity>
            <View style={styles.heroInfo}>
              <Text style={styles.title}>{artist.artistName}</Text>
              <View style={styles.statusRow}>
                {artist.status ? <Badge label={titleCase(artist.status)} tone={artistStatusTone(artist.status)} /> : null}
              </View>
              <RatingBadges imdb={artist.ratings?.value} tint={colors.lidarr} compact />
            </View>
          </View>
        </ImageBackground>

        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.actionChip} onPress={toggleArtistMonitored}>
            <Ionicons name={artist.monitored ? 'bookmark' : 'bookmark-outline'} size={18} color={colors.lidarr} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionChip, styles.actionChipWide]}
            onPress={() => setQualityMenuOpen(true)}
            disabled={profiles.length === 0}
          >
            <Text style={styles.actionChipText}>{profileName ?? 'Quality'}</Text>
          </TouchableOpacity>
          {totalSize ? (
            <View style={[styles.actionChip, styles.actionChipWide]}>
              <Text style={styles.actionChipText}>{formatBytes(totalSize)}</Text>
            </View>
          ) : null}
          <TouchableOpacity style={styles.actionChip} onPress={searchWholeArtist} disabled={busy}>
            <Ionicons name="search" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionChip} onPress={openArtistMenu} disabled={busy}>
            <Ionicons name="ellipsis-vertical" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Albums</Text>
          {sortedAlbums.map((album) => {
            const stats = album.statistics;
            const year = album.releaseDate ? new Date(album.releaseDate).getFullYear() : undefined;
            const albumEntity = { type: 'album' as const, id: album.id };
            const cover = album.images.find((i) => i.coverType === 'cover');
            const coverUrl = lidarrImageUrl(cover, config, albumEntity);
            return (
              <Pressable
                key={album.id}
                style={styles.albumRow}
                onPress={() => router.push(`/artist/${artistId}/album/${album.id}?artistName=${encodeURIComponent(artist.artistName)}`)}
              >
                <TouchableOpacity
                  onPress={() => router.push({ pathname: '/gallery', params: { lidarrEntityType: 'album', lidarrEntityId: String(album.id) } })}
                  disabled={!coverUrl}
                >
                  {coverUrl ? (
                    <Image source={{ uri: coverUrl }} style={styles.albumCover} cachePolicy="memory-disk" />
                  ) : (
                    <View style={[styles.albumCover, styles.posterPlaceholder]} />
                  )}
                </TouchableOpacity>
                <TouchableOpacity onPress={() => toggleAlbumMonitored(album)}>
                  <Ionicons name={album.monitored ? 'bookmark' : 'bookmark-outline'} size={18} color={colors.lidarr} />
                </TouchableOpacity>
                <View style={styles.albumInfo}>
                  <Text style={styles.albumLabel}>
                    {album.title}
                    {year ? ` (${year})` : ''}
                  </Text>
                  {stats ? <Text style={styles.albumMeta}>{formatBytes(stats.sizeOnDisk)}</Text> : null}
                </View>
                {stats ? (
                  <Text style={styles.albumCount}>
                    {stats.trackFileCount}/{stats.trackCount}
                  </Text>
                ) : null}
                <TouchableOpacity onPress={() => openAlbumMenu(album)} style={styles.albumMenuButton}>
                  <Ionicons name="ellipsis-vertical" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              </Pressable>
            );
          })}
        </View>

        {artist.overview ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Overview</Text>
            <Text style={styles.overview}>{artist.overview}</Text>
          </View>
        ) : null}

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Details</Text>
          <InfoRow icon="person-outline" label="Type" value={artist.artistType ? titleCase(artist.artistType) : undefined} />
          <InfoRow icon="calendar-outline" label="Added" value={formatDate(artist.added) ?? undefined} />
          <InfoRow icon="folder-outline" label="Root Path" value={artist.rootFolderPath} />
        </View>

        <TagList tags={artist.genres ?? []} tint={colors.lidarr} />
      </ScrollView>

      {menu ? <ActionSheet visible title={menu.title} options={menu.options} onClose={() => setMenu(null)} /> : null}
      <ActionSheet
        visible={qualityMenuOpen}
        title="Quality Profile"
        options={qualityMenuOptions}
        onClose={() => setQualityMenuOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textSecondary },
  hero: { minHeight: 260, justifyContent: 'flex-end' },
  heroGradient: { ...StyleSheet.absoluteFill },
  heroTopBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  circleButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBottom: { flexDirection: 'row', gap: 14, padding: 16, alignItems: 'flex-end' },
  poster: { width: 90, height: 135, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  heroInfo: { flex: 1, gap: 4 },
  title: { fontSize: 22, fontWeight: '800', color: colors.textPrimary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 14 },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderRadius: 10,
    height: 44,
    minWidth: 44,
    paddingHorizontal: 12,
  },
  actionChipWide: { flex: 1 },
  actionChipText: { color: colors.textPrimary, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, margin: 16, marginTop: 14, gap: 4 },
  sectionTitle: { color: colors.textPrimary, fontWeight: '700', fontSize: 15, marginBottom: 6 },
  albumRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  albumCover: { width: 44, height: 44, borderRadius: 6, backgroundColor: colors.surfaceAlt },
  albumInfo: { flex: 1 },
  albumLabel: { color: colors.textPrimary, fontWeight: '600', fontSize: 15 },
  albumMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  albumCount: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  albumMenuButton: { padding: 4 },
  overview: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  infoIcon: { marginRight: 10 },
  infoLabel: { color: colors.textSecondary, fontSize: 13, flex: 1 },
  infoValue: { color: colors.textPrimary, fontSize: 13, fontWeight: '600', flexShrink: 1, minWidth: 0 },
});
