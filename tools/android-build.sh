#!/bin/bash
# Builds the test APK: godot/build/bannerfall-test.apk (arm64, release build signed with the debug key).
# Run tools/android-setup.sh once first. The Tiny Swords Free Pack must be present (tools/fetch-tinyswords.mjs).
set -e
cd "$(dirname "$0")/.."
[ -d godot/assets/tinyswords_free ] || node tools/fetch-tinyswords.mjs
npm run build:offline   # the lobby and match code the APK runs offline (src/offline/host.ts)
mkdir -p godot/build
godot --headless --path godot --import >/dev/null 2>&1
GODOT_ANDROID_KEYSTORE_RELEASE_PATH="$HOME/.android/debug.keystore" \
GODOT_ANDROID_KEYSTORE_RELEASE_USER=androiddebugkey \
GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD=android \
  godot --headless --path godot --export-release "Android" build/bannerfall-test.apk
apksigner verify godot/build/bannerfall-test.apk
ls -la godot/build/bannerfall-test.apk
