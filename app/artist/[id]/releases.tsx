// Interactive release-search screen, shared across two drill-down levels:
// whole artist or one specific album - the optional `albumId` route param
// (passed by whichever screen linked here) scopes the Lidarr release-search
// call accordingly, and `title` customizes the subtitle shown so the user
// knows exactly what they're searching for. Mirrors `series/[id]/
// releases.tsx` almost verbatim, reusing the same shared `ReleasesView`.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { lidarrApi } from '../../../src/api/lidarr';
import { ArrRelease } from '../../../src/api/types';
import { ReleasesView } from '../../../src/components/ReleasesView';
import { useServers } from '../../../src/context/ServersContext';
import { alert } from '../../../src/lib/alert';
import { colors } from '../../../src/theme/colors';

export default function ArtistReleasesScreen() {
  const { id, albumId, title } = useLocalSearchParams<{ id: string; albumId?: string; title?: string }>();
  const artistId = Number(id);
  const { servers } = useServers();
  const config = servers.lidarr;

  const [releases, setReleases] = useState<ArrRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [grabbingGuid, setGrabbingGuid] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    try {
      setReleases(
        await lidarrApi.getReleases(config, {
          artistId,
          albumId: albumId ? Number(albumId) : undefined,
        })
      );
    } catch (e) {
      alert('Failed to load releases', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, artistId, albumId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Confirms before grabbing, then navigates back to wherever this screen
  // was opened from (artist detail or album view) on success.
  const grab = (release: ArrRelease) => {
    alert('Grab Release', `Download "${release.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Grab',
        onPress: async () => {
          if (!config) return;
          setGrabbingGuid(release.guid);
          try {
            await lidarrApi.grabRelease(config, { guid: release.guid, indexerId: release.indexerId });
            router.back();
          } catch (e) {
            alert('Grab failed', e instanceof Error ? e.message : 'Unknown error');
          } finally {
            setGrabbingGuid(null);
          }
        },
      },
    ]);
  };

  if (!config) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.textSecondary }}>Lidarr isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ReleasesView
        title={title ?? 'Artist search'}
        releases={releases}
        loading={loading}
        grabbingGuid={grabbingGuid}
        onGrab={grab}
        onClose={() => router.back()}
        tint={colors.lidarr}
        tintMuted={colors.lidarrMuted}
      />
    </SafeAreaView>
  );
}
