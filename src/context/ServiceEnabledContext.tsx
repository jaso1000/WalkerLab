// Provides the active profile's per-service enabled/disabled flags app-wide -
// the drawer reads this to decide which nav sections to show at all.
// Re-loads whenever the active profile changes.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
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
  const [loaded, setLoaded] = useState(false);

  // Re-loads overrides whenever the active profile changes. `loaded` gates
  // the persist effect below so it doesn't write this freshly-loaded state
  // straight back to storage.
  useEffect(() => {
    setLoaded(false);
    (async () => {
      setOverrides(await getServiceEnabledOverrides(activeProfileId));
      setLoaded(true);
    })();
  }, [activeProfileId]);

  useEffect(() => {
    if (!loaded) return;
    setServiceEnabledOverrides(activeProfileId, overrides);
  }, [overrides, loaded, activeProfileId]);

  // Absent from `overrides` means enabled - only an explicit `false` counts
  // as disabled, so existing profiles default to everything on.
  const isEnabled = useCallback((name: ServiceName) => overrides[name] !== false, [overrides]);

  // Enabling a service just clears its override (back to the "absent means
  // enabled" default) rather than storing an explicit `true`.
  const setEnabled = useCallback((name: ServiceName, enabled: boolean) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (enabled) delete next[name];
      else next[name] = false;
      return next;
    });
  }, []);

  return (
    <ServiceEnabledContext.Provider value={{ isEnabled, setEnabled }}>{children}</ServiceEnabledContext.Provider>
  );
}

// Hook for checking/toggling per-service enabled state for the active profile.
export function useServiceEnabled() {
  const ctx = useContext(ServiceEnabledContext);
  if (!ctx) throw new Error('useServiceEnabled must be used within a ServiceEnabledProvider');
  return ctx;
}
