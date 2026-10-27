// qBittorrent / Transmission on the TV - the phone's TorrentClientScreen through the shared
// torrentClientApi adapter: the same tabs (All / Active / Downloading / Finished / Error), speeds,
// progress and ETA, and per torrent Pause/Resume and Delete (Remove only, or remove and delete files).
// Refreshes every 3 seconds while on screen, as on the phone.
import { useState } from 'react';
import { FlatList } from 'react-native';
import { ServiceConfig } from '../../src/api/types';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { alert } from '../../src/lib/alert';
import { formatBytes } from '../../src/lib/format';
import { SectionId } from '../../src/lib/sectionNames';
import { TORRENT_TABS, TorrentClientKind, TorrentItem, torrentClientApi } from '../../src/lib/torrentClient';
import { colors } from '../../src/theme/colors';
import { listStyles } from './DownloadClientView';
import { Shell } from './Shell';
import { errText, ListFrame, ListRow, Loading, Message, NotConfigured, ScreenHeader, TV_LIST, useLoad, usePoll } from './ui';

const TONE_COLOR: Record<string, string> = {
  danger: colors.danger,
  muted: colors.textMuted,
  success: colors.success,
  info: colors.info,
  accent: colors.accent,
};

const speed = (bps: number) => (bps > 0 ? `${formatBytes(bps)}/s` : '');
function eta(seconds: number | null): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function TorrentClientView({
  client,
  config,
  tint,
  sectionId,
  label,
}: {
  client: TorrentClientKind;
  config?: ServiceConfig;
  tint: string;
  sectionId: SectionId;
  label: string;
}) {
  const { names } = useSectionNames();
  const [tab, setTab] = useState(0);
  const key = TORRENT_TABS[tab].key;
  const list = useLoad(() => torrentClientApi.listTorrents(client, config!, key), [client, config, key], !!config);
  usePoll(list.reload, 3000, !!config);

  if (!config) {
    return (
      <Shell active={sectionId}>
        <NotConfigured service={label} />
      </Shell>
    );
  }

  const act = async (fn: () => Promise<unknown>, failTitle = 'Failed') => {
    try {
      await fn();
      list.reload();
    } catch (e) {
      alert(failTitle, errText(e));
    }
  };

  const openMenu = (item: TorrentItem) =>
    alert(item.name, `${item.stateLabel} · ${Math.round(item.progress * 100)}% of ${formatBytes(item.size)} · ratio ${item.ratio.toFixed(2)}`, [
      {
        text: item.isPaused ? 'Resume' : 'Pause',
        onPress: () => act(() => (item.isPaused ? torrentClientApi.resume(client, config, [item.id]) : torrentClientApi.pause(client, config, [item.id]))),
      },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          alert('Delete Torrent', `Remove "${item.name}" from ${label}?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Remove Only', onPress: () => act(() => torrentClientApi.remove(client, config, [item.id], false), 'Delete failed') },
            { text: 'Remove and delete files', style: 'destructive', onPress: () => act(() => torrentClientApi.remove(client, config, [item.id], true), 'Delete failed') },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const items = list.data ?? [];
  const down = items.reduce((n, t) => n + t.dlspeed, 0);
  const up = items.reduce((n, t) => n + t.upspeed, 0);

  return (
    <Shell active={sectionId}>
      <ScreenHeader
        title={names[sectionId]}
        tint={tint}
        count={items.length}
        subtitle={`↓ ${speed(down) || '0'}   ↑ ${speed(up) || '0'}`}
        tabs={TORRENT_TABS.map((t) => t.label)}
        active={tab}
        onTab={setTab}
      />
      {list.loading ? (
        <Loading tint={tint} />
      ) : list.error && !list.data ? (
        <Message text={list.error} error />
      ) : (
        <ListFrame>
          <FlatList
            {...TV_LIST}
            data={items}
            keyExtractor={(i) => i.id}
            contentContainerStyle={listStyles.list}
            ListEmptyComponent={<Message text={TORRENT_TABS[tab].empty} />}
            renderItem={({ item }) => {
              const color = TONE_COLOR[item.tone] ?? tint;
              return (
                <ListRow
                  title={item.name}
                  subtitle={[item.stateLabel, formatBytes(item.size), speed(item.dlspeed) && `↓ ${speed(item.dlspeed)}`, speed(item.upspeed) && `↑ ${speed(item.upspeed)}`, eta(item.eta)]
                    .filter(Boolean)
                    .join('  ·  ')}
                  meta={`${Math.round(item.progress * 100)}%`}
                  metaColor={color}
                  icon={item.isPaused ? 'pause' : item.progress >= 1 ? 'arrow-up' : 'arrow-down'}
                  tint={color}
                  progress={item.progress}
                  onPress={() => openMenu(item)}
                />
              );
            }}
          />
        </ListFrame>
      )}
    </Shell>
  );
}
