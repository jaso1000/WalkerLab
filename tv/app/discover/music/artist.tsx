// Discover Music's artist page on the TV (the phone's app/discover/music/[name]), keyed by name since
// an artist has no id until it's in Lidarr: Last.fm listeners, plays, tags and bio over iTunes art,
// then Add to Lidarr with the phone's options (quality profile - last used first - metadata profile,
// root folder, monitor, search on add) as buttons that each open a picker; "View in Library" instead
// when Lidarr already has it. Similar Artists and Top Tracks below.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { lastfmApi, LastfmArtistInfo, LastfmSimilarArtist, LastfmTrack, stripBioHtml } from '../../../../src/api/lastfm';
import { lidarrApi, LidarrArtist, LidarrMetadataProfile, LidarrQualityProfile, LidarrRootFolder } from '../../../../src/api/lidarr';
import { alert } from '../../../../src/lib/alert';
import { LIDARR_MONITOR_OPTIONS, LidarrMonitorOption } from '../../../../src/lib/constants';
import { capitalizeWords } from '../../../../src/lib/format';
import { getLastQualityProfileId, setLastQualityProfileId } from '../../../../src/lib/preferences';
import { colors } from '../../../../src/theme/colors';
import { ActionButton, ButtonRow, Backdrop, detailStyles, TitleBlock } from '../../../components/Detail';
import { ArtistRow, artistHref, useArtistArt } from '../../../components/Music';
import { errText, ListRow, NotConfigured, TV_LIST } from '../../../components/ui';
import { useEnabledServers } from '../../../lib/useEnabledServers';

const tint = colors.sectionGreen;
const note = { color: colors.textSecondary, fontSize: 15 };

