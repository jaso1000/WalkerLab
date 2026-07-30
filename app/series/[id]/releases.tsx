// Interactive release-search screen, shared across three drill-down levels:
// whole series, one season, or one episode - the optional `seasonNumber`/
// `episodeId` route params (passed by whichever screen linked here) scope
// the Sonarr release-search call accordingly, and `title` customizes the
// subtitle shown so the user knows exactly what they're searching for.
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sonarrApi } from '../../../src/api/sonarr';
import { ArrRelease } from '../../../src/api/types';
import { ReleasesView } from '../../../src/components/ReleasesView';
import { useServers } from '../../../src/context/ServersContext';
import { alert } from '../../../src/lib/alert';
import { colors } from '../../../src/theme/colors';

export default function SeriesReleasesScreen() {
  const { id, seasonNumber, episodeId, title } = useLocalSearchParams<{
    id: string;
    seasonNumber?: string;
    episodeId?: string;
    title?: string;
  }>();
  const seriesId = Number(id);
  const { servers } = useServers();
  const config = servers.sonarr;

  const [releases, setReleases] = useState<ArrRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [grabbingGuid, setGrabbingGuid] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!config) return;
    setLoading(true);
    try {
      setReleases(
        await sonarrApi.getReleases(config, {
          seriesId,
          seasonNumber: seasonNumber ? Number(seasonNumber) : undefined,
          episodeId: episodeId ? Number(episodeId) : undefined,
        })
      );
    } catch (e) {
      alert('Failed to load releases', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [config, seriesId, seasonNumber, episodeId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // Confirms before grabbing, then navigates back to wherever this screen
  // was opened from (series detail, season, or episode view) on success.
  const grab = (release: ArrRelease) => {
    alert('Grab Release', `Download "${release.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Grab',
        onPress: async () => {
          if (!config) return;
          setGrabbingGuid(release.guid);
          try {
            await sonarrApi.grabRelease(config, { guid: release.guid, indexerId: release.indexerId });
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
        <Text style={{ color: colors.textSecondary }}>Sonarr isn&apos;t connected.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={['top']}>
      <ReleasesView
        title={title ?? 'Series search'}
        releases={releases}
        loading={loading}
        grabbingGuid={grabbingGuid}
        onGrab={grab}
        onClose={() => router.back()}
        tint={colors.sonarr}
        tintMuted={colors.sonarrMuted}
      />
    </SafeAreaView>
  );
}
