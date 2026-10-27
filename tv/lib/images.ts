// Artwork URLs sized for a TV. Sonarr/Radarr report each image's original (often several MB); the
// hosts serve smaller copies at predictable paths, and a TV row has no use for the full size.
// The servers' own /MediaCover copies need a browser login rather than the API key, so the phone
// app and this one both use the remote URLs.
import { LidarrImage, lidarrImageUrl } from '../../src/api/lidarr';
import { ServiceConfig } from '../../src/api/types';

type Img = { coverType: string; remoteUrl?: string };

function remote(images: Img[] | undefined, type: string): string | undefined {
  return images?.find((i) => i.coverType === type)?.remoteUrl;
}

/** TMDB at `size` instead of `original`; TheTVDB's `_t` thumbnail for posters. */
function sized(url: string | undefined, tmdbSize: string, tvdbThumb: boolean): string | undefined {
  if (!url) return undefined;
  if (url.includes('image.tmdb.org/t/p/original/')) return url.replace('/t/p/original/', `/t/p/${tmdbSize}/`);
  if (tvdbThumb && url.includes('artworks.thetvdb.com/') && url.endsWith('.jpg') && !url.endsWith('_t.jpg')) {
    return url.slice(0, -4) + '_t.jpg';
  }
  return url;
}

export const posterUrl = (images?: Img[]) => sized(remote(images, 'poster'), 'w342', true);
/** The detail page's backdrop: 1280 wide is plenty under the scrim. */
export const backdropUrl = (images?: Img[]) => sized(remote(images, 'fanart'), 'w1280', false);
/** A show's transparent title logo, where Sonarr has one. */
export const logoUrl = (images?: Img[]) => sized(remote(images, 'clearlogo'), 'w500', false);

/** Lidarr art goes through its own resolver (remote URL, else the server's mediacover with the API key). */
export const artistImage = (a: { id: number; images: LidarrImage[] }, config: ServiceConfig, type = 'poster', size = 250) =>
  lidarrImageUrl(a.images.find((i) => i.coverType === type) ?? (type === 'poster' ? a.images[0] : undefined), config, { type: 'artist', id: a.id }, size);
export const albumImage = (a: { id: number; images: LidarrImage[] }, config: ServiceConfig, size = 250) =>
  lidarrImageUrl(a.images.find((i) => i.coverType === 'cover') ?? a.images[0], config, { type: 'album', id: a.id }, size);
