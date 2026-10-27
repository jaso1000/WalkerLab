// A downloaded file's details as text for a TV dialog - the phone's FileDetailsCard (path, size,
// quality, date added, then the video and audio media info Radarr/Sonarr report).
import { formatBytes, formatDate } from '../../src/lib/format';

interface FileLike {
  relativePath?: string;
  size: number;
  dateAdded?: string;
  quality: { quality: { name: string } };
  mediaInfo?: {
    audioChannels?: number;
    audioCodec?: string;
    audioLanguages?: string;
    videoBitDepth?: number;
    videoBitrate?: number;
    videoCodec?: string;
    videoFps?: number;
    resolution?: string;
    videoDynamicRangeType?: string;
  };
}

export function fileDetailsText(f: FileLike): string {
  const m = f.mediaInfo;
  const line = (label: string, value?: string | number | null) => (value === undefined || value === null || value === '' ? null : `${label}: ${value}`);
  return [
    f.relativePath,
    '',
    line('Size', formatBytes(f.size)),
    line('Quality', f.quality.quality.name),
    line('Added', f.dateAdded ? formatDate(f.dateAdded) : undefined),
    line('Resolution', m?.resolution),
    line('Video', [m?.videoCodec, m?.videoDynamicRangeType, m?.videoBitDepth ? `${m.videoBitDepth}-bit` : '', m?.videoFps ? `${m.videoFps} fps` : ''].filter(Boolean).join(' · ')),
    line('Video bitrate', m?.videoBitrate ? `${(m.videoBitrate / 1_000_000).toFixed(1)} Mbps` : undefined),
    line('Audio', [m?.audioCodec, m?.audioChannels ? `${m.audioChannels} ch` : ''].filter(Boolean).join(' · ')),
    line('Audio languages', m?.audioLanguages),
  ]
    .filter((x) => x !== null && x !== undefined)
    .join('\n')
    .trim();
}
