const { withAndroidManifest } = require('expo/config-plugins');

// Fixes a documented Android/Expo issue: without `smallestScreenSize` (and
// friends) declared in the MainActivity's configChanges, folding/unfolding
// a foldable device destroys and recreates the Activity instead of just
// delivering a resize event - the app restarts instead of react-native's
// useWindowDimensions() updating in place.
// See https://github.com/expo/expo/discussions/29633
//
// IMPORTANT: this only takes effect in a custom dev client or production
// build (`expo prebuild` / `expo run:android` / EAS Build) - it has no
// effect in Expo Go, since Expo Go's own AndroidManifest is fixed and
// isn't generated from this project's config.
const REQUIRED_CONFIG_CHANGES = [
  'keyboard',
  'keyboardHidden',
  'orientation',
  'screenSize',
  'screenLayout',
  'uiMode',
  'locale',
  'layoutDirection',
  'smallestScreenSize',
  'density',
];

function withFoldableSupport(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    const mainActivity = application?.activity?.find((a) => a.$['android:name'] === '.MainActivity');
    if (!mainActivity) return config;

    const existing = mainActivity.$['android:configChanges'] ?? '';
    const merged = new Set(existing.split('|').filter(Boolean));
    REQUIRED_CONFIG_CHANGES.forEach((value) => merged.add(value));
    mainActivity.$['android:configChanges'] = Array.from(merged).join('|');

    return config;
  });
}

module.exports = withFoldableSupport;
