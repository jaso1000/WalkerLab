// The Home dashboard's three card types: a poster (episodes and movies), a download in progress,
// and a stream playing on Plex. Colours come from the shared palette (src/theme/colors), each row
// in its service's own colour, as on the phone.
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TautulliSession } from '../../src/api/tautulli';
import { colors } from '../../src/theme/colors';
import { PosterItem, QueueItem } from '../lib/dashboard';
import { FocusCard } from './FocusCard';

export const POSTER_W = 128;
export const POSTER_H = 192;

/** "Tonight 8PM", "Tomorrow", "Fri 8:30PM", "Nov 3"; days only for movies; "2h ago" for imports. */
export function whenLabel(item: PosterItem, past = false): string {
  const t = new Date(item.when);
  if (past) {
    const mins = Math.round((Date.now() - item.when) / 60000);
    if (mins < 60) return `${Math.max(1, mins)}m ago`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
    return `${Math.round(mins / 1440)}d ago`;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(t);
  day.setHours(0, 0, 0, 0);
  const days = Math.round((day.getTime() - today.getTime()) / 86400000);
  const time = t
    .toLocaleTimeString('en-US', { hour: 'numeric', minute: t.getMinutes() ? '2-digit' : undefined })
    .replace(' ', '');
  let label: string;
  if (days <= 0) label = !item.allDay && t.getHours() >= 17 ? 'Tonight' : 'Today';
  else if (days === 1) label = 'Tomorrow';
  else if (days < 7) label = t.toLocaleDateString('en-US', { weekday: 'short' });
  else return t.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return item.allDay ? label : `${label} ${time}`;
}

export interface Badge {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

/**
 * Discover's poster card at TV size: the poster with a round status badge in its corner (the same
 * icons and colours as the phone's libraryStatus badges), then the title on up to two lines and one
 * line of detail under it.
 */
export function PosterTile({
  title,
  poster,
  recyclingKey,
  subtitle,
  badge,
  onPress,
  onFocus,
  preferredFocus,
}: {
  title: string;
  poster?: string;
  recyclingKey: string;
  subtitle?: React.ReactNode;
  badge?: Badge;
  onPress?: () => void;
  onFocus?: () => void;
  preferredFocus?: boolean;
}) {
  return (
    <View style={{ width: POSTER_W }}>
      <FocusCard style={styles.poster} onPress={onPress} onFocus={onFocus} preferredFocus={preferredFocus} focusMargin={16}>
        {poster ? (
          <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" recyclingKey={recyclingKey} transition={120} />
        ) : (
          <Text style={styles.posterFallback} numberOfLines={4}>
            {title}
          </Text>
        )}
        {badge ? (
          <View style={[styles.badge, { backgroundColor: badge.color }]}>
            <Ionicons name={badge.icon} size={14} color={colors.background} />
          </View>
        ) : null}
      </FocusCard>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={styles.cardSub} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

export const DOWNLOADED_BADGE: Badge = { icon: 'checkmark', color: colors.success };

/** A Home dashboard poster: when it airs or arrived, and the episode or release type. */
export function PosterCard({ item, past, preferredFocus }: { item: PosterItem; past?: boolean; preferredFocus?: boolean }) {
  return (
    <PosterTile
      title={item.title}
      poster={item.poster}
      recyclingKey={item.key}
      badge={item.hasFile && !past ? DOWNLOADED_BADGE : undefined}
      subtitle={
        <>
          <Text style={styles.cardWhen}>{whenLabel(item, past)}</Text>
          {item.detail ? `  ·  ${item.detail}` : ''}
        </>
      }
      onPress={item.href ? () => router.push(item.href as never) : undefined}
      preferredFocus={preferredFocus}
    />
  );
}

const SOURCE_COLOR: Record<QueueItem['source'], string> = {
  sonarr: colors.sonarr,
  radarr: colors.accent,
  sabnzbd: colors.sabnzbd,
};

// Sonarr/Radarr report a tracked-download state in camelCase; SABnzbd its own words.
const STATE_LABEL: Record<string, string> = {
  downloading: 'Downloading',
  importPending: 'Import pending',
  importing: 'Importing',
  importBlocked: 'Import blocked',
  imported: 'Imported',
  failedPending: 'Failed',
  failed: 'Failed',
  ignored: 'Ignored',
  paused: 'Paused',
  queued: 'Queued',
  delay: 'Delayed',
};
const PROBLEM_STATES = new Set(['importBlocked', 'failedPending', 'failed', 'warning']);

export function QueueCard({ item }: { item: QueueItem }) {
  const tint = SOURCE_COLOR[item.source];
  const label = STATE_LABEL[item.status] ?? item.status;
  // A finished download reports 00:00:00 left: say nothing rather than a zero clock.
  const timeleft = item.timeleft && !/^0?0:00:00$/.test(item.timeleft) ? item.timeleft : undefined;
  const problem = PROBLEM_STATES.has(item.status);
  return (
    <FocusCard style={styles.wide} onPress={item.href ? () => router.push(item.href as never) : undefined}>
      <Text style={styles.wideTitle} numberOfLines={1}>
        {item.title}
      </Text>
      <Text style={styles.wideSub} numberOfLines={1}>
        {item.subtitle}
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(item.progress * 100)}%`, backgroundColor: tint }]} />
      </View>
      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: tint }]}>{Math.round(item.progress * 100)}%</Text>
        <Text style={[styles.meta, problem && { color: colors.danger }]} numberOfLines={1}>
          {[label, timeleft].filter(Boolean).join('  ·  ')}
        </Text>
      </View>
    </FocusCard>
  );
}

export function NowPlayingCard({ session }: { session: TautulliSession }) {
  const progress = Math.max(0, Math.min(1, Number(session.progress_percent) / 100 || 0));
  const title = session.grandparent_title
    ? `${session.grandparent_title} · S${session.parent_media_index} E${session.media_index}`
    : session.full_title;
  return (
    <FocusCard style={styles.wide}>
      <Text style={styles.wideTitle} numberOfLines={1}>
        {title}
      </Text>
      <Text style={styles.wideSub} numberOfLines={1}>
        {session.friendly_name}  ·  {session.state}  ·  {session.transcode_decision}
      </Text>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(progress * 100)}%`, backgroundColor: colors.tautulli }]} />
      </View>
    </FocusCard>
  );
}

const styles = StyleSheet.create({
  poster: { width: POSTER_W, height: POSTER_H, alignItems: 'center', justifyContent: 'center' },
  posterFallback: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', padding: 10 },
  badge: {
    position: 'absolute',
    top: 7,
    right: 7,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '600', marginTop: 9, lineHeight: 18 },
  cardSub: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  cardWhen: { color: colors.textPrimary },
  wide: { width: 300, height: 104, padding: 14, backgroundColor: colors.surfaceAlt },
  wideTitle: { color: colors.textPrimary, fontSize: 15, fontWeight: '600' },
  wideSub: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.border, marginTop: 12, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 7, gap: 10 },
  meta: { color: colors.textMuted, fontSize: 11 },
});
