// "Add with options" on the TV (the phone's Discover add form): quality profile (last used first),
// root folder, and for a movie its minimum availability and monitored state, for a show which
// episodes to monitor; then search on add. Each option is a button that opens a picker. On success
// it opens the new library page in place of this one, as the phone does.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { radarrApi, RadarrMovie } from '../../../src/api/radarr';
import { sonarrApi, SonarrSeries } from '../../../src/api/sonarr';
import { tmdbApi } from '../../../src/api/tmdb';
import { alert } from '../../../src/lib/alert';
import { AVAILABILITY_OPTIONS, SONARR_MONITOR_OPTIONS, SonarrMonitorOption } from '../../../src/lib/constants';
import { deletedLibrary } from '../../../src/lib/deletedLibrary';
import { getLastQualityProfileId, setLastQualityProfileId } from '../../../src/lib/preferences';
import { colors } from '../../../src/theme/colors';
import { ActionButton } from '../../components/Detail';
import { errText, Loading, Message, ScreenHeader, SIDE, TV_LIST } from '../../components/ui';
import { useEnabledServers } from '../../lib/useEnabledServers';

interface Option {
  id: number | string;
  name: string;
}

export default function TvDiscoverAdd() {
  const { mediaType, id, title } = useLocalSearchParams<{ mediaType: string; id: string; title?: string }>();
  const isMovie = mediaType !== 'tv';
  const tmdbId = Number(id);
  const tint = isMovie ? colors.accent : colors.sonarr;
  const service = isMovie ? 'Radarr' : 'Sonarr';
  const { servers, ready } = useEnabledServers();
  const config = isMovie ? servers.radarr : servers.sonarr;

  const [lookup, setLookup] = useState<RadarrMovie | SonarrSeries | null>(null);
  const [tvdbId, setTvdbId] = useState<number | null>(null);
  const [profiles, setProfiles] = useState<Option[]>([]);
  const [folders, setFolders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [qualityProfileId, setQualityProfileId] = useState<number | null>(null);
  const [rootFolderPath, setRootFolderPath] = useState<string | null>(null);
  const [availability, setAvailability] = useState('released');
  const [monitored, setMonitored] = useState(true);
  const [monitor, setMonitor] = useState<SonarrMonitorOption>('all');
  const [searchOnAdd, setSearchOnAdd] = useState(true);

  useEffect(() => {
    if (!config) return;
    (async () => {
      try {
        let match: RadarrMovie | SonarrSeries | undefined;
        if (isMovie) {
          match = (await radarrApi.searchMovies(config, `tmdb:${tmdbId}`))[0];
        } else {
          const ids = await tmdbApi.tvExternalIds(servers.tmdb!, tmdbId);
          if (!ids.tvdb_id) throw new Error("This show couldn't be matched to TheTVDB, so it can't be added automatically.");
          setTvdbId(ids.tvdb_id);
          match = (await sonarrApi.searchSeries(config, `tvdb:${ids.tvdb_id}`))[0];
        }
        if (!match) throw new Error(`${service} couldn't find this title.`);
        const [p, f, remembered] = await Promise.all([
          isMovie ? radarrApi.getQualityProfiles(config) : sonarrApi.getQualityProfiles(config),
          isMovie ? radarrApi.getRootFolders(config) : sonarrApi.getRootFolders(config),
          getLastQualityProfileId(isMovie ? 'radarr' : 'sonarr'),
        ]);
        setLookup(match);
        setProfiles(p);
        setFolders(f.map((x) => x.path));
        setQualityProfileId(p.find((x) => x.id === remembered)?.id ?? p[0]?.id ?? null);
        setRootFolderPath(f[0]?.path ?? null);
      } catch (e) {
        setError(errText(e));
      }
    })();
  }, [config, isMovie, tmdbId, servers.tmdb, service]);

  if (ready && !config) return <Message text={`Connect ${service} in Settings to add this.`} />;
  if (error) return <Message text={error} error />;
  if (!lookup) return <Loading tint={tint} />;

  const pick = <T,>(heading: string, options: T[], label: (o: T) => string, set: (o: T) => void) =>
    alert(heading, undefined, [...options.map((o) => ({ text: label(o), onPress: () => set(o) })), { text: 'Cancel', style: 'cancel' as const }]);

  const add = async () => {
    if (!qualityProfileId || !rootFolderPath) return alert('Missing options', 'Choose a quality profile and root folder.');
    try {
      if (isMovie) {
        const added = await radarrApi.addMovie(config!, {
          title: lookup.title,
          tmdbId,
          qualityProfileId,
          rootFolderPath,
          minimumAvailability: availability,
          monitored,
          searchOnAdd,
        });
        await deletedLibrary.unmarkMovieDeleted(tmdbId);
        await setLastQualityProfileId('radarr', qualityProfileId);
        router.replace(`/movies/${added.id}` as never);
      } else {
        const added = await sonarrApi.addSeries(config!, { title: lookup.title, tvdbId: tvdbId!, qualityProfileId, rootFolderPath, monitorOption: monitor, searchOnAdd });
        await deletedLibrary.unmarkSeriesDeleted(tvdbId!);
        await deletedLibrary.unmarkSeriesDeletedByTmdbId(tmdbId);
        await setLastQualityProfileId('sonarr', qualityProfileId);
        router.replace(`/shows/${added.id}` as never);
      }
    } catch (e) {
      alert('Failed to add', errText(e));
    }
  };

  const row = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 14, marginTop: 14 };
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title={`Add to ${service}`} tint={tint} subtitle={title ?? lookup.title} />
      <ScrollView {...TV_LIST} contentContainerStyle={{ paddingHorizontal: SIDE, paddingBottom: 40 }}>
        <Text style={{ color: colors.textSecondary, fontSize: 14 }}>Select an option to change it, then Add.</Text>
        <View style={row}>
          <ActionButton
            icon="options-outline"
            label={`Quality: ${profiles.find((p) => p.id === qualityProfileId)?.name ?? 'Select'}`}
            tint={tint}
            preferredFocus
            onPress={() => pick('Quality Profile', profiles, (p) => p.name, (p) => setQualityProfileId(Number(p.id)))}
          />
          <ActionButton icon="folder-outline" label={rootFolderPath ?? 'Root folder'} tint={tint} onPress={() => pick('Root Folder', folders, (f) => f, setRootFolderPath)} />
          {isMovie ? (
            <>
              <ActionButton
                icon="calendar-outline"
                label={`Available: ${AVAILABILITY_OPTIONS.find((o) => o.value === availability)?.label ?? 'Released'}`}
                tint={tint}
                onPress={() => pick('Minimum Availability', AVAILABILITY_OPTIONS, (o) => o.label, (o) => setAvailability(o.value))}
              />
              <ActionButton icon={monitored ? 'checkbox' : 'square-outline'} label="Monitored" tint={tint} onPress={() => setMonitored((v) => !v)} />
            </>
          ) : (
            <ActionButton
              icon="eye-outline"
              label={`Monitor: ${SONARR_MONITOR_OPTIONS.find((o) => o.value === monitor)?.label ?? 'All Episodes'}`}
              tint={tint}
              onPress={() => pick('Monitor', [...SONARR_MONITOR_OPTIONS], (o) => o.label, (o) => setMonitor(o.value))}
            />
          )}
          <ActionButton icon={searchOnAdd ? 'checkbox' : 'square-outline'} label="Search on add" tint={tint} onPress={() => setSearchOnAdd((v) => !v)} />
        </View>
        <View style={row}>
          <ActionButton icon="add" label={isMovie ? 'Add Movie' : 'Add Series'} tint={tint} primary onPress={add} />
        </View>
      </ScrollView>
    </View>
  );
}
