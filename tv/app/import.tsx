// Manual Import on the TV, for a queue item Sonarr/Radarr could not import by themselves (the phone's
// app/series/manual-import and app/movie/manual-import): the download's candidate files with what they
// matched, their quality and any rejections. OK on a file: include/exclude it, choose its quality, and
// (Sonarr) choose which episode it is. Import sends the selected files with the same body the phone
// sends. Files with no matched series/movie can't be imported from here, as on the phone.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { radarrApi, RadarrManualImportItem } from '../../src/api/radarr';
import { SonarrEpisode, sonarrApi, SonarrManualImportItem } from '../../src/api/sonarr';
import { alert } from '../../src/lib/alert';
import { formatBytes } from '../../src/lib/format';
import { colors } from '../../src/theme/colors';
import { ActionButton } from '../components/Detail';
import { listStyles } from '../components/DownloadClientView';
import { errText, ListFrame, ListRow, Loading, Message, ScreenHeader, TV_LIST, useLoad } from '../components/ui';
import { useEnabledServers } from '../lib/useEnabledServers';

type Item = (SonarrManualImportItem | RadarrManualImportItem) & { series?: SonarrManualImportItem['series']; movie?: RadarrManualImportItem['movie'] };
interface QualityDef {
  id: number;
  title: string;
  quality: { id: number; name: string };
}

