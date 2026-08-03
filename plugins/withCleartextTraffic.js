const { withAndroidManifest } = require('expo/config-plugins');

// Every service this app talks to (Sonarr/Radarr/SABnzbd/qBittorrent/
// Overseerr/Tautulli) is a self-hosted home-server app, almost always
// reached over plain http:// on the local network - see every placeholder
// URL in serviceMeta.ts. Android blocks cleartext (non-HTTPS) traffic by
// default for apps targeting API 28+, UNLESS `usesCleartextTraffic="true"`
// is set on the manifest's <application> tag.
//
// The debug build variant already gets this for free - Expo's own
// android/app/src/debug/AndroidManifest.xml sets it via a debug-only
// manifest overlay - which is why every one of these services works fine
// under `expo start`/Expo Go and a plain `expo run:android` dev build.
// The release variant has no such overlay and falls back to Android's
// default (blocked), so every http:// service silently fails to connect
// only in a release build - this plugin closes that gap so release
// matches debug's behavior instead of drifting from it.
function withCleartextTraffic(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) return config;
    application.$['android:usesCleartextTraffic'] = 'true';
    return config;
  });
}

module.exports = withCleartextTraffic;
