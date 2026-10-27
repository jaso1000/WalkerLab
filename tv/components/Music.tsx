// Music Discover's tiles on the TV (the phone's ArtistRow / AlbumRow). Last.fm has no usable artist
// images, so an artist tile resolves its own art from iTunes by name once it mounts, as the phone's
// cards do; iTunes' lookups are cached per name in src/api/itunes.
import { useEffect, useState } from 'react';
import { itunesApi } from '../../src/api/itunes';
import { colors } from '../../src/theme/colors';
import { PosterTile } from './Cards';
import { Row } from './Row';
import { DiscoverSeeAll } from './DiscoverRows';

export function useArtistArt(name: string) {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    itunesApi.searchArtistArtwork(name).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [name]);
  return url;
}

export function ArtistTile({
  name,
  poster,
  subtitle,
  onPress,
  onFocus,
  preferredFocus,
}: {
  name: string;
  /** Known art (a Lidarr artist's own); otherwise looked up on iTunes. */
  poster?: string;
  subtitle?: string;
  onPress: () => void;
  onFocus?: () => void;
  preferredFocus?: boolean;
}) {
  const looked = useArtistArt(poster ? '' : name);
  return <PosterTile title={name} poster={poster ?? looked} recyclingKey={`artist-${name}`} subtitle={subtitle} onPress={onPress} onFocus={onFocus} preferredFocus={preferredFocus} />;
}

export interface ArtistTileItem {
  name: string;
  /** A Lidarr id, when the artist is in the library. */
  id?: number;
  poster?: string;
  subtitle?: string;
}

/** Opens an artist: the library page if it's in Lidarr, else the Discover page by name. */
export const artistHref = (a: { name: string; id?: number }) => (a.id ? `/music/${a.id}` : `/discover/music/artist?name=${encodeURIComponent(a.name)}`);

export function ArtistRow({
  title,
  items,
  onPressItem,
  onSeeAll,
  preferredFocus,
}: {
  title: string;
  items: ArtistTileItem[];
  onPressItem: (a: ArtistTileItem) => void;
  onSeeAll?: () => void;
  preferredFocus?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <Row title={title} accent={colors.sectionGreen}>
      {items.map((a, i) => (
        <ArtistTile key={`${a.id ?? ''}-${a.name}`} name={a.name} poster={a.poster} subtitle={a.subtitle} onPress={() => onPressItem(a)} preferredFocus={preferredFocus && i === 0} />
      ))}
      {onSeeAll ? <DiscoverSeeAll onPress={onSeeAll} /> : null}
    </Row>
  );
}
