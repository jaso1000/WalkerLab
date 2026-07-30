import AsyncStorage from '@react-native-async-storage/async-storage';

// Radarr/Sonarr don't reliably retain "this was once in the library" once an
// item is removed, so Discover's "Deleted" badge (PLAN.md item 24) needs its
// own local record, written the moment something is removed via the movie/
// series detail pages. Movies are keyed by tmdbId (Radarr tracks it
// natively). Series are keyed by BOTH tvdbId (Sonarr's own identifier) and,
// best-effort, tmdbId - Discover's TV cards only carry a tmdbId, and once a
// show is removed there's no live Sonarr record left to resolve tvdbId ->
// tmdbId from later, so the tmdbId has to be captured at delete time.

const MOVIE_KEY = 'walkerlab_deleted_movies';
const SERIES_KEY = 'walkerlab_deleted_series';
const SERIES_TMDB_KEY = 'walkerlab_deleted_series_tmdb';

// Loads the id set stored under `key`, defaulting to empty when nothing's
// been written yet.
async function readSet(key: string): Promise<Set<number>> {
  const raw = await AsyncStorage.getItem(key);
  return new Set(raw ? (JSON.parse(raw) as number[]) : []);
}

// Persists an id set back to AsyncStorage as a plain JSON array.
async function writeSet(key: string, set: Set<number>): Promise<void> {
  await AsyncStorage.setItem(key, JSON.stringify(Array.from(set)));
}

// Read-modify-write helper: adds one id to the set stored under `key`.
async function addTo(key: string, id: number): Promise<void> {
  const set = await readSet(key);
  set.add(id);
  await writeSet(key, set);
}

// Read-modify-write helper: removes one id from the set stored under `key`
// (called when something is re-added to the library, clearing its
// "previously deleted" flag).
async function removeFrom(key: string, id: number): Promise<void> {
  const set = await readSet(key);
  set.delete(id);
  await writeSet(key, set);
}

// Public API consumed by the movie/series detail pages (to mark/unmark) and
// Discover (to read, when building poster status badges).
export const deletedLibrary = {
  getDeletedMovieIds: () => readSet(MOVIE_KEY),
  getDeletedSeriesIds: () => readSet(SERIES_KEY),
  getDeletedSeriesTmdbIds: () => readSet(SERIES_TMDB_KEY),

  markMovieDeleted: (tmdbId: number) => addTo(MOVIE_KEY, tmdbId),
  unmarkMovieDeleted: (tmdbId: number) => removeFrom(MOVIE_KEY, tmdbId),

  markSeriesDeleted: (tvdbId: number) => addTo(SERIES_KEY, tvdbId),
  unmarkSeriesDeleted: (tvdbId: number) => removeFrom(SERIES_KEY, tvdbId),

  markSeriesDeletedByTmdbId: (tmdbId: number) => addTo(SERIES_TMDB_KEY, tmdbId),
  unmarkSeriesDeletedByTmdbId: (tmdbId: number) => removeFrom(SERIES_TMDB_KEY, tmdbId),
};
