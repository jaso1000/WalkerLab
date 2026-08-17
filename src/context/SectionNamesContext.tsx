// Provides the active profile's drawer/section label overrides (renames
// like calling "TV Shows" something else) app-wide, and keeps them synced
// to storage. Re-loads whenever the active profile changes, so each
// profile's renames are fully independent.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_SECTION_NAMES,
  SectionId,
  getSectionNameOverrides,
  setSectionNameOverrides,
} from '../lib/sectionNames';
import { useProfiles } from './ProfilesContext';

export type { SectionId };

type Overrides = Partial<Record<SectionId, string>>;

interface SectionNamesContextValue {
  names: Record<SectionId, string>;
  loading: boolean;
  setName: (id: SectionId, name: string) => void;
  resetName: (id: SectionId) => void;
}

const SectionNamesContext = createContext<SectionNamesContextValue | undefined>(undefined);

export function SectionNamesProvider({ children }: { children: React.ReactNode }) {
  const { activeProfileId } = useProfiles();
  const [overrides, setOverrides] = useState<Overrides>({});
  const [loading, setLoading] = useState(true);

  // Tracks the most recently *requested* profileId, checked again after
  // each load resolves - `ProfilesContext` starts at a placeholder
  // 'default' id before its own async load resolves the real one, so on
  // every fresh page load two requests race: an early one for 'default'
  // and a follow-up one for the real profile. Without this guard, a slow
  // 'default' response landing after the real one would overwrite the
  // real, just-loaded state in memory with the (near-certainly empty)
  // defaults.
  const latestRequestRef = useRef(activeProfileId);

  // Re-loads overrides whenever the active profile changes. Deliberately
  // read-only - this used to also persist whatever it loaded straight back
  // to storage (gated on a `loading` flag), which meant *merely opening
  // the app* wrote data, not just an explicit rename. That's a real bug
  // beyond the in-tab race the guard above covers: with two tabs/devices
  // open on the same profile, one tab's already-in-memory (now stale)
  // snapshot could get written back later for no reason a user ever took
  // an action for, silently reverting a change made somewhere else -
  // confirmed live for the sibling ServiceEnabledContext bug this was
  // copied from (a disabled service kept reverting across a phone and a
  // desktop browser even after the in-tab race alone was fixed). `setName`/
  // `resetName` below now persist directly, exactly once, exactly when the
  // user actually changes something - loading never writes anything.
  useEffect(() => {
    latestRequestRef.current = activeProfileId;
    setLoading(true);
    (async () => {
      const result = await getSectionNameOverrides(activeProfileId);
      if (latestRequestRef.current !== activeProfileId) return; // superseded by a newer request
      setOverrides(result);
      setLoading(false);
    })();
  }, [activeProfileId]);

  // Sets a section's display name. Saving back to the exact default name
  // (or blank) clears the override entirely rather than storing a
  // redundant explicit value equal to the default. Persists immediately,
  // from this exact action, against this exact profileId.
  const setName = useCallback(
    (id: SectionId, name: string) => {
      const trimmed = name.trim();
      setOverrides((prev) => {
        const next = { ...prev };
        if (!trimmed || trimmed === DEFAULT_SECTION_NAMES[id]) {
          delete next[id];
        } else {
          next[id] = trimmed;
        }
        setSectionNameOverrides(activeProfileId, next);
        return next;
      });
    },
    [activeProfileId]
  );

  // Explicitly clears a section's override back to its default name.
  const resetName = useCallback(
    (id: SectionId) => {
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[id];
        setSectionNameOverrides(activeProfileId, next);
        return next;
      });
    },
    [activeProfileId]
  );

  // Merges defaults with whatever's been overridden - consumers just read
  // `names[id]` and never need to know whether it's a default or override.
  const names = useMemo(() => ({ ...DEFAULT_SECTION_NAMES, ...overrides }), [overrides]);

  const value = useMemo(() => ({ names, loading, setName, resetName }), [names, loading, setName, resetName]);

  return <SectionNamesContext.Provider value={value}>{children}</SectionNamesContext.Provider>;
}

// Hook for reading/updating the active profile's section-name overrides.
export function useSectionNames() {
  const ctx = useContext(SectionNamesContext);
  if (!ctx) throw new Error('useSectionNames must be used within a SectionNamesProvider');
  return ctx;
}
