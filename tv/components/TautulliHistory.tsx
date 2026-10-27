// Tautulli play history for the TV - the Stats History tab and a user's own page (pass `userId`).
// Paged like the phone's (more loads as focus nears the end); each play shows who, when, how much was
// watched and how it was streamed.
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { tautulliApi, TautulliHistoryItem, tautulliImageUrl } from '../../src/api/tautulli';
import { ServiceConfig } from '../../src/api/types';
import { colors } from '../../src/theme/colors';
import { listStyles } from './DownloadClientView';
import { errText, ListFrame, ListRow, Loading, Message, TV_LIST } from './ui';

const PAGE = 50;

export function Thumb({ uri, small }: { uri?: string; small?: boolean }) {
  const size = small ? { width: 26, height: 39 } : { width: 44, height: 66 };
  return (
    <View style={[size, { borderRadius: 5, overflow: 'hidden', backgroundColor: colors.surfaceAlt }]}>
      {uri ? <Image source={{ uri }} style={size} contentFit="cover" cachePolicy="memory-disk" /> : null}
    </View>
  );
}

export function HistoryList({ config, tint, userId }: { config: ServiceConfig; tint: string; userId?: number }) {
  const [items, setItems] = useState<TautulliHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (start: number) => {
      if (busy.current) return;
      busy.current = true;
      try {
        const res = await tautulliApi.getHistory(config, { start, length: PAGE, userId });
        setTotal(res.recordsFiltered);
        setItems((prev) => (start === 0 ? res.data : [...prev, ...res.data]));
        setError(null);
      } catch (e) {
        setError(errText(e));
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [config, userId]
  );

  useEffect(() => {
    load(0);
  }, [load]);

  if (loading) return <Loading tint={tint} />;
  return (
    <ListFrame>
      <FlatList
        {...TV_LIST}
        data={items}
        keyExtractor={(h, i) => `${h.row_id}-${i}`}
        contentContainerStyle={listStyles.list}
        onEndReached={() => items.length < total && load(items.length)}
        onEndReachedThreshold={1.5}
        ListEmptyComponent={<Message text={error ?? 'No history yet.'} error={!!error} />}
        renderItem={({ item: h }) => {
          const when = new Date(h.date * 1000);
          const title = h.grandparent_title ? `${h.grandparent_title} · S${h.parent_media_index} E${h.media_index} · ${h.title}` : h.full_title;
          return (
            <ListRow
              title={title}
              subtitle={`${h.friendly_name} · ${when.toLocaleDateString('en-US', { day: 'numeric', month: 'short' })} ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`}
              meta={`${h.percent_complete}%`}
              metaColor={h.watched_status ? colors.success : tint}
              thumb={<Thumb uri={tautulliImageUrl(config, { img: h.thumb, width: 100, height: 150 })} />}
            />
          );
        }}
      />
    </ListFrame>
  );
}
