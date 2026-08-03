// Per-profile ordering of the 8 non-Settings nav sections - used both as
// the bottom tab bar's primary-vs-"More" split (see `splitTabOrder` below)
// and as the side Drawer's own display order, so reordering sections is one
// preference shared by both navigation styles rather than a tabs-only
// concept. Mirrors `startupScreen.ts`'s exact storage pattern (native
// AsyncStorage, web via the backend).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { apiFetch } from './backendApi';
import { profileKey } from './profileStorage';
import { SECTION_ORDER } from './sectionMeta';
import { StartupSectionId } from './startupScreen';

// How many of the ordered sections show as primary bottom-tab icons before
// the rest fall into the "More" sheet.
export const PRIMARY_TAB_COUNT = 4;

// Default order matches the app's long-standing fixed display order,
// Settings excluded (it's never part of this list - always the "More"
// sheet's fixed last item, see app/(drawer)/_layout.tsx).
export const DEFAULT_TAB_ORDER: StartupSectionId[] = SECTION_ORDER.filter(
  (id): id is StartupSectionId => id !== 'settings'
);

const keyFor = (profileId: string) => profileKey(profileId, 'walkerlab_tab_order');

const VALID_IDS = new Set<string>(DEFAULT_TAB_ORDER);

// A stored order is only valid if it's an exact permutation of today's 8
// section ids - guards against a stale shape left over from before a
// section was added/removed, the same way startupScreen.ts's VALID_IDS
// guards a single stale value.
function isValidOrder(value: unknown): value is StartupSectionId[] {
  return (
    Array.isArray(value) &&
    value.length === DEFAULT_TAB_ORDER.length &&
    new Set(value).size === value.length &&
    value.every((id) => VALID_IDS.has(id))
  );
}

export async function getTabOrder(profileId: string): Promise<StartupSectionId[]> {
  if (Platform.OS === 'web') {
    const res = await apiFetch<{ order: StartupSectionId[] | null }>(`/api/tab-order/${profileId}`);
    return isValidOrder(res.order) ? res.order : DEFAULT_TAB_ORDER;
  }
  const raw = await AsyncStorage.getItem(keyFor(profileId));
  if (!raw) return DEFAULT_TAB_ORDER;
  try {
    const parsed = JSON.parse(raw);
    return isValidOrder(parsed) ? parsed : DEFAULT_TAB_ORDER;
  } catch {
    return DEFAULT_TAB_ORDER;
  }
}

export async function setTabOrder(profileId: string, order: StartupSectionId[]): Promise<void> {
  if (Platform.OS === 'web') {
    await apiFetch(`/api/tab-order/${profileId}`, { method: 'PUT', body: { order } });
    return;
  }
  await AsyncStorage.setItem(keyFor(profileId), JSON.stringify(order));
}

// Splits an already-enabled-filtered order into the bottom tab bar's
// primary icons and "More"-sheet overflow, in that same relative order.
export function splitTabOrder(order: StartupSectionId[]): {
  primary: StartupSectionId[];
  overflow: StartupSectionId[];
} {
  return { primary: order.slice(0, PRIMARY_TAB_COUNT), overflow: order.slice(PRIMARY_TAB_COUNT) };
}