export default function TvManualImport() {
  const { service, downloadId } = useLocalSearchParams<{ service: 'sonarr' | 'radarr'; downloadId: string }>();
  const isSonarr = service === 'sonarr';
  const tint = isSonarr ? colors.sonarr : colors.accent;
  const { servers, ready } = useEnabledServers();
  const config = isSonarr ? servers.sonarr : servers.radarr;
  const [selected, setSelected] = useState<Set<number> | null>(null);
  const [qualityOverride, setQualityOverride] = useState<Record<number, number>>({});
  const [episodeOverride, setEpisodeOverride] = useState<Record<number, SonarrEpisode>>({});

  const load = useCallback(async () => {
    const [items, qualities] = isSonarr
      ? await Promise.all([sonarrApi.getManualImportItems(config!, downloadId), sonarrApi.getQualityDefinitions(config!)])
      : await Promise.all([radarrApi.getManualImportItems(config!, downloadId), radarrApi.getQualityDefinitions(config!)]);
    return { items: items as Item[], qualities: qualities as unknown as QualityDef[] };
  }, [isSonarr, config, downloadId]);
  const data = useLoad(load, [load], ready && !!config && !!downloadId);

  const items = useMemo(() => data.data?.items ?? [], [data.data]);
  const qualities = useMemo(() => data.data?.qualities ?? [], [data.data]);
  const matched = (i: Item) => (isSonarr ? !!i.series : !!i.movie);
  const chosen = selected ?? new Set(items.filter(matched).map((i) => i.id));

  const quality = (i: Item) => {
    const def = qualityOverride[i.id] ? qualities.find((q) => q.id === qualityOverride[i.id]) : undefined;
    return def ? { quality: def.quality, revision: i.quality?.revision } : i.quality;
  };
  const episodeFor = (i: Item): SonarrEpisode | undefined => episodeOverride[i.id] ?? (i as SonarrManualImportItem).episodes?.[0];

  const openItem = (i: Item) => {
    const on = chosen.has(i.id);
    const name = i.relativePath ?? i.name ?? i.path;
    alert(name, [formatBytes(i.size), quality(i)?.quality.name, ...(i.rejections ?? []).map((r) => r.reason)].filter(Boolean).join('\n'), [
      {
        text: on ? 'Exclude from import' : 'Include in import',
        onPress: () => {
          const next = new Set(chosen);
          if (on) next.delete(i.id);
          else next.add(i.id);
          setSelected(next);
        },
      },
      {
        text: 'Choose quality',
        onPress: () =>
          alert(
            'Choose Quality',
            undefined,
            qualities.map((q) => ({ text: q.title, onPress: () => setQualityOverride((p) => ({ ...p, [i.id]: q.id })) }))
          ),
      },
      ...(isSonarr && i.series
        ? [
            {
              text: 'Choose episode',
              onPress: async () => {
                try {
                  const eps = (await sonarrApi.getEpisodes(config!, i.series!.id)).filter((e) => (i as SonarrManualImportItem).seasonNumber == null || e.seasonNumber === (i as SonarrManualImportItem).seasonNumber);
                  alert(
                    'Choose Episode',
                    undefined,
                    eps.map((e) => ({ text: `S${e.seasonNumber} E${e.episodeNumber} · ${e.title}`, onPress: () => setEpisodeOverride((p) => ({ ...p, [i.id]: e })) }))
                  );
                } catch (e) {
                  alert('Failed', errText(e));
                }
              },
            },
          ]
        : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const submit = async () => {
    const toImport = items.filter((i) => chosen.has(i.id));
    if (toImport.length === 0) return alert('Nothing selected', 'Include at least one file.');
    if (toImport.some((i) => !matched(i))) {
      return alert('Can’t import everything selected', `One or more selected files have no matched ${isSonarr ? 'series' : 'movie'} - exclude them or resolve this download in ${isSonarr ? 'Sonarr' : 'Radarr'}’s web UI.`);
    }
    try {
      if (isSonarr) {
        await sonarrApi.importManually(
          config!,
          toImport.map((i) => {
            const s = i as SonarrManualImportItem;
            const ep = episodeFor(i);
            return {
              path: s.path,
              folderName: s.folderName,
              seriesId: s.series!.id,
              episodeIds: ep ? [ep.id] : [],
              seasonNumber: ep?.seasonNumber ?? s.seasonNumber,
              quality: quality(i),
              languages: s.languages,
              releaseGroup: s.releaseGroup,
              downloadId: s.downloadId,
            };
          }) as Parameters<typeof sonarrApi.importManually>[1]
        );
      } else {
        await radarrApi.importManually(
          config!,
          toImport.map((i) => ({
            path: i.path,
            folderName: i.folderName,
            movieId: i.movie!.id,
            quality: quality(i),
            languages: i.languages,
            releaseGroup: i.releaseGroup,
            downloadId: i.downloadId,
          })) as Parameters<typeof radarrApi.importManually>[1]
        );
      }
      alert('Import Started', `${isSonarr ? 'Sonarr' : 'Radarr'} is importing the selected file(s) now.`);
      router.back();
    } catch (e) {
      alert('Import failed', errText(e));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader
        title="Manual Import"
        tint={tint}
        subtitle={`${chosen.size} of ${items.length} selected`}
        right={<ActionButton icon="download" label="Import" tint={tint} primary onPress={submit} />}
      />
      {data.loading ? (
        <Loading tint={tint} />
      ) : (
        <ListFrame>
          <FlatList
            {...TV_LIST}
            data={items}
            keyExtractor={(i) => String(i.id)}
            contentContainerStyle={listStyles.list}
            ListEmptyComponent={<Message text={data.error ?? 'No files found for this download.'} error={!!data.error} />}
            renderItem={({ item: i, index }) => {
              const ep = isSonarr ? episodeFor(i) : undefined;
              const what = isSonarr
                ? i.series
                  ? `${i.series.title}${ep ? ` · S${ep.seasonNumber} E${ep.episodeNumber} · ${ep.title}` : ''}`
                  : 'No series matched'
                : i.movie
                  ? i.movie.title
                  : 'No movie matched';
              const on = chosen.has(i.id);
              return (
                <ListRow
                  title={i.relativePath ?? i.name ?? i.path}
                  subtitle={`${what} · ${quality(i)?.quality.name ?? 'Unknown'} · ${formatBytes(i.size)}${i.rejections?.length ? ` · ${i.rejections[0].reason}` : ''}`}
                  meta={on ? '✓ Import' : 'Skip'}
                  metaColor={on ? colors.success : colors.textMuted}
                  icon={matched(i) ? 'document' : 'alert-circle'}
                  tint={matched(i) ? tint : colors.danger}
                  preferredFocus={index === 0}
                  onPress={() => openItem(i)}
                />
              );
            }}
          />
        </ListFrame>
      )}
    </View>
  );
}