export default function TvDiscoverArtist() {
  const { name = '' } = useLocalSearchParams<{ name: string }>();
  const { servers, ready } = useEnabledServers();
  const lastfm = servers.lastfm;
  const lidarr = servers.lidarr;
  const art = useArtistArt(name);
  const [info, setInfo] = useState<LastfmArtistInfo | null>(null);
  const [similar, setSimilar] = useState<LastfmSimilarArtist[]>([]);
  const [tracks, setTracks] = useState<LastfmTrack[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [lookup, setLookup] = useState<LidarrArtist | null | undefined>(undefined);
  const [profiles, setProfiles] = useState<LidarrQualityProfile[]>([]);
  const [metadata, setMetadata] = useState<LidarrMetadataProfile[]>([]);
  const [folders, setFolders] = useState<LidarrRootFolder[]>([]);
  const [qualityProfileId, setQualityProfileId] = useState<number | null>(null);
  const [metadataProfileId, setMetadataProfileId] = useState<number | null>(null);
  const [rootFolderPath, setRootFolderPath] = useState<string | null>(null);
  const [monitor, setMonitor] = useState<LidarrMonitorOption>('all');
  const [searchOnAdd, setSearchOnAdd] = useState(true);

  useEffect(() => {
    if (!lastfm || !name) return;
    Promise.all([lastfmApi.artistInfo(lastfm, name), lastfmApi.similarArtists(lastfm, name), lastfmApi.topTracks(lastfm, name)])
      .then(([i, s, t]) => {
        setInfo(i);
        setSimilar(s);
        setTracks(t);
      })
      .catch((e) => setError(errText(e)));
  }, [lastfm, name]);

  // Lidarr's name lookup says both whether it's in the library (a real id) and how to add it.
  const checkLibrary = useCallback(() => {
    if (!lidarr || !name) return setLookup(null);
    lidarrApi
      .searchArtists(lidarr, name)
      .then((r) => setLookup(r.find((a) => a.artistName.toLowerCase() === name.toLowerCase()) ?? r[0] ?? null))
      .catch(() => setLookup(null));
  }, [lidarr, name]);
  useEffect(checkLibrary, [checkLibrary]);

  useEffect(() => {
    if (!lidarr) return;
    Promise.all([lidarrApi.getQualityProfiles(lidarr), lidarrApi.getMetadataProfiles(lidarr), lidarrApi.getRootFolders(lidarr), getLastQualityProfileId('lidarr')])
      .then(([q, m, f, remembered]) => {
        setProfiles(q);
        setMetadata(m);
        setFolders(f);
        setQualityProfileId(q.find((p) => p.id === remembered)?.id ?? q[0]?.id ?? null);
        setMetadataProfileId(m[0]?.id ?? null);
        setRootFolderPath(f[0]?.path ?? null);
      })
      .catch(() => {});
  }, [lidarr]);

  if (ready && !lastfm) return <NotConfigured service="Last.fm" />;
  if (error) return <Text style={detailStyles.error}>{error}</Text>;
  if (!info) {
    return (
      <View style={detailStyles.loading}>
        <ActivityIndicator color={tint} size="large" />
      </View>
    );
  }

  const pick = <T,>(title: string, options: T[], label: (o: T) => string, set: (o: T) => void) =>
    alert(title, undefined, [...options.map((o) => ({ text: label(o), onPress: () => set(o) })), { text: 'Cancel', style: 'cancel' as const }]);

  const add = async () => {
    if (!lidarr || !lookup?.foreignArtistId || !qualityProfileId || !metadataProfileId || !rootFolderPath) return;
    try {
      await lidarrApi.addArtist(lidarr, {
        artistName: lookup.artistName,
        foreignArtistId: lookup.foreignArtistId,
        qualityProfileId,
        metadataProfileId,
        rootFolderPath,
        monitorOption: monitor,
        searchOnAdd,
      });
      await setLastQualityProfileId('lidarr', qualityProfileId);
      alert('Added', `${lookup.artistName} was added to Lidarr.`);
      checkLibrary();
    } catch (e) {
      alert('Failed to add', errText(e));
    }
  };

  const inLibraryId = lookup?.id || undefined;
  const bio = info.bio?.summary ? stripBioHtml(info.bio.summary) : undefined;
  const listeners = info.stats?.listeners ? `${Number(info.stats.listeners).toLocaleString()} listeners` : undefined;
  const plays = info.stats?.playcount ? `${Number(info.stats.playcount).toLocaleString()} plays` : undefined;

  return (
    <View style={detailStyles.screen}>
      <Backdrop uri={art} />
      <ScrollView {...TV_LIST} contentContainerStyle={{ paddingTop: 60, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: 56 }}>
          <TitleBlock title={info.name} meta={[listeners, plays]} genres={info.tags?.tag?.map((t) => capitalizeWords(t.name))} overview={bio} />
          <ButtonRow style={{ flexWrap: 'wrap' }}>
            {lookup === undefined ? (
              <ActivityIndicator color={colors.lidarr} />
            ) : inLibraryId ? (
              <ActionButton icon="library" label="View in Library" tint={colors.lidarr} primary preferredFocus onPress={() => router.push(`/music/${inLibraryId}` as never)} />
            ) : !lidarr ? (
              <Text style={note}>Connect Lidarr in Settings to add this artist.</Text>
            ) : !lookup?.foreignArtistId ? (
              <Text style={note}>This artist couldn’t be matched in Lidarr’s catalog, so it can’t be added automatically.</Text>
            ) : (
              <>
                <ActionButton icon="add" label="Add to Lidarr" tint={colors.lidarr} primary preferredFocus onPress={add} />
                <ActionButton
                  icon="options-outline"
                  label={profiles.find((p) => p.id === qualityProfileId)?.name ?? 'Quality'}
                  tint={colors.lidarr}
                  onPress={() => pick('Quality Profile', profiles, (p) => p.name, (p) => setQualityProfileId(p.id))}
                />
                <ActionButton
                  icon="pricetags-outline"
                  label={metadata.find((p) => p.id === metadataProfileId)?.name ?? 'Metadata'}
                  tint={colors.lidarr}
                  onPress={() => pick('Metadata Profile', metadata, (p) => p.name, (p) => setMetadataProfileId(p.id))}
                />
                <ActionButton icon="folder-outline" label={rootFolderPath ?? 'Root folder'} tint={colors.lidarr} onPress={() => pick('Root Folder', folders, (f) => f.path, (f) => setRootFolderPath(f.path))} />
                <ActionButton
                  icon="eye-outline"
                  label={`Monitor: ${LIDARR_MONITOR_OPTIONS.find((o) => o.value === monitor)?.label ?? 'All Albums'}`}
                  tint={colors.lidarr}
                  onPress={() => pick('Monitor', [...LIDARR_MONITOR_OPTIONS], (o) => o.label, (o) => setMonitor(o.value))}
                />
                <ActionButton
                  icon={searchOnAdd ? 'checkbox' : 'square-outline'}
                  label="Search on add"
                  tint={colors.lidarr}
                  onPress={() => setSearchOnAdd((v) => !v)}
                />
              </>
            )}
          </ButtonRow>
        </View>
        <ArtistRow title="Similar Artists" items={similar.map((a) => ({ name: a.name }))} onPressItem={(a) => router.push(artistHref(a) as never)} />
        {tracks.length > 0 ? (
          <View style={{ paddingHorizontal: 56, gap: 8 }}>
            <Text style={detailStyles.sectionTitle}>Top Tracks</Text>
            {tracks.map((t, i) => (
              <ListRow key={`${t.name}-${i}`} title={`${i + 1}. ${t.name}`} meta={t.listeners ? `${Number(t.listeners).toLocaleString()} listeners` : undefined} icon="musical-note-outline" tint={tint} />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}
