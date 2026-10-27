const fs = require('fs');
const path = require('path');
const { withAndroidColors, withAndroidStyles, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

// The Android TV build's launch screen (app.config.js adds this for EXPO_TV=1 only). The app has no
// splash config of its own, so the TV prebuild fell back to Expo's blank-template placeholder - a grey
// grid on white. This shows assets/tv-splash.png (the WalkerLab lockup centred on a 1920x1080 canvas in
// the app's background colour) until React Native draws its first screen: a layer-list of the background
// colour with the image centred on top, as the activity's Theme.App.SplashScreen window background.
// drawable-nodpi keeps the image at its own pixel size, which on a 1080p TV is the whole screen.
const BACKGROUND = '#131419';

const LAYER_LIST = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:drawable="@color/splashscreen_background" />
  <item>
    <bitmap android:gravity="center" android:src="@drawable/tv_splash" />
  </item>
</layer-list>
`;

module.exports = function withTvSplash(config) {
  config = withDangerousMod(config, [
    'android',
    async (cfg) => {
      const res = path.join(cfg.modRequest.platformProjectRoot, 'app/src/main/res');
      fs.mkdirSync(path.join(res, 'drawable-nodpi'), { recursive: true });
      fs.copyFileSync(path.join(cfg.modRequest.projectRoot, 'assets/tv-splash.png'), path.join(res, 'drawable-nodpi/tv_splash.png'));
      fs.mkdirSync(path.join(res, 'drawable'), { recursive: true });
      fs.writeFileSync(path.join(res, 'drawable/tv_splash_background.xml'), LAYER_LIST);
      return cfg;
    },
  ]);

  config = withAndroidColors(config, (cfg) => {
    cfg.modResults = AndroidConfig.Colors.assignColorValue(cfg.modResults, { name: 'splashscreen_background', value: BACKGROUND });
    return cfg;
  });

  config = withAndroidStyles(config, (cfg) => {
    cfg.modResults = AndroidConfig.Styles.assignStylesValue(cfg.modResults, {
      add: true,
      parent: { name: 'Theme.App.SplashScreen', parent: 'AppTheme' },
      name: 'android:windowBackground',
      value: '@drawable/tv_splash_background',
    });
    return cfg;
  });

  return config;
};
