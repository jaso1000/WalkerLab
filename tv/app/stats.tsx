// Stats (Tautulli) on the TV, the phone's app/tautulli.tsx tabs: Activity (what is playing now, stream
// and bandwidth totals, refreshed every 10 s), Users (plays and watch time; OK opens that user's
// history), History (paged), Stats (the same Most Watched / Most Popular / Most Active / Most
// Concurrent lists) and Graphs (plays by day, day of week and month as bar charts).
import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { tautulliApi, TautulliGraphData, tautulliImageUrl, TautulliStatGroup, TautulliStatRow } from '../../src/api/tautulli';
import { ServiceConfig } from '../../src/api/types';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { formatDuration } from '../../src/lib/format';
import { colors } from '../../src/theme/colors';
import { listStyles } from '../components/DownloadClientView';
import { FocusCard } from '../components/FocusCard';
import { Shell } from '../components/Shell';
import { HistoryList, Thumb } from '../components/TautulliHistory';
import { ListFrame, ListRow, Loading, Message, NotConfigured, ScreenHeader, SIDE, StatTiles, TV_LIST, useLoad, usePoll } from '../components/ui';
import { useEnabledServers } from '../lib/useEnabledServers';

const TABS = ['Activity', 'Users', 'History', 'Stats', 'Graphs'] as const;
const tint = colors.tautulli;

const STAT_SECTIONS: { id: string; title: string; metric: (r: TautulliStatRow) => string; image: (r: TautulliStatRow) => string | undefined }[] = [
  { id: 'top_movies', title: 'Most Watched Movies', metric: (r) => `${r.total_plays ?? 0} plays`, image: (r) => r.thumb },
  { id: 'popular_movies', title: 'Most Popular Movies', metric: (r) => `${r.users_watched ?? 0} viewers`, image: (r) => r.thumb },
  { id: 'top_tv', title: 'Most Watched Shows', metric: (r) => `${r.total_plays ?? 0} plays`, image: (r) => r.grandparent_thumb ?? r.thumb },
  { id: 'popular_tv', title: 'Most Popular Shows', metric: (r) => `${r.users_watched ?? 0} viewers`, image: (r) => r.grandparent_thumb ?? r.thumb },
  { id: 'top_users', title: 'Most Active Users', metric: (r) => `${r.total_plays ?? 0} plays`, image: (r) => r.user_thumb },
  { id: 'most_concurrent', title: 'Most Concurrent Streams', metric: (r) => `${r.total_plays ?? 0}`, image: () => undefined },
];

const mbps = (kbps: number) => `${(kbps / 1000).toFixed(1)} Mbps`;
const shortDate = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : `${d.getDate()}/${d.getMonth() + 1}`;
};

export default function TvStats() {
  const { names } = useSectionNames();
  const { servers, ready } = useEnabledServers();
  const config = servers.tautulli;
  const [tab, setTab] = useState(0);

  if (ready && !config) {
    return (
      <Shell active="stats">
        <NotConfigured service="Tautulli" />
      </Shell>
    );
  }

  return (
    <Shell active="stats">
      <ScreenHeader title={names.stats} tint={tint} tabs={TABS} active={tab} onTab={setTab} />
      {!config ? (
        <Loading tint={tint} />
      ) : tab === 0 ? (
        <Activity config={config} />
      ) : tab === 1 ? (
        <Users config={config} />
      ) : tab === 2 ? (
        <HistoryList config={config} tint={tint} />
      ) : tab === 3 ? (
        <Stats config={config} />
      ) : (
        <Graphs config={config} />
      )}
    </Shell>
  );
}

function Activity({ config }: { config: ServiceConfig }) {
  const act = useLoad(() => tautulliApi.getActivity(config), [config]);
  usePoll(act.reload, 10_000);
  if (act.loading) return <Loading tint={tint} />;
  if (act.error && !act.data) return <Message text={act.error} error />;
  const a = act.data!;
  return (
    <ListFrame>
      <FlatList
        {...TV_LIST}
        data={a.sessions}
        keyExtractor={(s) => s.session_key}
        contentContainerStyle={listStyles.list}
        ListHeaderComponent={
          <View style={{ marginBottom: 10 }}>
            <StatTiles
              tint={tint}
              stats={[
                { label: 'Streams', value: a.stream_count },
                { label: 'Direct play', value: String(a.stream_count_direct_play) },
                { label: 'Transcodes', value: String(a.stream_count_transcode) },
                { label: 'Bandwidth', value: mbps(a.total_bandwidth) },
              ]}
            />
          </View>
        }
        ListEmptyComponent={<Message text="Nothing is playing right now." />}
        renderItem={({ item: s }) => {
          const thumb = tautulliImageUrl(config, { img: s.thumb, ratingKey: s.rating_key, width: 100, height: 150 });
          const title = s.grandparent_title ? `${s.grandparent_title} · S${s.parent_media_index} E${s.media_index} · ${s.title}` : s.full_title;
          return (
            <ListRow
              title={title}
              subtitle={`${s.friendly_name} · ${s.state} · ${s.transcode_decision}`}
              meta={`${s.progress_percent}%`}
              metaColor={tint}
              tint={tint}
              progress={Number(s.progress_percent) / 100}
              thumb={<Thumb uri={thumb} />}
            />
          );
        }}
      />
    </ListFrame>
  );
}

