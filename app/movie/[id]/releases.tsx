// Interactive release-search screen for a single movie - thin route wrapper
// around the shared `ReleasesView`, handling Radarr-specific data
// loading/grabbing. Mirrors `series/[id]/releases.tsx`'s shape closely.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { radarrApi } from '../../../src/api/radarr';
import { ArrRelease } from '../../../src/api/types';
import { ReleasesView } from '../../../src/components/ReleasesView';
import { useServers } from '../../../src/context/ServersContext';
import { alert } from '../../../src/lib/alert';
import { colors } from '../../../src/theme/colors';

export default function MovieReleasesScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title?: string }>();
  const movieId = Number(id);
  const { servers } = useServers();
  const config = servers.radarr;

  const [releases, setReleases] = useState<ArrRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [grabbingGuid, setGrabbingGuid] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    try {
      setReleases(await radarrApi.getReleases(config, movieId));
    } catch (e) {
      alert('Failed to load releases', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, movieId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Confirms before grabbing (a manual release grab is a real network/disk
  // action, not just a UI selection), then navigates back to the movie
  // detail page on success so the user sees the result there.
  const grab = (release: ArrRelease) => {
    alert('Grab Release', `Download "${release.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Grab',
        onPress: async () => {
          if (!config) return;
          setGrabbingGuid(release.guid);
          try {
            await radarrApi.grabRelease(config, { guid: release.guid, indexerId: release.indexerId });
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
        <Text style={{ color: colors.textSecondary }}>Radarr isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ReleasesView
        title={title ?? 'Movie search'}
        releases={releases}
        loading={loading}
        grabbingGuid={grabbingGuid}
        onGrab={grab}
        onClose={() => router.back()}
      />
    </SafeAreaView>
  );
}
