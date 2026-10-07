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

## Captures, accessibility settings and recordings

The method the Design Lead used for the Home audit's F2 evidence (Reduce Motion), on the
iPhone 17e. `$U` is the simulator's UDID (`xcrun simctl list devices available`).

**Fixtures, not sign-in.** Put the fixture vars in `apps/mobile/.env.local` (gitignored;
baked into the bundle, so changing it needs a Metro restart), e.g.
`EXPO_PUBLIC_SHELL_FIXTURE=leagues` (fakes the session, so no sign-in) plus the screen's own
fixture var. Start Metro from `apps/mobile` with stdin closed (not `CI=1`):
`npx expo start --go --port 8083 < /dev/null`. Delete `.env.local` when you're done.

**Reduce Motion, text size, appearance: simctl only.** The Settings app's switches ignore
simulated taps, so don't use them.

```bash
xcrun simctl spawn $U defaults write com.apple.Accessibility ReduceMotionEnabled -bool YES
xcrun simctl spawn $U defaults read com.apple.Accessibility ReduceMotionEnabled
xcrun simctl ui $U content_size accessibility-extra-large
xcrun simctl ui $U appearance dark
```

- The `read` prints `1` when Reduce Motion is on; write `NO` to undo it.
- Text sizes: `large` is the default, `accessibility-extra-large` is XL, and
  `accessibility-extra-extra-extra-large` is XXXL.
- **Reduce Motion and text size need a relaunch.** React Native and Reanimated read them
  once, when the JS loads, so changing them mid-session silently does nothing. Appearance
  switches live.
- Relaunch with `xcrun simctl terminate $U host.exp.Exponent`, wait a second, then
  `xcrun simctl launch $U host.exp.Exponent` and wait about 5 s.
- Then open `exp://127.0.0.1:<port>` with the simulator tool's `open_url` action. A plain
  `simctl openurl` can no-op when Expo Go isn't frontmost.
- Wait for a NEW fixture or "Bundled" line in the Metro log before capturing.
- **Reset at the end:** Reduce Motion `NO`, content size `large`, appearance `light`.

**Recording video.**

```bash
xcrun simctl io $U recordVideo --codec=h264 --force /path/out.mov &
pkill -INT -f "io $U recordVideo"
```

- Wait about 2 s after starting the recording, then do the interaction (taps at
  device-point coordinates).
- `pkill -INT` finalises the file. Scope it to YOUR UDID; never kill every `recordVideo`.
- Wait until `pgrep -f "io $U recordVideo"` is empty before reading the file.

**Frames (no ffmpeg on this Mac):** use `scripts/sim/vidtool.swift`.

```bash
swift scripts/sim/vidtool.swift info out.mov
swift scripts/sim/vidtool.swift frames out.mov outdir 10 0 12.1 390
```

- `info` prints the frame count, gaps and dropped frames.
- `frames` takes, in order: fps, start s, end s, and width px.
- Recordings are **variable frame rate**: a frame is written only when the screen changes,
  so few frames over a long span means nothing animated in between.
- To find the frames that changed, diff consecutive PNGs, e.g. with Python PIL's
  `ImageChops.difference(a, b).getbbox()`. Then lay a changed frame beside its neighbours.
- For example, "drawn in the first frame" was shown by the frame right after the tap
  already equalling a frame a second later.

**Gotchas.** Screenshots can lag the screen by 1–3 s on a loaded machine, so re-take one
before calling something a bug. Detaching the simulator panel can detach other devices'
panels too.

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
- **`EXPO_PUBLIC_*` vars come from `.env` files, not the shell.** A var set via
  `EXPO_PUBLIC_FOO=bar npx expo start` never reaches the device on this SDK.
  `process.env.EXPO_PUBLIC_*` compiles to `_expoVirtualEnv.env.EXPO_PUBLIC_*`
  (`node_modules/expo/virtual/env.js`), which is built from PARSED `.env`,
  `.env.local`, etc. file contents baked into the bundle at build time — not
  from the live process environment `expo start` was invoked with. To pass a
  one-off value to a dev build, put it in `apps/mobile/.env.local` (gitignored
  via `.env*.local`), not a shell export. Verified 2026-09-26 by reading the
  served bundle directly (`curl` the entry bundle, grep for the var).