function Users({ config }: { config: ServiceConfig }) {
  const users = useLoad(() => tautulliApi.getUsersTable(config), [config]);
  if (users.loading) return <Loading tint={tint} />;
  return (
    <ListFrame>
      <FlatList
        {...TV_LIST}
        data={users.data?.data ?? []}
        keyExtractor={(u) => String(u.user_id)}
        contentContainerStyle={listStyles.list}
        ListEmptyComponent={<Message text={users.error ?? 'No users.'} error={!!users.error} />}
        renderItem={({ item: u }) => (
          <ListRow
            title={u.friendly_name}
            subtitle={u.last_played ? `Last played ${u.last_played}` : undefined}
            meta={`${u.plays} plays · ${formatDuration(u.duration)}`}
            metaColor={tint}
            icon="person"
            tint={tint}
            onPress={() => router.push(`/stats/user?id=${u.user_id}&name=${encodeURIComponent(u.friendly_name)}` as never)}
          />
        )}
      />
    </ListFrame>
  );
}

function Stats({ config }: { config: ServiceConfig }) {
  const stats = useLoad(() => tautulliApi.getHomeStats(config), [config]);
  if (stats.loading) return <Loading tint={tint} />;
  const group = (id: string): TautulliStatGroup | undefined => stats.data?.find((g) => g.stat_id === id);
  return (
    <ScrollView {...TV_LIST} contentContainerStyle={styles.cards}>
      {STAT_SECTIONS.map((sec, n) => {
        const rows = group(sec.id)?.rows.slice(0, 5) ?? [];
        return (
          <FocusCard key={sec.id} radius={14} scale={1.02} style={styles.card} preferredFocus={n === 0}>
            <Text style={styles.cardTitle}>{sec.title}</Text>
            {rows.length === 0 ? <Text style={styles.empty}>No data yet</Text> : null}
            {rows.map((r, i) => (
              <View key={i} style={styles.statRow}>
                <Text style={styles.rank}>{i + 1}</Text>
                <Thumb uri={tautulliImageUrl(config, { img: sec.image(r), ratingKey: r.rating_key, width: 100, height: 150 })} small />
                <Text style={styles.statTitle} numberOfLines={1}>
                  {r.title ?? r.friendly_name ?? r.user ?? 'Unknown'}
                </Text>
                <Text style={styles.statMetric}>{sec.metric(r)}</Text>
              </View>
            ))}
          </FocusCard>
        );
      })}
    </ScrollView>
  );
}

function Graphs({ config }: { config: ServiceConfig }) {
  const load = useCallback(
    () =>
      Promise.all([
        tautulliApi.getPlaysByDate(config, 30).catch(() => null),
        tautulliApi.getPlaysByDayOfWeek(config, 30).catch(() => null),
        tautulliApi.getPlaysByMonth(config, 12).catch(() => null),
      ]),
    [config]
  );
  const graphs = useLoad(load, [load]);
  if (graphs.loading) return <Loading tint={tint} />;
  const [byDate, byDow, byMonth] = graphs.data ?? [null, null, null];
  return (
    <ScrollView {...TV_LIST} contentContainerStyle={{ paddingHorizontal: SIDE, paddingBottom: 40, gap: 14 }}>
      <Graph title="Plays by Day" data={byDate} format={shortDate} first />
      <Graph title="Plays by Day of Week" data={byDow} />
      <Graph title="Plays by Month" data={byMonth} />
    </ScrollView>
  );
}

function Graph({ title, data, format, first }: { title: string; data: TautulliGraphData | null; format?: (c: string) => string; first?: boolean }) {
  const totals = data?.categories.map((_, i) => data.series.reduce((sum, s) => sum + (s.data[i] ?? 0), 0)) ?? [];
  const max = Math.max(1, ...totals);
  return (
    <FocusCard radius={14} scale={1.01} style={styles.graph} preferredFocus={first}>
      <Text style={styles.cardTitle}>{title}</Text>
      {!data || data.categories.length === 0 ? (
        <Text style={styles.empty}>No data yet</Text>
      ) : (
        <View style={styles.bars}>
          {data.categories.map((c, i) => (
            <View key={`${c}-${i}`} style={styles.barCol}>
              <Text style={styles.barValue}>{totals[i] || ''}</Text>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { height: `${Math.max(3, Math.round((totals[i] / max) * 100))}%` }]} />
              </View>
              <Text style={styles.barLabel} numberOfLines={1}>
                {format ? format(c) : c}
              </Text>
            </View>
          ))}
        </View>
      )}
    </FocusCard>
  );
}

const styles = StyleSheet.create({
  cards: { paddingHorizontal: SIDE, paddingBottom: 40, paddingTop: 6, flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  card: { width: 392, padding: 16, backgroundColor: colors.surface },
  cardTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 10 },
  empty: { color: colors.textMuted, fontSize: 14 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  rank: { color: colors.textMuted, fontSize: 14, fontWeight: '700', width: 16 },
  statTitle: { color: colors.textPrimary, fontSize: 14, flex: 1 },
  statMetric: { color: tint, fontSize: 13, fontWeight: '600' },
  graph: { padding: 16, backgroundColor: colors.surface },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 150 },
  barCol: { flex: 1, alignItems: 'center', height: '100%' },
  barValue: { color: colors.textSecondary, fontSize: 10, height: 14 },
  barTrack: { flex: 1, width: '70%', justifyContent: 'flex-end' },
  barFill: { width: '100%', borderRadius: 3, backgroundColor: tint },
  barLabel: { color: colors.textMuted, fontSize: 10, marginTop: 4 },
});
