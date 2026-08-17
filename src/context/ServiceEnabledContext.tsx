// Provides the active profile's per-service enabled/disabled flags app-wide -
// AdaptiveNav reads this to decide which nav sections to show at all.
// Re-loads whenever the active profile changes.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ServiceName } from '../api/types';
import { getServiceEnabledOverrides, setServiceEnabledOverrides } from '../lib/serviceEnabled';
import { useProfiles } from './ProfilesContext';

type Overrides = Partial<Record<ServiceName, boolean>>;

interface ServiceEnabledContextValue {
  isEnabled: (name: ServiceName) => boolean;
  setEnabled: (name: ServiceName, enabled: boolean) => void;
}

const ServiceEnabledContext = createContext<ServiceEnabledContextValue | undefined>(undefined);

export function ServiceEnabledProvider({ children }: { children: React.ReactNode }) {
  const { activeProfileId } = useProfiles();
  const [overrides, setOverrides] = useState<Overrides>({});

  // Tracks the most recently *requested* profileId, checked again after
  // each load resolves - `ProfilesContext` starts at a placeholder
  // 'default' id before its own async load resolves the real one, so on
  // every fresh page load two requests race: an early one for 'default'
  // and a follow-up one for the real profile. Without this guard, if the
  // 'default' request happened to resolve *after* the real one (ordinary
  // network jitter, no special conditions needed), its near-certainly-empty
  // overrides would overwrite the real, just-loaded state in memory.
  const latestRequestRef = useRef(activeProfileId);

  // Re-loads overrides whenever the active profile changes. Deliberately
  // read-only - this used to also persist whatever it loaded straight back
  // to storage (gated on a `loaded` flag), which meant *merely opening the
  // app* wrote data, not just an explicit toggle. That's a real bug on its
  // own beyond the in-tab race the guard above already covers: with two
  // tabs/devices open on the same profile, one tab's already-in-memory
  // (now stale) snapshot could get written back later for no reason a user
  // ever took an action for, silently reverting a disable made somewhere
  // else - confirmed live, the toggle kept reverting across both a phone
  // and a desktop browser even after the in-tab race was fixed. `setEnabled`
  // below now persists directly, exactly once, exactly when the user
  // actually changes something - loading never writes anything.
  useEffect(() => {
    latestRequestRef.current = activeProfileId;
    (async () => {
      const result = await getServiceEnabledOverrides(activeProfileId);
      if (latestRequestRef.current !== activeProfileId) return; // superseded by a newer request
      setOverrides(result);
    })();
  }, [activeProfileId]);

  // Absent from `overrides` means enabled - only an explicit `false` counts
  // as disabled, so existing profiles default to everything on.
  const isEnabled = useCallback((name: ServiceName) => overrides[name] !== false, [overrides]);

  // Enabling a service just clears its override (back to the "absent means
  // enabled" default) rather than storing an explicit `true`. Persists
  // immediately, from this exact action, against this exact profileId -
  // not via a generic "state changed, save it" effect (see the load
  // effect's own comment for why that was the real bug).
  const setEnabled = useCallback(
    (name: ServiceName, enabled: boolean) => {
      setOverrides((prev) => {
        const next = { ...prev };
        if (enabled) delete next[name];
        else next[name] = false;
        setServiceEnabledOverrides(activeProfileId, next);
        return next;
      });
    },
    [activeProfileId]
  );

  const value = useMemo(() => ({ isEnabled, setEnabled }), [isEnabled, setEnabled]);

  return <ServiceEnabledContext.Provider value={value}>{children}</ServiceEnabledContext.Provider>;
}

// Hook for checking/toggling per-service enabled state for the active profile.
export function useServiceEnabled() {
  const ctx = useContext(ServiceEnabledContext);
  if (!ctx) throw new Error('useServiceEnabled must be used within a ServiceEnabledProvider');
  return ctx;
}
