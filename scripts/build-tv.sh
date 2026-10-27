#!/usr/bin/env bash
# Builds the Android TV app (WalkerLab TV, com.jaso1000.walkerlab.tv) without touching the phone build.
#
#   scripts/build-tv.sh            -> .tv-build/android/app/build/outputs/apk/release/app-release.apk
#
# The TV build needs `react-native` swapped for its TV fork (react-native-tvos) and a TV prebuild, and
# `expo prebuild --clean` would wipe the phone app's own android/. So everything happens in a copy of
# the project in .tv-build/ (gitignored): the source is synced in, package.json is patched there only,
# and EXPO_TV=1 makes app.config.js produce the TV variant (routes in tv/app). The phone checkout's
# package.json, node_modules and android/ are never modified. See PLAN.md's "Android TV app" entry.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
BUILD="$ROOT/.tv-build"
# Keep in step with package.json's react-native version (0.86.x): the TV fork must match it.
RN_TVOS="npm:react-native-tvos@0.86.3-0"
CONFIG_TV="0.1.7"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk}"
export EXPO_TV=1

mkdir -p "$BUILD"
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude /android --exclude /ios --exclude /.tv-build \
  --exclude /server --exclude /dist --exclude /.expo --exclude '*.jks' \
  --filter 'P /node_modules' --filter 'P /android' \
  "$ROOT/" "$BUILD/"

cd "$BUILD"
node -e '
  const fs = require("fs");
  const p = JSON.parse(fs.readFileSync("package.json", "utf8"));
  p.dependencies["react-native"] = process.argv[1];
  p.devDependencies = { ...(p.devDependencies || {}), "@react-native-tvos/config-tv": process.argv[2] };
  // npx expo install validation would flag the fork as the wrong react-native.
  p.expo = { ...(p.expo || {}), install: { ...((p.expo || {}).install || {}), exclude: ["react-native"] } };
  fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
' "$RN_TVOS" "$CONFIG_TV"

# Reinstall only when the patched package.json changed since the last TV build.
if ! cmp -s package.json node_modules/.tv-package.json 2>/dev/null; then
  npm install --no-audit --no-fund
  cp package.json node_modules/.tv-package.json
fi

# Prebuild only when something it reads changed (app config, plugins, native deps): it wipes android/,
# and the Gradle build after a fresh prebuild is several times slower than an incremental one.
STAMP=$(cat app.json app.config.js package.json plugins/*.js assets/tv-banner.png assets/tv-splash.png | sha256sum | cut -c1-16)
if [ ! -d android ] || [ "$(cat android/.tv-prebuild-stamp 2>/dev/null)" != "$STAMP" ]; then
  npx expo prebuild --clean --platform android --no-install
  echo "$STAMP" > android/.tv-prebuild-stamp
fi
cd android
# 32-bit ARM only: this TV (and most Android TV boxes) runs a 32-bit userland, 64-bit boxes run it too,
# and these TVs are short of storage - a second ABI nearly doubles the installed native code.
./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a --console=plain -q
echo "APK: $BUILD/android/app/build/outputs/apk/release/app-release.apk"
