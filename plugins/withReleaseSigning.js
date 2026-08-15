const { withAppBuildGradle } = require('expo/config-plugins');

// Google Play requires every release upload to be signed with a stable,
// permanent "upload key" - the prebuild-generated build.gradle only ever
// wires up the debug keystore (see its own "Caution! In production, you
// need to generate your own keystore file" comment), which is fine for
// local `expo run:android --variant release` testing but can never be
// uploaded to Play. This plugin adds a real release signingConfig, read
// from gradle properties that live in ~/.gradle/gradle.properties
// (outside the repo, never committed - see PLAN.md's Play Store section
// for the actual path/alias) rather than checked-in secrets. Falls back
// to the debug keystore when those properties aren't set, so a release
// build on a machine without the upload key (or CI) still works
// unchanged instead of failing.
function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    const signingConfigsMarker = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }`;
    const signingConfigsReplacement = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            if (project.hasProperty('WALKERLAB_UPLOAD_STORE_FILE')) {
                storeFile file(WALKERLAB_UPLOAD_STORE_FILE)
                storePassword WALKERLAB_UPLOAD_STORE_PASSWORD
                keyAlias WALKERLAB_UPLOAD_KEY_ALIAS
                keyPassword WALKERLAB_UPLOAD_KEY_PASSWORD
            }
        }
    }`;

    const releaseSigningMarker = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug`;
    const releaseSigningReplacement = `            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig project.hasProperty('WALKERLAB_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug`;

    if (
      !config.modResults.contents.includes(signingConfigsMarker) ||
      !config.modResults.contents.includes(releaseSigningMarker)
    ) {
      throw new Error(
        'withReleaseSigning: expected build.gradle boilerplate not found - Expo template must have changed, update this plugin.'
      );
    }

    config.modResults.contents = config.modResults.contents
      .replace(signingConfigsMarker, signingConfigsReplacement)
      .replace(releaseSigningMarker, releaseSigningReplacement);

    return config;
  });
}

module.exports = withReleaseSigning;
