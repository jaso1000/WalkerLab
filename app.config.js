// app.json stays the phone/web config. This file only exists for the Android TV build
// (scripts/build-tv.sh, EXPO_TV=1): without that variable it returns app.json's config untouched,
// so phone, web and Docker builds are exactly what they were before.
//
// The TV variant is a separate app next to the phone one:
// - its own package (com.jaso1000.walkerlab.tv) and name, so it never replaces the phone app;
// - its own routes folder (tv/app), sharing everything in src/ (theme, API clients, contexts);
// - @react-native-tvos/config-tv for the leanback launcher entry, and no phone-only plugins
//   (notifications, background polling, foldable support) that have nothing to do on a TV.
// See PLAN.md's "Android TV app" entry.
const PHONE_ONLY_PLUGINS = ['expo-notifications', 'expo-background-task', './plugins/withFoldableSupport.js'];

module.exports = ({ config }) => {
  if (process.env.EXPO_TV !== '1') return config;

  const pluginName = (p) => (Array.isArray(p) ? p[0] : p);
  return {
    ...config,
    name: 'WalkerLab TV',
    orientation: 'landscape',
    android: {
      ...config.android,
      package: 'com.jaso1000.walkerlab.tv',
    },
    plugins: [
      ...config.plugins.filter((p) => !PHONE_ONLY_PLUGINS.includes(pluginName(p))),
      ['@react-native-tvos/config-tv', { isTV: true, androidTVBanner: './assets/tv-banner.png' }],
      // The launch screen: the WalkerLab lockup on the app's background instead of Expo's placeholder.
      './plugins/withTvSplash.js',
    ],
    extra: {
      ...config.extra,
      router: { ...(config.extra && config.extra.router), root: 'tv/app' },
    },
  };
};
