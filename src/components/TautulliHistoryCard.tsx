// Shared playback-history card for Tautulli's History tab and the per-user
// watch-history screen (`app/tautulli/user/[id].tsx`) - poster, title, who
// watched it, and how far they got, so the same markup can't drift between
// the two places it's used.
import { memo } from 'react';
import { Image } from 'expo-image';
import { StyleSheet, Text, View } from 'react-native';
import { ServiceConfig } from '../api/types';
import { TautulliHistoryItem, tautulliImageUrl } from '../api/tautulli';
import { colors } from '../theme/colors';

export const TautulliHistoryCard = memo(function TautulliHistoryCard({
  item,
  config,
}: {
  item: TautulliHistoryItem;
  config: ServiceConfig;
}) {
  const posterUrl = tautulliImageUrl(config, { img: item.thumb, width: 120, height: 180 });
  const date = new Date(item.date * 1000);
  const dateLabel = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const percent = Math.max(0, Math.min(100, Math.round(item.percent_complete)));

  return (
    <View style={styles.card}>
      {posterUrl ? (
        <Image source={{ uri: posterUrl }} style={styles.poster} cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.poster, styles.posterPlaceholder]} />
      )}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {item.full_title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {item.friendly_name}
          {dateLabel ? ` · ${dateLabel}` : ''}
        </Text>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${percent}%` }]} />
        </View>
        <Text style={styles.percent}>{percent}% watched</Text>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: 14, padding: 10 },
  poster: { width: 54, height: 81, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  posterPlaceholder: {},
  info: { flex: 1, justifyContent: 'center', gap: 4 },
  title: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceAlt, marginTop: 4, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2, backgroundColor: colors.tautulli },
  percent: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
});
