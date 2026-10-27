// A show's TV detail page: backdrop and logo, the phone's main actions (search missing, monitor),
// season chips and that season's episodes. OK on a season chip shows its episodes; OK on an episode
// opens its menu. Same Sonarr calls as app/series/[id] on the phone.
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, findNodeHandle, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SonarrEpisode, SonarrSeries, sonarrApi } from '../../../src/api/sonarr';
import { alert } from '../../../src/lib/alert';
import { colors } from '../../../src/theme/colors';
import { ActionButton, ButtonRow, Backdrop, detailStyles, OpenInButtons, TitleBlock, useNotice } from '../../components/Detail';
import { FocusCard } from '../../components/FocusCard';
import { fileDetailsText } from '../../lib/fileDetails';
import { backdropUrl, logoUrl } from '../../lib/images';
import { useEnabledServers } from '../../lib/useEnabledServers';
import { TV_LIST } from '../../components/ui';

const errText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong');

function episodeState(ep: SonarrEpisode): { label: string; color: string } {
  if (ep.hasFile) return { label: 'Downloaded', color: colors.success };
  if (!ep.airDateUtc || new Date(ep.airDateUtc).getTime() > Date.now()) return { label: 'Unaired', color: colors.textMuted };
  if (!ep.monitored) return { label: 'Not monitored', color: colors.textMuted };
  return { label: 'Missing', color: colors.accent };
}

const airDate = (ep: SonarrEpisode) =>
  ep.airDateUtc ? new Date(ep.airDateUtc).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : 'TBA';

