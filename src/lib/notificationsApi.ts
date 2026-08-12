// Native's notification capability check only - the old push/relay
// connection logic that used to live here (Bearer-token server login,
// Expo push token registration) has been replaced entirely by local
// polling (see src/lib/notificationPolling.ts and app/settings/
// notifications.tsx for the new native flow). This file still exists,
// trimmed to just this one function, because app/settings.tsx (shared
// between platforms, not a .tsx/.web.tsx split) imports it by its bare
// specifier to decide whether to show the Notifications settings row -
// native always can (polling has no capability gate the way browser push
// does), web has a real check (src/lib/notificationsApi.web.ts's own
// version of this function checks for Notification/serviceWorker/
// PushManager support).
export function isPushSupported(): boolean {
  return true;
}
