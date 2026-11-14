#!/bin/bash
# One-time Android export setup for a cloud session (or a Linux box) with Godot 4.7 already installed.
# Installs apksigner and adb from apt, makes a minimal SDK folder around them (enough for Godot's
# non-Gradle export), a debug keystore, the Android export templates (only the two APK templates are kept
# out of the 1.3 GB download), and points Godot's editor settings at all of it.
#   bash tools/android-setup.sh && bash tools/android-build.sh
set -e
VER=4.7
T="$HOME/.local/share/godot/export_templates/$VER.stable"
SDK=/opt/android-sdk
KS="$HOME/.android/debug.keystore"

apt-get install -y -q apksigner adb || (apt-get update -q && apt-get install -y -q apksigner adb)
mkdir -p "$SDK/build-tools/34.0.0" "$SDK/platform-tools"
ln -sf "$(command -v apksigner)" "$SDK/build-tools/34.0.0/apksigner"
ln -sf "$(command -v adb)" "$SDK/platform-tools/adb"

mkdir -p "$(dirname "$KS")"
[ -f "$KS" ] || keytool -genkeypair -keystore "$KS" -storepass android -alias androiddebugkey -keypass android \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US"

if [ ! -f "$T/android_release.apk" ]; then
  mkdir -p "$T"
  tmp=$(mktemp -d)
  curl -sSL --retry 4 -o "$tmp/t.tpz" "https://github.com/godotengine/godot/releases/download/$VER-stable/Godot_v$VER-stable_export_templates.tpz"
  unzip -joq "$tmp/t.tpz" templates/android_debug.apk templates/android_release.apk templates/version.txt -d "$T"
  rm -rf "$tmp"
fi

# Godot writes its editor settings on first run; make sure they exist, then point them at the SDK and keystore
cd "$(dirname "$0")/.."
F="$HOME/.config/godot/editor_settings-$VER.tres"
[ -f "$F" ] || godot --headless --path godot --import >/dev/null 2>&1 || true
java_home=$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")
set_key() { grep -q "^$1 = " "$F" && sed -i "s|^$1 = .*|$1 = \"$2\"|" "$F" || echo "$1 = \"$2\"" >> "$F"; }
set_key export/android/android_sdk_path "$SDK"
set_key export/android/java_sdk_path "$java_home"
set_key export/android/debug_keystore "$KS"
set_key export/android/debug_keystore_user androiddebugkey
set_key export/android/debug_keystore_pass android
echo "android-setup: templates in $T, SDK at $SDK, keystore $KS"
