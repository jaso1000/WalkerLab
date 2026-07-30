// Central helper for namespacing any profile-scoped setting's storage key.
// Every profile-scoped concern (service credentials, drawer renames,
// enabled-services, startup screen) should route its key through
// `profileKey()` rather than hand-rolling its own scheme.
export const DEFAULT_PROFILE_ID = 'default';

// The default profile keeps using the exact storage keys every profile-scoped
// setting already used before profiles existed - existing installs upgrade
// with zero migration, they just get one auto-created profile that already
// has all their current data. Only new profiles get a namespaced key.
export function profileKey(profileId: string, baseKey: string): string {
  return profileId === DEFAULT_PROFILE_ID ? baseKey : `walkerlab_profile_${profileId}_${baseKey}`;
}