- **Reduce Motion / Dynamic Type are read once at JS-bundle load, not live.**
  `react-native-reanimated`'s `useReducedMotion()` caches
  `isReducedMotionEnabledInSystem()` in a module-level constant on first
  import (its own JSDoc: "Changing the reduced motion system setting doesn't
  cause your components to rerender... enabled when the app started") and RN's
  Dynamic Type font scaling behaves the same way. Toggling Settings while the
  app is already running has no visible effect — you'll capture the wrong
  state and not notice, since nothing errors. Verified 2026-09-28: flipped
  Reduce Motion on mid-session, the gallery's own `useMotion().reduced`
  readout kept reporting `false` for 3+ screenshots. Fix: change the Settings
  toggle FIRST, then force a fresh JS load —
  `xcrun simctl terminate <UDID> host.exp.Exponent`, then re-`openurl` the
  `exp://` deep link. This conveniently reloads AND re-lands on the same
  deep-linked route, since iOS remembers the Expo Go association after the
  first manual "Open in Expo Go?" tap.
- **Settings toggle switches need a drag, not a tap.** On this simulator/iOS
  build, a plain `tap` on a `UISwitch` in Settings (e.g. Accessibility →
  Motion → Reduce Motion) silently no-ops — no error, the switch just stays
  put — while taps on everything else (rows, back buttons, other switches
  tested as a control) work fine. A short `touch_path` drag across the switch
  (a few points, e.g. from one edge to the other) toggles it reliably.
  Verified 2026-09-28: 3 consecutive plain taps at pixel-verified coordinates
  on "Reduce Motion" and on an unrelated control switch ("Prefer Non-Blinking
  Cursor") all failed to toggle; a drag gesture at the same location worked
  on the first try.
- **Reduce Motion and text size can be set without touching Settings.**
  `xcrun simctl spawn <UDID> defaults write com.apple.Accessibility ReduceMotionEnabled -bool YES`
  (`NO` to undo) and `xcrun simctl ui <UDID> content_size accessibility-extra-large`
  (`large` = default), then a fresh JS load (terminate + re-`openurl`, as above).
  Verified 2026-09-29 against the design gallery's `useMotion().reduced`
  readout: `true` after the write + relaunch, `false` after undoing it. This
  replaces the Settings-switch drag above for scripted captures.
- **`CI=1 npx expo start` disables file watching.** It's the usual way to keep
  a background Metro from prompting, but in CI mode Metro never picks up edits:
  the bundle silently goes stale, and the only trace is one log line, "Metro is
  running in CI mode, reloads are disabled." Run a background Metro as
  `npx expo start --go --port <port> < /dev/null` instead (stdin closed, watch
  mode on). Found 2026-09-29: two "fixes" appeared not to work because Metro
  was still serving the code from before them.
- **Screenshots can lag the screen by 1–3 s** on a loaded machine (several
  Metro servers and Simulators from parallel sessions). An empty field right
  after typing may just be an old frame: wait and re-take before calling it a
  bug.
- **Scope process kills to your own device and port.** Other sessions run
  their own Metro servers and `simctl io … recordVideo` recordings on this Mac.
  Stop a recording with `pkill -INT -f "io <UDID> recordVideo"`, never
  `pkill -f recordVideo`, and stop Metro by its `--port`.
- **Recordings are variable-frame-rate, and H.264 samples arrive in decode
  order.** Sort sample timestamps before measuring frame gaps, or B-frames
  produce negative gaps and a meaningless frame rate.
  `~/fantasy-stock-design-review/tools/vidtool.swift` (`info` / `gaps` /
  `frames`) does this: it reports late frames (>25 ms) during continuous
  motion and ignores idle stretches (the recorder writes frames only when
  something changes). Synthetic touches (typing, swipes) inject input at an
  irregular rate, so judge an animation's smoothness from a window where only
  that animation runs.
