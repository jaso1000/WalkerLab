// Requests (Overseerr) on the TV, as the phone's app/overseerr.tsx: Pending first, then the phone's
// filters (All / Approved / Processing / Available / Failed - no Declined filter, which Overseerr
// rejects), titles and posters filled in from TMDB, the same combined status label, and per request
// Approve / Decline (while pending), View (its Discover page) and Delete Request with confirmation.
// More pages load as focus nears the end.
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { Image } from 'expo-image';
import { overseerrApi, OverseerrFilter, OverseerrRequest } from '../../src/api/overseerr';
import { tmdbApi, tmdbImageUrl, TmdbMovieDetail, TmdbTvDetail } from '../../src/api/tmdb';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { alert } from '../../src/lib/alert';
import { colors } from '../../src/theme/colors';
import { listStyles } from '../components/DownloadClientView';
import { Shell } from '../components/Shell';
import { errText, ListFrame, ListRow, Loading, Message, NotConfigured, ScreenHeader, TV_LIST } from '../components/ui';
import { useEnabledServers } from '../lib/useEnabledServers';

const FILTERS: { key: OverseerrFilter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'processing', label: 'Processing' },
  { key: 'available', label: 'Available' },
  { key: 'failed', label: 'Failed' },
];

function statusInfo(req: OverseerrRequest): { label: string; color: string } {
  if (req.status === 3) return { label: 'Declined', color: colors.danger };
  if (req.status === 1) return { label: 'Pending', color: colors.info };
  switch (req.media.status) {
    case 5:
      return { label: 'Available', color: colors.success };
    case 4:
      return { label: 'Partially Available', color: colors.success };
    case 3:
      return { label: 'Processing', color: colors.accent };
    default:
      return { label: 'Approved', color: colors.accent };
  }
}

interface Info {
  title: string;
  poster?: string;
}

export default function TvRequests() {
  const { names } = useSectionNames();
  const { servers, ready } = useEnabledServers();
  const config = servers.overseerr;
  const tmdb = servers.tmdb;
  const tint = colors.overseerr;
  const [tab, setTab] = useState(0);
  const [items, setItems] = useState<OverseerrRequest[]>([]);
  const [info, setInfo] = useState<Record<string, Info>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const page = useRef(0);
  const pages = useRef(1);
  const busy = useRef(false);
  const infoRef = useRef(info);
  infoRef.current = info;
  const filter = FILTERS[tab].key;

  const enrich = useCallback(
    async (reqs: OverseerrRequest[]) => {
      if (!tmdb) return;
      const missing = [...new Map(reqs.filter((r) => !infoRef.current[`${r.type}:${r.media.tmdbId}`]).map((r) => [`${r.type}:${r.media.tmdbId}`, r])).entries()];
      const entries = await Promise.all(
        missing.map(async ([key, r]) => {
          try {
            const d = r.type === 'movie' ? await tmdbApi.movieDetail(tmdb, r.media.tmdbId) : await tmdbApi.tvDetail(tmdb, r.media.tmdbId);
            return [key, { title: r.type === 'movie' ? (d as TmdbMovieDetail).title : (d as TmdbTvDetail).name, poster: tmdbImageUrl(d.poster_path, 'w185') }] as const;
          } catch {
            return null;
          }
        })
      );
      setInfo((prev) => {
        const next = { ...prev };
        for (const e of entries) if (e) next[e[0]] = e[1];
        return next;
      });
    },
    [tmdb]
  );

  const load = useCallback(
    async (reset: boolean) => {
      if (!config || busy.current) return;
      if (!reset && page.current >= pages.current) return;
      busy.current = true;
      try {
        const n = reset ? 1 : page.current + 1;
        const res = await overseerrApi.getRequests(config, filter, n);
        page.current = n;
        pages.current = res.pageInfo.pages;
        setItems((prev) => (reset ? res.results : [...prev, ...res.results.filter((r) => !prev.some((p) => p.id === r.id))]));
        setError(null);
        enrich(res.results);
      } catch (e) {
        setError(errText(e));
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [config, filter, enrich]
  );

  useEffect(() => {
    if (!ready || !config) return;
    setLoading(true);
    setItems([]);
    page.current = 0;
    pages.current = 1;
    load(true);
  }, [ready, config, filter, load]);

  if (ready && !config) {
    return (
      <Shell active="requests">
        <NotConfigured service="Overseerr" />
      </Shell>
    );
  }

  const act = async (fn: () => Promise<unknown>, failTitle = 'Failed') => {
    try {
      await fn();
      load(true);
    } catch (e) {
      alert(failTitle, errText(e));
    }
  };

  const openMenu = (r: OverseerrRequest) => {
    const title = info[`${r.type}:${r.media.tmdbId}`]?.title ?? (r.type === 'movie' ? 'Movie request' : 'TV request');
    alert(title, `Requested by ${r.requestedBy.displayName} · ${statusInfo(r).label}`, [
      ...(r.status === 1
        ? [
            { text: 'Approve', onPress: () => act(() => overseerrApi.approveRequest(config!, r.id)) },
            { text: 'Decline', style: 'destructive' as const, onPress: () => act(() => overseerrApi.declineRequest(config!, r.id)) },
          ]
        : []),
      { text: 'View', onPress: () => router.push(`/discover/${r.type}/${r.media.tmdbId}` as never) },
      {
        text: 'Delete Request',
        style: 'destructive' as const,
        onPress: () =>
          alert('Delete Request', `Remove the request for "${title}"?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => act(() => overseerrApi.deleteRequest(config!, r.id), 'Delete failed') },
          ]),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  return (
    <Shell active="requests">
      <ScreenHeader title={names.requests} tint={tint} count={items.length} tabs={FILTERS.map((f) => f.label)} active={tab} onTab={setTab} />
      {loading ? (
        <Loading tint={tint} />
      ) : (
        <ListFrame>
          <FlatList
            {...TV_LIST}
            data={items}
            keyExtractor={(r) => String(r.id)}
            contentContainerStyle={listStyles.list}
            onEndReached={() => load(false)}
            onEndReachedThreshold={1.5}
            ListEmptyComponent={<Message text={error ?? 'No requests here.'} error={!!error} />}
            renderItem={({ item: r }) => {
              const i = info[`${r.type}:${r.media.tmdbId}`];
              const st = statusInfo(r);
              const seasons = r.type === 'tv' && r.seasons?.length ? ` · Season${r.seasons.length > 1 ? 's' : ''} ${r.seasons.map((s) => s.seasonNumber).join(', ')}` : '';
              return (
                <ListRow
                  title={i?.title ?? (r.type === 'movie' ? 'Movie' : 'TV show')}
                  subtitle={`${r.type === 'movie' ? 'Movie' : 'TV'}${seasons} · ${r.requestedBy.displayName} · ${new Date(r.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}`}
                  meta={st.label}
                  metaColor={st.color}
                  thumb={
                    <View style={{ width: 44, height: 66, borderRadius: 6, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
                      {i?.poster ? <Image source={{ uri: i.poster }} style={{ width: 44, height: 66 }} contentFit="cover" /> : null}
                    </View>
                  }
                  onPress={() => openMenu(r)}
                />
              );
            }}
          />
        </ListFrame>
      )}
    </Shell>
  );
}
