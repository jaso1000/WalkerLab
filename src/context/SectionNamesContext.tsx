// Provides the active profile's drawer/section label overrides (renames
// like calling "TV Shows" something else) app-wide, and keeps them synced
// to storage. Re-loads whenever the active profile changes, so each
// profile's renames are fully independent.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
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

  // Re-loads overrides whenever the active profile changes (switching
  // profiles). `loading` gates the persist effect below so it doesn't
  // immediately write this freshly-loaded state right back to storage.
  useEffect(() => {
    setLoading(true);
    (async () => {
      setOverrides(await getSectionNameOverrides(activeProfileId));
      setLoading(false);
    })();
  }, [activeProfileId]);

  // Persists overrides back to storage on every change, once the initial
  // load has completed.
  useEffect(() => {
    if (loading) return;
    setSectionNameOverrides(activeProfileId, overrides);
  }, [overrides, loading, activeProfileId]);

  // Sets a section's display name. Saving back to the exact default name
  // (or blank) clears the override entirely rather than storing a
  // redundant explicit value equal to the default.
  const setName = useCallback((id: SectionId, name: string) => {
    const trimmed = name.trim();
    setOverrides((prev) => {
      const next = { ...prev };
      if (!trimmed || trimmed === DEFAULT_SECTION_NAMES[id]) {
        delete next[id];
      } else {
        next[id] = trimmed;
      }
      return next;
    });
  }, []);

  // Explicitly clears a section's override back to its default name.
  const resetName = useCallback((id: SectionId) => {
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  // Merges defaults with whatever's been overridden - consumers just read
  // `names[id]` and never need to know whether it's a default or override.
  const names = { ...DEFAULT_SECTION_NAMES, ...overrides };

  return (
    <SectionNamesContext.Provider value={{ names, loading, setName, resetName }}>
      {children}
    </SectionNamesContext.Provider>
  );
}

// Hook for reading/updating the active profile's section-name overrides.
export function useSectionNames() {
  const ctx = useContext(SectionNamesContext);
  if (!ctx) throw new Error('useSectionNames must be used within a SectionNamesProvider');
  return ctx;
}
