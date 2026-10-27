// SABnzbd / NZBGet on the TV - the phone's DownloadClientScreen through the same downloadClientApi
// adapter: Queue (speed and time left, pause/resume everything, per item Pause/Resume, Move up/down,
// Delete with confirmation) and History. OK on a queue item opens its action menu (the phone's
// long-press sheet). The queue refreshes every 3 seconds while on screen.
import { useState } from 'react';
import { FlatList, StyleSheet } from 'react-native';
import { ServiceConfig } from '../../src/api/types';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { alert } from '../../src/lib/alert';
import { DownloadClientKind, DownloadQueueItem, downloadClientApi } from '../../src/lib/downloadClient';
import { SectionId } from '../../src/lib/sectionNames';
import { colors } from '../../src/theme/colors';
import { Shell } from './Shell';
import { errText, ListFrame, ListRow, Loading, Message, NotConfigured, ScreenHeader, SIDE, SmallButton, TV_LIST, useLoad, usePoll } from './ui';

const TABS = ['Queue', 'History'] as const;

export function DownloadClientView({
  client,
  config,
  tint,
  sectionId,
  label,
}: {
  client: DownloadClientKind;
  config?: ServiceConfig;
  tint: string;
  sectionId: SectionId;
  label: string;
}) {
  const { names } = useSectionNames();
  const [tab, setTab] = useState(0);
  const queue = useLoad(() => downloadClientApi.getQueue(client, config!), [client, config], !!config);
  const history = useLoad(() => downloadClientApi.getHistory(client, config!), [client, config], !!config && tab === 1);
  usePoll(queue.reload, 3000, !!config && tab === 0);

  if (!config) {
    return (
      <Shell active={sectionId}>
        <NotConfigured service={label} />
      </Shell>
    );
  }

  const q = queue.data?.queue;
  const act = async (fn: () => Promise<unknown>, failTitle = 'Failed') => {
    try {
      await fn();
      queue.reload();
    } catch (e) {
      alert(failTitle, errText(e));
    }
  };

  const openMenu = (item: DownloadQueueItem, index: number, count: number) => {
    const paused = item.status.toLowerCase() === 'paused';
    alert(item.filename, `${item.status} · ${item.sizeleft} left of ${item.size}`, [
      { text: paused ? 'Resume' : 'Pause', onPress: () => act(() => (paused ? downloadClientApi.resumeItem(client, config, item) : downloadClientApi.pauseItem(client, config, item))) },
      ...(index > 0 ? [{ text: 'Move up', onPress: () => act(() => downloadClientApi.reorderQueue(client, config, item, 'up'), 'Failed to reorder') }] : []),
      ...(index < count - 1 ? [{ text: 'Move down', onPress: () => act(() => downloadClientApi.reorderQueue(client, config, item, 'down'), 'Failed to reorder') }] : []),
      {
        text: 'Delete',
        style: 'destructive' as const,
        onPress: () =>
          alert('Delete Download', `Remove "${item.filename}" from the queue?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => act(() => downloadClientApi.deleteFromQueue(client, config, item), 'Delete failed') },
          ]),
      },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  return (
    <Shell active={sectionId}>
      <ScreenHeader
        title={names[sectionId]}
        tint={tint}
        subtitle={q ? (q.paused ? 'Paused' : `${q.speed}B/s · ${q.timeleft} left · ${q.sizeleft} to go`) : undefined}
        tabs={TABS}
        active={tab}
        onTab={setTab}
        right={
          q && tab === 0 ? (
            <SmallButton
              icon={q.paused ? 'play' : 'pause'}
              label={q.paused ? 'Resume all' : 'Pause all'}
              tint={tint}
              onPress={() => act(() => (q.paused ? downloadClientApi.resumeQueue(client, config) : downloadClientApi.pauseQueue(client, config)))}
            />
          ) : undefined
        }
      />
      {tab === 0 ? (
        queue.loading ? (
          <Loading tint={tint} />
        ) : queue.error && !q ? (
          <Message text={queue.error} error />
        ) : (
          <ListFrame>
            <FlatList
              {...TV_LIST}
              data={q?.slots ?? []}
              keyExtractor={(i) => i.nzo_id}
              contentContainerStyle={styles.list}
              ListEmptyComponent={<Message text="Nothing downloading." />}
              renderItem={({ item, index }) => {
                const pct = Number(item.percentage) / 100;
                return (
                  <ListRow
                    title={item.filename}
                    subtitle={`${item.status} · ${item.sizeleft} left of ${item.size}`}
                    meta={`${Math.round(pct * 100)}% · ${item.timeleft}`}
                    metaColor={tint}
                    icon={item.status.toLowerCase() === 'paused' ? 'pause' : 'download'}
                    tint={tint}
                    progress={pct}
                    onPress={() => openMenu(item, index, q?.slots.length ?? 0)}
                  />
                );
              }}
            />
          </ListFrame>
        )
      ) : history.loading ? (
        <Loading tint={tint} />
      ) : (
        <ListFrame>
          <FlatList
            {...TV_LIST}
            data={history.data?.history.slots ?? []}
            keyExtractor={(i, n) => `${i.nzo_id}-${n}`}
            contentContainerStyle={styles.list}
            ListEmptyComponent={<Message text={history.error ?? 'No history yet.'} error={!!history.error} />}
            renderItem={({ item }) => {
              const failed = item.status.toLowerCase() === 'failed';
              return (
                <ListRow
                  title={item.name}
                  subtitle={failed && item.fail_message ? item.fail_message : item.storage || undefined}
                  meta={`${item.status} · ${item.size}`}
                  metaColor={failed ? colors.danger : colors.success}
                  icon={failed ? 'close-circle' : 'checkmark-circle'}
                  tint={failed ? colors.danger : colors.success}
                />
              );
            }}
          />
        </ListFrame>
      )}
    </Shell>
  );
}

export const listStyles = StyleSheet.create({
  list: { paddingHorizontal: SIDE, paddingTop: 10, paddingBottom: 40, gap: 10 },
});
const styles = listStyles;
