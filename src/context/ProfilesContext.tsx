// Top-level provider for Server Profiles - owns the list of profiles and
// which one is active. Every other profile-scoped context/screen
// (ServersContext, SectionNamesContext, ServiceEnabledContext, startup
// screen) reads `activeProfileId` from here and re-fetches its own
// profile-scoped data whenever it changes, which is what makes switching
// profiles feel like a live app-wide reload without an actual restart.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  getActiveProfileId,
  getProfiles,
  newProfileId,
  Profile,
  setActiveProfileId as persistActiveProfileId,
  setProfiles as persistProfiles,
} from '../lib/profiles';

interface ProfilesContextValue {
  profiles: Profile[];
  activeProfileId: string;
  activeProfile: Profile;
  loading: boolean;
  switchProfile: (id: string) => Promise<void>;
  addProfile: (name: string) => Promise<string>;
  renameProfile: (id: string, name: string) => Promise<void>;
  deleteProfile: (id: string) => Promise<void>;
}

const ProfilesContext = createContext<ProfilesContextValue | undefined>(undefined);

export function ProfilesProvider({ children }: { children: React.ReactNode }) {
  // Default state mirrors `DEFAULT_PROFILES` in `lib/profiles.ts` so the app
  // has something sane to render before the real async load finishes.
  const [profiles, setProfilesState] = useState<Profile[]>([{ id: 'default', name: 'Home Lab' }]);
  const [activeProfileId, setActiveProfileIdState] = useState('default');
  const [loading, setLoading] = useState(true);

  // One-time load on mount. Falls back to the first available profile if
  // the previously-active id no longer exists (e.g. it was deleted in a way
  // that didn't go through `deleteProfile`, or storage got out of sync).
  useEffect(() => {
    (async () => {
      const [loadedProfiles, loadedActiveId] = await Promise.all([getProfiles(), getActiveProfileId()]);
      setProfilesState(loadedProfiles);
      setActiveProfileIdState(loadedProfiles.some((p) => p.id === loadedActiveId) ? loadedActiveId : loadedProfiles[0].id);
      setLoading(false);
    })();
  }, []);

  // Changes which profile is active - every profile-scoped context re-reads
  // its own data in response to `activeProfileId` changing, which is what
  // makes this feel like a live full-app reload.
  const switchProfile = useCallback(async (id: string) => {
    setActiveProfileIdState(id);
    await persistActiveProfileId(id);
  }, []);

  // These three all read `profiles` via the functional setState form (not
  // the closed-over `profiles` variable) and persist whatever that produces.
  // Callers like the restore flow call addProfile immediately followed by
  // renameProfile in the same handler, before React has re-rendered with the
  // new list - closing over `profiles` directly meant renameProfile's `next`
  // was computed from a stale (pre-add) snapshot, silently dropping the
  // just-added profile when it persisted.
  // Creates a new profile and immediately switches to it (used by both
  // "New Profile" and the restore-from-backup flow, which calls this then
  // `renameProfile` right after - see the stale-closure note above).
  const addProfile = useCallback(
    async (name: string) => {
      const id = newProfileId();
      let next: Profile[] = [];
      setProfilesState((prev) => {
        next = [...prev, { id, name: name.trim() || 'New Profile' }];
        return next;
      });
      await persistProfiles(next);
      await switchProfile(id);
      return id;
    },
    [switchProfile]
  );

  // Renames an existing profile in place; a blank/whitespace-only name is
  // silently ignored rather than saved.
  const renameProfile = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    let next: Profile[] = [];
    setProfilesState((prev) => {
      next = prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p));
      return next;
    });
    await persistProfiles(next);
  }, []);

  // Deletes a profile, refusing to delete the last remaining one (the app
  // always needs at least one profile to function). If the deleted profile
  // was the active one, switches to whichever profile is now first in line.
  const deleteProfile = useCallback(
    async (id: string) => {
      let next: Profile[] = [];
      let skipped = false;
      setProfilesState((prev) => {
        if (prev.length <= 1) {
          skipped = true;
          return prev;
        }
        next = prev.filter((p) => p.id !== id);
        return next;
      });
      if (skipped) return;
      await persistProfiles(next);
      if (activeProfileId === id) {
        await switchProfile(next[0].id);
      }
    },
    [activeProfileId, switchProfile]
  );

  // Falls back to the first profile if `activeProfileId` briefly points to
  // one that isn't in `profiles` yet (a transient state during a delete).
  const activeProfile = profiles.find((p) => p.id === activeProfileId) ?? profiles[0];

  return (
    <ProfilesContext.Provider
      value={{ profiles, activeProfileId, activeProfile, loading, switchProfile, addProfile, renameProfile, deleteProfile }}
    >
      {children}
    </ProfilesContext.Provider>
  );
}

// Hook for consuming the active profile / profile list + mutators. Throws
// if called outside `ProfilesProvider` so a missing provider fails loudly
// at the call site instead of silently returning `undefined`.
export function useProfiles() {
  const ctx = useContext(ProfilesContext);
  if (!ctx) throw new Error('useProfiles must be used within a ProfilesProvider');
  return ctx;
}
