// The active profile's configured services, minus any it has switched off (Settings > services on
// the phone), and whether that set is final for the active profile yet. Every TV screen reads its
// configs through this, so a disabled service behaves on the TV exactly as on the phone.
import { useMemo } from 'react';
import { ServiceConfig, ServiceName } from '../../src/api/types';
import { useProfiles } from '../../src/context/ProfilesContext';
import { useServers } from '../../src/context/ServersContext';
import { useServiceEnabled } from '../../src/context/ServiceEnabledContext';

export function useEnabledServers() {
  const { activeProfileId, loading: profilesLoading } = useProfiles();
  const { servers, loading: serversLoading, loadedProfileId } = useServers();
  const { isEnabled } = useServiceEnabled();

  const enabled = useMemo(() => {
    const out: Partial<Record<ServiceName, ServiceConfig>> = {};
    for (const [name, config] of Object.entries(servers) as [ServiceName, ServiceConfig][]) {
      if (isEnabled(name)) out[name] = config;
    }
    return out;
  }, [servers, isEnabled]);

  // ServersContext can briefly hold the previous profile's configs after a switch (see its
  // `loadedProfileId` comment), so "ready" also needs it to match the active profile.
  const ready = !profilesLoading && !serversLoading && loadedProfileId === activeProfileId;
  return { servers: enabled, ready };
}
