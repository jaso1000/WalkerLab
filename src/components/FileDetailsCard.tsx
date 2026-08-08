// Shared expandable "downloaded file" card for movie/episode detail pages -
// collapsed shows size/quality/date, expanded reveals a full technical
// media-info grid (video/audio codec details) plus a delete action. Used by
// both Radarr and Sonarr file details despite each having its own
// `RadarrMediaInfo`/`SonarrMediaInfo` type, since the fields this component
// actually renders are identical between the two.
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Badge, BadgeTone } from './Badge';
import { formatBytes, formatDate } from '../lib/format';
import { colors } from '../theme/colors';

interface FileMediaInfo {
  audioBitrate?: number;
  audioChannels?: number;
  audioCodec?: string;
  audioLanguages?: string;
  audioStreamCount?: number;
  videoBitDepth?: number;
  videoBitrate?: number;
  videoCodec?: string;
  videoFps?: number;
  resolution?: string;
  videoDynamicRangeType?: string;
}

// One labeled tech-spec row in the expanded video/audio grid; renders
// nothing when the underlying field is missing, so an incomplete
// `mediaInfo` (Radarr/Sonarr don't always populate every field) just
// quietly omits that row instead of showing "Codec: undefined".
function InfoRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value?: string | number }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={13} color={colors.textSecondary} style={styles.infoIcon} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export function FileDetailsCard({
  fileName,
  size,
  qualityName,
  dateAdded,
  mediaInfo,
  expanded,
  onToggleExpand,
  onDelete,
  deleting = false,
  tint = colors.accent,
  badgeTone = 'accent',
}: {
  fileName?: string;
  size: number;
  qualityName: string;
  dateAdded?: string;
  mediaInfo?: FileMediaInfo;
  expanded: boolean;
  onToggleExpand: () => void;
  onDelete: () => void;
  deleting?: boolean;
  tint?: string;
  badgeTone?: BadgeTone;
}) {
  // Expansion state, delete handling, and the underlying data all live in
  // the caller - this component is purely a controlled presentational shell.
  return (
    <View style={styles.card}>
      {fileName ? (
        <Text style={styles.fileName} numberOfLines={2}>
          {fileName}
        </Text>
      ) : null}
      <TouchableOpacity style={styles.fileMetaRow} onPress={onToggleExpand}>
        <Badge label={formatBytes(size)} tone="success" />
        <Badge label={qualityName} tone={badgeTone} />
        {dateAdded ? <Text style={styles.fileDate}>{formatDate(dateAdded)}</Text> : null}
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={tint} style={styles.fileChevron} />
      </TouchableOpacity>

      {expanded && mediaInfo ? (
        <View style={styles.techGrid}>
          <View style={styles.techCol}>
            <Text style={styles.techHeader}>VIDEO</Text>
            <InfoRow icon="film-outline" label="Resolution" value={mediaInfo.resolution} />
            <InfoRow icon="film-outline" label="Codec" value={mediaInfo.videoCodec} />
            <InfoRow icon="film-outline" label="HDR Type" value={mediaInfo.videoDynamicRangeType} />
            <InfoRow icon="film-outline" label="Bit Depth" value={mediaInfo.videoBitDepth} />
            <InfoRow
              icon="film-outline"
              label="Bit Rate"
              value={mediaInfo.videoBitrate ? `${(mediaInfo.videoBitrate / 1000).toFixed(1)} Mbps` : undefined}
            />
            <InfoRow icon="film-outline" label="FPS" value={mediaInfo.videoFps} />
          </View>
          <View style={styles.techCol}>
            <Text style={styles.techHeader}>AUDIO</Text>
            <InfoRow icon="volume-medium-outline" label="Channels" value={mediaInfo.audioChannels} />
            <InfoRow icon="volume-medium-outline" label="Codec" value={mediaInfo.audioCodec} />
            <InfoRow icon="volume-medium-outline" label="Languages" value={mediaInfo.audioLanguages} />
            <InfoRow
              icon="volume-medium-outline"
              label="Bit Rate"
              value={mediaInfo.audioBitrate ? `${Math.round(mediaInfo.audioBitrate / 1000)} Kbps` : undefined}
            />
            <InfoRow icon="volume-medium-outline" label="Streams" value={mediaInfo.audioStreamCount} />
          </View>
        </View>
      ) : null}

      {expanded ? (
        <TouchableOpacity style={styles.deleteButton} onPress={onDelete} disabled={deleting}>
          <Ionicons name="trash" size={18} color="#fff" />
          <Text style={styles.deleteButtonText}>Delete File</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 14, padding: 16, margin: 16, marginTop: 14, gap: 8 },
  fileName: { color: colors.textPrimary, fontWeight: '700', fontSize: 15 },
  fileMetaRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  fileDate: { color: colors.textSecondary, fontSize: 12 },
  fileChevron: { marginLeft: 'auto' },
  techGrid: { flexDirection: 'row', gap: 16, marginTop: 8 },
  techCol: { flex: 1, gap: 2 },
  techHeader: { color: colors.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  infoIcon: { marginRight: 6 },
  infoLabel: { color: colors.textSecondary, fontSize: 12, flex: 1 },
  infoValue: { color: colors.textPrimary, fontSize: 12, fontWeight: '600' },
  deleteButton: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.danger,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  deleteButtonText: { color: '#fff', fontWeight: '700' },
});