export default function TvShowDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const seriesId = Number(id);
  const { servers, ready } = useEnabledServers();
  const config = servers.sonarr;
  const [series, setSeries] = useState<SonarrSeries | null>(null);
  const [episodes, setEpisodes] = useState<SonarrEpisode[]>([]);
  const [season, setSeason] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const notice = useNotice();
  // Down from the action buttons lands on the selected season's chip, not on Season 1.
  const selectedChip = useRef<View>(null);
  const [chipHandle, setChipHandle] = useState<number | undefined>();

  const load = useCallback(async () => {
    if (!config) return;
    try {
      const [s, eps] = await Promise.all([sonarrApi.getSeriesById(config, seriesId), sonarrApi.getEpisodes(config, seriesId)]);
      setSeries(s);
      setEpisodes(eps);
      setSeason((current) => {
        if (current != null) return current;
        // Open on the newest season that has aired anything (or the last one), skipping Specials.
        const numbers = [...new Set(eps.map((e) => e.seasonNumber))].filter((n) => n > 0).sort((a, b) => a - b);
        const aired = numbers.filter((n) => eps.some((e) => e.seasonNumber === n && e.airDateUtc && new Date(e.airDateUtc).getTime() <= Date.now()));
        return aired[aired.length - 1] ?? numbers[numbers.length - 1] ?? 0;
      });
    } catch (e) {
      setError(errText(e));
    }
  }, [config, seriesId]);

  useEffect(() => {
    if (ready) load();
  }, [ready, load]);

  const seasons = useMemo(() => {
    const numbers = [...new Set(episodes.map((e) => e.seasonNumber))].sort((a, b) => (a === 0 ? 1 : b === 0 ? -1 : a - b));
    return numbers.map((n) => {
      const eps = episodes.filter((e) => e.seasonNumber === n);
      return { n, have: eps.filter((e) => e.hasFile).length, total: eps.length };
    });
  }, [episodes]);

  useEffect(() => {
    const h = selectedChip.current ? findNodeHandle(selectedChip.current) : null;
    setChipHandle(h ?? undefined);
  }, [season, seasons]);

  const seasonEpisodes = useMemo(
    () => episodes.filter((e) => e.seasonNumber === season).sort((a, b) => a.episodeNumber - b.episodeNumber),
    [episodes, season]
  );

  if (ready && !config) return <Text style={detailStyles.error}>Sonarr is not set up in this profile.</Text>;
  if (error) return <Text style={detailStyles.error}>{error}</Text>;
  if (!series) {
    return (
      <View style={detailStyles.loading}>
        <ActivityIndicator color={colors.sonarr} size="large" />
      </View>
    );
  }

  const fail = (e: unknown) => alert('Failed', errText(e));
  const refresh = () => load();

  const seasonMenu = (n: number) => {
    const label = n === 0 ? 'Specials' : `Season ${n}`;
    const seasonMeta = series.seasons?.find((x) => x.seasonNumber === n);
    const fileIds = episodes.filter((e) => e.seasonNumber === n && e.hasFile).map((e) => e.episodeFileId);
    alert(`${series.title} · ${label}`, undefined, [
      { text: 'Automatic search', onPress: () => sonarrApi.searchSeasonRelease(config!, series.id, n).then(() => notice.show(`Searching ${label}…`)).catch(fail) },
      { text: 'Interactive search', onPress: () => router.push(`/releases?service=sonarr&seriesId=${series.id}&seasonNumber=${n}&title=${encodeURIComponent(`${series.title} · ${label}`)}` as never) },
      ...(seasonMeta
        ? [
            {
              text: seasonMeta.monitored ? 'Unmonitor season' : 'Monitor season',
              onPress: () =>
                sonarrApi
                  .updateSeries(config!, { ...series, seasons: series.seasons!.map((x) => (x.seasonNumber === n ? { ...x, monitored: !x.monitored } : x)) })
                  .then((u) => {
                    setSeries(u);
                    refresh();
                  })
                  .catch(fail),
            },
          ]
        : []),
      ...(fileIds.length
        ? [
            {
              text: 'Delete season files',
              style: 'destructive' as const,
              onPress: () =>
                alert('Delete Files', `Delete ${fileIds.length} episode file${fileIds.length === 1 ? '' : 's'} from ${label}? This cannot be undone.`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => sonarrApi.deleteEpisodeFilesBulk(config!, fileIds).then(refresh).catch(fail) },
                ]),
            },
          ]
        : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const episodeMenu = (ep: SonarrEpisode) => {
    const name = `S${ep.seasonNumber} E${ep.episodeNumber} · ${ep.title}`;
    alert(name, `${airDate(ep)} · ${episodeState(ep).label}`, [
      { text: 'Automatic search', onPress: () => sonarrApi.searchEpisodeRelease(config!, [ep.id]).then(() => notice.show(`Searching for ${name}…`)).catch(fail) },
      { text: 'Interactive search', onPress: () => router.push(`/releases?service=sonarr&seriesId=${series.id}&episodeId=${ep.id}&title=${encodeURIComponent(`${series.title} · ${name}`)}` as never) },
      { text: ep.monitored ? 'Unmonitor' : 'Monitor', onPress: () => sonarrApi.updateEpisodesMonitored(config!, [ep.id], !ep.monitored).then(refresh).catch(fail) },
      ...(ep.hasFile && ep.episodeFileId
        ? [
            {
              text: 'File details',
              onPress: () =>
                sonarrApi
                  .getEpisodeFile(config!, ep.episodeFileId!)
                  .then((f) => alert('File details', fileDetailsText(f)))
                  .catch(fail),
            },
          ]
        : []),
      ...(ep.hasFile
        ? [
            {
              text: 'Delete file',
              style: 'destructive' as const,
              onPress: () =>
                alert('Delete File', `Delete the file for ${name}? This cannot be undone.`, [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Delete', style: 'destructive', onPress: () => sonarrApi.deleteEpisodeFile(config!, ep.episodeFileId).then(refresh).catch(fail) },
                ]),
            },
          ]
        : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const moreMenu = () =>
    alert(series.title, undefined, [
      { text: 'Interactive search (whole series)', onPress: () => router.push(`/releases?service=sonarr&seriesId=${series.id}&title=${encodeURIComponent(series.title)}` as never) },
      {
        text: 'Remove from Library',
        style: 'destructive',
        onPress: () =>
          alert('Remove from Library', `Remove "${series.title}" from Sonarr?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove Only', onPress: () => sonarrApi.deleteSeries(config!, series.id, false).then(() => router.back()).catch(fail) },
            { text: 'Remove and delete files', style: 'destructive', onPress: () => sonarrApi.deleteSeries(config!, series.id, true).then(() => router.back()).catch(fail) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const st = series.statistics;
  const statusLabel = series.status === 'continuing' ? 'Continuing' : series.status === 'ended' ? 'Ended' : series.status;

  return (
    <View style={detailStyles.screen}>
      <Backdrop uri={backdropUrl(series.images)} />
      <ScrollView {...TV_LIST} contentContainerStyle={detailStyles.content} showsVerticalScrollIndicator={false}>
        <TitleBlock
          title={series.title}
          logo={logoUrl(series.images)}
          meta={[
            series.year ? String(series.year) : undefined,
            series.network,
            statusLabel,
            st && `${st.episodeFileCount}/${st.episodeCount} episodes`,
            series.ratings?.value ? `★ ${series.ratings.value.toFixed(1)}` : undefined,
          ]}
          genres={series.genres}
          overview={series.overview}
        />

        <ButtonRow>
          <ActionButton
            icon="search"
            label="Search"
            tint={colors.sonarr}
            primary
            preferredFocus
            nextFocusDown={chipHandle}
            onPress={async () => {
              try {
                await sonarrApi.searchSeriesRelease(config!, series.id);
                notice.show('Searching for missing episodes…');
              } catch (e) {
                notice.show(errText(e), true);
              }
            }}
          />
          <ActionButton
            icon={series.monitored ? 'eye' : 'eye-off'}
            nextFocusDown={chipHandle}
            label={series.monitored ? 'Monitored' : 'Not monitored'}
            tint={series.monitored ? colors.success : colors.textMuted}
            onPress={async () => {
              try {
                const updated = await sonarrApi.updateSeries(config!, { ...series, monitored: !series.monitored });
                setSeries(updated);
                notice.show(updated.monitored ? 'Now monitored' : 'No longer monitored');
              } catch (e) {
                notice.show(errText(e), true);
              }
            }}
          />
          {season != null && (
            <ActionButton icon="albums-outline" nextFocusDown={chipHandle} label={season === 0 ? 'Specials' : `Season ${season}`} tint={colors.sonarr} onPress={() => seasonMenu(season)} />
          )}
          <ActionButton icon="ellipsis-horizontal" nextFocusDown={chipHandle} label="More" tint={colors.sonarr} onPress={moreMenu} />
          <OpenInButtons title={series.title} year={series.year} kind="tv" onError={(m) => notice.show(m, true)} nextFocusDown={chipHandle} />
        </ButtonRow>
        {notice.view}

        <Text style={detailStyles.sectionTitle}>Seasons</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} {...TV_LIST} contentContainerStyle={styles.seasons}>
          {seasons.map((s) => {
            const on = s.n === season;
            const done = s.total > 0 && s.have >= s.total;
            return (
              <FocusCard key={s.n} ref={on ? selectedChip : undefined} radius={16} scale={1.05} style={[styles.chip, on && { backgroundColor: colors.sonarr }]} onPress={() => setSeason(s.n)}>
                <Text style={[styles.chipText, on && { color: colors.background }]}>{s.n === 0 ? 'Specials' : `Season ${s.n}`}</Text>
                <Text style={[styles.chipCount, on ? { color: colors.background } : done && { color: colors.success }]}>
                  {s.have}/{s.total}
                </Text>
              </FocusCard>
            );
          })}
        </ScrollView>

        <View style={styles.episodes}>
          {seasonEpisodes.map((ep) => {
            const state = episodeState(ep);
            return (
              <FocusCard
                key={ep.id}
                radius={10}
                scale={1.02}
                style={styles.episode}
                onPress={() => episodeMenu(ep)}
              >
                <Text style={styles.epNumber}>{ep.episodeNumber}</Text>
                <View style={styles.epBody}>
                  <Text style={styles.epTitle} numberOfLines={1}>
                    {ep.title}
                  </Text>
                  <Text style={styles.epDate}>{airDate(ep)}</Text>
                </View>
                <Text style={[styles.epState, { color: state.color }]}>{state.label}</Text>
              </FocusCard>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  seasons: { gap: 10, paddingVertical: 6, paddingRight: 40 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 7, backgroundColor: colors.surfaceAlt },
  chipText: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  chipCount: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  episodes: { marginTop: 14, gap: 8, maxWidth: 760 },
  episode: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 11, backgroundColor: 'rgba(29,31,39,0.85)' },
  epNumber: { color: colors.textMuted, fontSize: 16, fontWeight: '700', width: 36 },
  epBody: { flex: 1, marginRight: 16 },
  epTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  epDate: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  epState: { fontSize: 13, fontWeight: '600' },
});
