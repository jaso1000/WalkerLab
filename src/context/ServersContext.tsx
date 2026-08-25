// Provides the active profile's configured service credentials (Sonarr/
// Radarr/SABnzbd/etc connection details) app-wide, so any screen can check
// "is this service configured" and read its config without threading props
// through the navigation tree. Re-loads whenever the active profile changes.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ServiceConfig, ServiceName } from '../api/types';
import { getServiceConfig, setServiceConfig as persistServiceConfig } from '../lib/storage';
import { useProfiles } from './ProfilesContext';

type ServersState = Partial<Record<ServiceName, ServiceConfig>>;

interface ServersContextValue {
  servers: ServersState;
  loading: boolean;
  // Which profile `servers` actually reflects - NOT necessarily the current
  // `activeProfileId` from `useProfiles()`. `ProfilesContext` can update
  // `activeProfileId` in a render before this context's own effect (which
  // depends on that same value) has re-run `refresh()` for it - during that
  // window, `loading` is still `false` (left over from the *previous*
  // profile's completed load), which makes "loading is false" alone an
  // unsafe signal that `servers` is fresh. Consumers that need to react
  // exactly once per real profile change (see app/settings/[service].tsx)
  // should gate on `loadedProfileId === activeProfileId`, not `!loading`.
  loadedProfileId: string | null;
  updateServer: (name: ServiceName, config: ServiceConfig) => Promise<void>;
  refresh: () => Promise<void>;
}

const SERVICE_NAMES: ServiceName[] = ['sonarr', 'radarr', 'lidarr', 'sabnzbd', 'nzbget', 'tmdb', 'omdb', 'lastfm', 'overseerr', 'qbittorrent', 'transmission', 'tautulli', 'portainer'];

const ServersContext = createContext<ServersContextValue | undefined>(undefined);

export function ServersProvider({ children }: { children: React.ReactNode }) {
  const { activeProfileId } = useProfiles();
  const [servers, setServers] = useState<ServersState>({});
  const [loading, setLoading] = useState(true);
  const [loadedProfileId, setLoadedProfileId] = useState<string | null>(null);

  // Loads every service's config for the active profile in parallel.
  // Services with no saved config are simply absent from the resulting
  // object (not present with a `null`/`undefined` value), so consumers can
  // do a plain truthy check. Captures `activeProfileId` into a local before
  // the `await` (rather than reading the closed-over dependency again
  // afterward) so `loadedProfileId` always reflects the profile this
  // specific load was actually *for*, not whatever's active by the time it
  // finishes.
  const refresh = useCallback(async () => {
    setLoading(true);
    const profileIdAtStart = activeProfileId;
    const entries = await Promise.all(
      SERVICE_NAMES.map(async (name) => [name, await getServiceConfig(profileIdAtStart, name)] as const)
    );
    const next: ServersState = {};
    for (const [name, config] of entries) {
      if (config) next[name] = config;
    }
    setServers(next);
    setLoadedProfileId(profileIdAtStart);
    setLoading(false);
  }, [activeProfileId]);

  // Re-loads on mount and whenever the active profile changes (switching
  // profiles swaps in that profile's own set of credentials).
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Saves one service's config (Settings' per-service config pages) and
  // updates in-memory state immediately, so the UI reflects the change
  // without waiting for a full `refresh()` round trip.
  const updateServer = useCallback(
    async (name: ServiceName, config: ServiceConfig) => {
      await persistServiceConfig(activeProfileId, name, config);
      setServers((prev) => ({ ...prev, [name]: config }));
    },
    [activeProfileId]
  );

  const value = useMemo(
    () => ({ servers, loading, loadedProfileId, updateServer, refresh }),
    [servers, loading, loadedProfileId, updateServer, refresh]
  );

  return <ServersContext.Provider value={value}>{children}</ServersContext.Provider>;
}

// Hook for reading/updating the active profile's service configs.
export function useServers() {
  const ctx = useContext(ServersContext);
  if (!ctx) throw new Error('useServers must be used within a ServersProvider');
  return ctx;
}
