// Which sections the TV's side rail shows, and in what order - the phone's own rules: the profile's
// tab order (Settings > section order), minus sections whose service is switched off, labelled with
// the profile's renames, coloured and iconed from SECTION_META. Only the routes differ (tv/app).
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { useProfiles } from '../../src/context/ProfilesContext';
import { useSectionNames } from '../../src/context/SectionNamesContext';
import { useServiceEnabled } from '../../src/context/ServiceEnabledContext';
import { SECTION_META } from '../../src/lib/sectionMeta';
import { SectionId } from '../../src/lib/sectionNames';
import { sectionEnabled } from '../../src/lib/serviceMeta';
import { StartupSectionId } from '../../src/lib/startupScreen';
import { DEFAULT_TAB_ORDER, getTabOrder } from '../../src/lib/tabOrder';
import { colors } from '../../src/theme/colors';

export const TV_HREF: Record<SectionId, string> = {
  discover: '/',
  tvShows: '/shows',
  movies: '/movies',
  music: '/music',
  downloads: '/downloads',
  nzbget: '/nzbget',
  torrents: '/torrents',
  transmission: '/transmission',
  spin: '/spin',
  requests: '/requests',
  stats: '/stats',
  containers: '/containers',
  settings: '/settings',
};

export interface NavSection {
  id: SectionId;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  href: string;
}

// Settings > Section order saves through setTabOrder; this tells a mounted rail to re-read it.
const orderListeners = new Set<() => void>();
export function tabOrderChanged() {
  orderListeners.forEach((l) => l());
}

export function useNavSections(): NavSection[] {
  const { activeProfileId } = useProfiles();
  const { names } = useSectionNames();
  const { isEnabled } = useServiceEnabled();
  const [order, setOrder] = useState<StartupSectionId[]>(DEFAULT_TAB_ORDER);

  useEffect(() => {
    const load = () =>
      getTabOrder(activeProfileId)
        .then(setOrder)
        .catch(() => setOrder(DEFAULT_TAB_ORDER));
    load();
    orderListeners.add(load);
    return () => {
      orderListeners.delete(load);
    };
  }, [activeProfileId]);

  return useMemo(() => {
    const ids: SectionId[] = [...order.filter((id) => sectionEnabled(id, isEnabled)), 'settings'];
    return ids.map((id) => ({
      id,
      label: names[id],
      icon: SECTION_META[id].icon,
      tint: SECTION_META[id].tint ?? colors.textSecondary,
      href: TV_HREF[id],
    }));
  }, [order, isEnabled, names]);
}
