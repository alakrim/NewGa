# Android test build

## Install and play offline

Copy `bannerfall-test.apk` to the phone and open it; allow installing from this source when Android asks. It needs
a 64-bit ARM phone (almost every phone since 2017) with Vulkan or OpenGL ES 3.

The game starts **offline**: the status line under the menu says "Offline: bots on this device". Press **Quick
Battle** for a 2v2 against three bots. No server, Wi-Fi or account is needed. The same lobby and match code as the
server runs inside the app (`src/offline/host.ts`, bundled into `godot/offline/bf-offline.js`) in Android's own
WebView JavaScript engine, driven by the game every frame (`godot/scripts/offline_host.gd`).

The **Online / Offline** button on the main menu switches modes; Settings → Server address → Connect also goes
online.

If offline play fails on a phone, the game shows "Offline play stopped" or "not available": please report the
message and the phone model. The WebView glue is the one part that could not be tested before release, because
the build machine has no Android emulator. Everything behind it runs in the desktop tests (`--offline` on the
command line uses Node in place of the WebView).

## Play online

1. Online play needs a Bannerfall server that the phone can reach. The simplest is a PC on the same Wi-Fi:
   ```bash
   npm install
   npx tsx src/server/index.ts      # listens on port 8787 on every network interface
   ```
   Find the PC's local address (Windows: `ipconfig`, macOS: System Settings → Wi-Fi → Details, Linux:
   `ip addr`), for example `192.168.1.20`, and allow port 8787 through the PC's firewall.
3. In the game: **Settings → Server address** → `ws://192.168.1.20:8787/ws` → **Connect**. The address is
   saved. The default `ws://127.0.0.1:8787/ws` points at the phone itself and won't connect.
4. **Quick Battle** starts a 2v2 against bots; **Create Room** gives a code friends can join (**Join Room**)
   on the same server.

To play away from home Wi-Fi, run the server anywhere that runs Docker and supports WebSockets (Fly.io,
Render, Railway, a VPS; see the README) and enter `wss://your-host/ws`.

## Build it

In a cloud session on the NewGa environment, or any Linux machine with Godot 4.7:

```bash
bash tools/android-setup.sh    # once: apksigner + adb from apt, SDK folder, debug keystore, export templates (1.3 GB download)
bash tools/android-build.sh    # -> godot/build/bannerfall-test.apk (about 38 MB)
```

The preset is `godot/export_presets.cfg`. It builds arm64 only, without Gradle, as a release build signed with
the debug key: fine for testing, not for a store. It leaves out `paintover/` and `tests/`. Textures are
imported for ETC2/ASTC as Android requires. The APK is never committed (`godot/build/` is ignored).

## For a store release later

- A release keystore kept outside the repo, passed with `GODOT_ANDROID_KEYSTORE_RELEASE_*`.
- An Android App Bundle via the Gradle build (`gradle_build/use_gradle_build=true`), which needs the full
  Android SDK (the `dl.google.com` host is not in the NewGa environment yet).
- A store-safe art set: the Tiny Swords Free Pack (still used for buildings, terrain and UI) may ship inside
  a game, but check its licence for store use first; the baked characters are free of it.
