// Discover's one-step "add to library": the movie goes to Radarr or the show to Sonarr with the
// last-used quality profile (else the first) and the first root folder, no picker. Shared by the
// phone's Discover search results (app/discover.tsx) and the Android TV app's Discover detail page,
// so an add from either behaves the same. Throws with a user-facing message on failure.
import { radarrApi } from '../api/radarr';
import { sonarrApi } from '../api/sonarr';
import { tmdbApi } from '../api/tmdb';
import { ServiceConfig } from '../api/types';
import { deletedLibrary } from './deletedLibrary';
import { MediaKind } from './discoverCategories';
import { getLastQualityProfileId, setLastQualityProfileId } from './preferences';

export async function quickAddToLibrary(
  configs: { tmdb?: ServiceConfig; radarr?: ServiceConfig; sonarr?: ServiceConfig },
  tmdbId: number,
  mediaType: MediaKind
): Promise<void> {
  if (mediaType === 'movie') {
    if (!configs.radarr) throw new Error('Radarr isn’t connected.');
    const [profiles, folders, matches] = await Promise.all([
      radarrApi.getQualityProfiles(configs.radarr),
      radarrApi.getRootFolders(configs.radarr),
      radarrApi.searchMovies(configs.radarr, `tmdb:${tmdbId}`),
    ]);
    const match = matches[0];
    if (!match || !profiles[0] || !folders[0]) throw new Error('Could not resolve defaults for this movie.');
    const remembered = await getLastQualityProfileId('radarr');
    const qualityProfileId = profiles.find((p) => p.id === remembered)?.id ?? profiles[0].id;
    await radarrApi.addMovie(configs.radarr, {
      title: match.title,
      tmdbId: match.tmdbId,
      qualityProfileId,
      rootFolderPath: folders[0].path,
    });
    await deletedLibrary.unmarkMovieDeleted(tmdbId);
    await setLastQualityProfileId('radarr', qualityProfileId);
  } else {
    if (!configs.sonarr || !configs.tmdb) throw new Error('Sonarr isn’t connected.');
    const ids = await tmdbApi.tvExternalIds(configs.tmdb, tmdbId);
    if (!ids.tvdb_id) throw new Error("This show couldn't be matched to TheTVDB.");
    const [profiles, folders, matches] = await Promise.all([
      sonarrApi.getQualityProfiles(configs.sonarr),
      sonarrApi.getRootFolders(configs.sonarr),
      sonarrApi.searchSeries(configs.sonarr, `tvdb:${ids.tvdb_id}`),
    ]);
    const match = matches[0];
    if (!match || !profiles[0] || !folders[0]) throw new Error('Could not resolve defaults for this show.');
    const remembered = await getLastQualityProfileId('sonarr');
    const qualityProfileId = profiles.find((p) => p.id === remembered)?.id ?? profiles[0].id;
    await sonarrApi.addSeries(configs.sonarr, {
      title: match.title,
      tvdbId: ids.tvdb_id,
      qualityProfileId,
      rootFolderPath: folders[0].path,
    });
    await deletedLibrary.unmarkSeriesDeleted(ids.tvdb_id);
    await deletedLibrary.unmarkSeriesDeletedByTmdbId(tmdbId);
    await setLastQualityProfileId('sonarr', qualityProfileId);
  }
}
