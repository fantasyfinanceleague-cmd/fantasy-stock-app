# Running the mobile app in the iOS Simulator

How to run current mobile code (Expo SDK 54) on this Mac without an EAS build. It
was worked out on 2026-09-25, when this was the only way to test the new draft flow:
installed phone builds were stale, and the App Store's Expo Go no longer supports
SDK 54.

## Why not Expo Go on a real iPhone
The App Store only offers the **newest** Expo Go (SDK 57 as of 2026-09-25), and an
older one can't be installed on a physical iPhone. This app is SDK 54, so a phone
shows "Project is incompatible with this version of Expo Go". The Simulator *can*
run the SDK 54 build of Expo Go. For a real phone, use an EAS build.

## One-time setup
1. Install **Xcode** (App Store). Confirm with
   `xcode-select -p`, which should print `/Applications/Xcode.app/Contents/Developer`,
   plus `xcodebuild -checkFirstLaunchStatus` and `xcodebuild -license check`.
2. Install an **iOS Simulator runtime** (Xcode → Settings → Components), then
   `xcrun simctl list runtimes`.
3. **Xcode 27 no longer ships `Simulator.app`** (it's replaced by `DeviceHub.app`),
   so `npx expo start --ios` fails with *"Can't determine id of Simulator app"*.
   Boot devices and install apps with `xcrun simctl` directly (below).
4. **Expo Go for SDK 54 (Simulator build).** The URL comes from
   `https://exp.host/--/api/v2/versions` (`sdkVersions["54.0.0"].iosClientUrl`).
   On 2026-09-25 it was
   `https://github.com/expo/expo-go-releases/releases/download/Expo-Go-54.0.7/Expo-Go-54.0.7.tar.gz`
   (~66 MB, bundle id `host.exp.Exponent`). A copy is kept at
   `~/fantasy-stock-design-review/tools/ExpoGo.app`. The tarball extracts the
   bundle's *contents*, so put them in a folder named `ExpoGo.app`.

## Each session
```bash
xcrun simctl list devices available            # pick an iPhone, note its UDID
xcrun simctl boot <UDID>
xcrun simctl install <UDID> ~/fantasy-stock-design-review/tools/ExpoGo.app   # once per device
```
Run the app from a **clean checkout of the code you want to test**, not the main
checkout (it's often on a feature branch). For example, a detached worktree at
`origin/main` with `apps/mobile/.env` holding only `EXPO_PUBLIC_SUPABASE_URL` and
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`:
```bash
cd <checkout>/apps/mobile && npm install && npx expo start --go      # --go: the app includes expo-dev-client
xcrun simctl openurl <UDID> exp://127.0.0.1:8081
```
A second person or worker can run in parallel on another device, with Metro on
`--port 8082` and `exp://127.0.0.1:8082`.

## Traps
- **Stale bundle.** Opening `exp://127.0.0.1:8081` while Expo Go already has a project
  at that address just brings the *old* one to the front. After switching the
  server to different code, force a reload:
  `xcrun simctl terminate <UDID> host.exp.Exponent`, then `openurl` again (or use the
  developer menu → Reload). Tell-tale sign: a UI element you just merged is missing.
- **It's prod.** The app talks to the prod Supabase project. Leagues and picks you
  create are real rows (name them `test_*`).
- **Credentials.** Sign in yourself. Automated sessions never type passwords.
- **Package warnings.** `expo start` lists patch-version mismatches ("should be
  updated for best compatibility"). They're warnings; bump them in a proper branch.
