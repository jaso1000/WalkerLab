// Storage for Spin's saved wheels - per-profile, growable, named user
// records (modeled on `profiles.ts`'s own list-of-records shape, not
// `sectionNames.ts`'s single-value shape). Operates per-wheel
// (save/delete one at a time) rather than a whole-array replace, unlike
// most other per-profile stores in this app - `shared` needs that: a
// wheel marked shared can live under a DIFFERENT user's account entirely
// (see server/src/store.ts's saveWheel/deleteWheel), so there's no single
// "whole array" the client could coherently PUT back.
//
// Each wheel item is a snapshot (title/poster captured at add-time), not a
// live Sonarr/Radarr reference - a saved wheel has no live library fetch
// backing it at spin time, and library items can be removed at any point
// (see deletedLibrary.ts/libraryStatus.ts for this app's existing "item
// may no longer exist" reality), so a wheel needs to keep rendering/
// spinning correctly even after the source item is gone. `libraryId` is
// each service's own internal id (Radarr movie id / Sonarr series id),
// not a tmdbId - Sonarr series carry no tmdbId at all (only tvdbId), so
// using the local id keeps this feature independent of TMDB being
// configured, and doubles as exactly what `/movie/[id]`/`/series/[id]`
// need to open the item. `tmdbId` is the alternative for an item added
// from the wheel builder's TMDB tab - a title you don't (yet) have in your
// library at all, so there's no local id to snapshot; exactly one of
// `libraryId`/`tmdbId` is ever set on a given item, see `wheelItemHref`.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { apiFetch } from './backendApi';
import { profileKey } from './profileStorage';

export type WheelItemMediaType = 'movie' | 'tv';

export interface WheelItem {
  id: string; // `${mediaType}-${libraryId}` for library items, `${mediaType}-tmdb-${tmdbId}` for TMDB-only items - unique within one wheel
  mediaType: WheelItemMediaType;
  libraryId?: number;
  tmdbId?: number;
  title: string;
  posterUrl?: string;
}

// Where a wheel item's own detail page lives - TMDB's own Discover detail
// page (works for any title, whether or not it's in your library) for
// items added from the TMDB tab, the local Sonarr/Radarr detail page
// otherwise.
export function wheelItemHref(item: WheelItem): string {
  if (item.tmdbId != null) return `/discover/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`;
  return item.mediaType === 'movie' ? `/movie/${item.libraryId}` : `/series/${item.libraryId}`;
}

export interface Wheel {
  id: string;
  name: string;
  items: WheelItem[];
  removeAfterSpin: boolean;
  // Web/multi-user only - makes this wheel visible to, and fully
  // editable/deletable by, every other user on this instance, not just
  // its creator. Always `false` and inert on native (no other users to
  // share with there) - the sharing UI itself is gated to web only.
  shared: boolean;
  createdAt: string;
  updatedAt: string;
}

const keyFor = (profileId: string) => profileKey(profileId, 'walkerlab_wheels');

async function getOwnWheelsNative(profileId: string): Promise<Wheel[]> {
  const raw = await AsyncStorage.getItem(keyFor(profileId));
  return raw ? (JSON.parse(raw) as Wheel[]) : [];
}

// On web this returns the caller's own wheels PLUS every other user's
// wheel marked `shared` (see server/src/store.ts's getVisibleWheels) -
// sharing is a multi-user, web-only concept, so native just returns the
// caller's own list, same as before this feature existed.
export async function getWheels(profileId: string): Promise<Wheel[]> {
  if (Platform.OS === 'web') {
    return apiFetch<Wheel[]>(`/api/wheels/${profileId}`);
  }
  return getOwnWheelsNative(profileId);
}

// Creates or updates exactly one wheel. Web: a dedicated per-wheel PUT -
// the server resolves whether this is the caller's own wheel or an
// existing shared one (allowed either way) versus someone else's
// unshared wheel (rejected), see configRoutes.ts/store.ts. Native: a
// plain read-modify-write of the profile's own array, since there's no
// concept of another user's data to resolve against.
export async function saveWheel(profileId: string, wheel: Wheel): Promise<void> {
  if (Platform.OS === 'web') {
    await apiFetch(`/api/wheels/${profileId}/${wheel.id}`, { method: 'PUT', body: wheel });
    return;
  }
  const existing = await getOwnWheelsNative(profileId);
  const index = existing.findIndex((w) => w.id === wheel.id);
  const next = index === -1 ? [...existing, wheel] : existing.map((w, i) => (i === index ? wheel : w));
  await AsyncStorage.setItem(keyFor(profileId), JSON.stringify(next));
}

export async function deleteWheel(profileId: string, wheelId: string): Promise<void> {
  if (Platform.OS === 'web') {
    await apiFetch(`/api/wheels/${profileId}/${wheelId}`, { method: 'DELETE' });
    return;
  }
  const existing = await getOwnWheelsNative(profileId);
  await AsyncStorage.setItem(keyFor(profileId), JSON.stringify(existing.filter((w) => w.id !== wheelId)));
}

// Same shape as newProfileId()/newUserId() - good enough for a self-hosted
// app with a handful of wheels, no need for a real UUID library.
export function newWheelId(): string {
  return `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
