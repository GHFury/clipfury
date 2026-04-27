# ClipFury

Automatic moment detection and clip capture for gaming content creators. ClipFury runs silently in your system tray and captures key gameplay moments automatically — no manual recording, no missed clips.

Built with Electron, FFmpeg, and uiohook-napi.

**Download:** [clipfury.net](https://clipfury.net)

---

## How It Works

ClipFury uses game profiles to define what a "moment" looks like for each title. For Marvel Snap, it detects clicks on the Snap button. When a moment is detected, FFmpeg captures the game window and saves a clip to your Videos folder automatically.

---

## Getting Started

### Requirements

- Windows 10 or later (64-bit)
- Node.js 20 LTS — use [nvm-windows](https://github.com/coreybutler/nvm-windows) to manage versions
- Marvel Snap (Steam)

### Install

```bash
git clone https://github.com/GHFury/clipfury.git
cd clipfury
npm install
npm run dev
```

ClipFury appears in the system tray. Right-click to access settings and controls.

---

## First Run

On first launch, Settings opens automatically. The important steps:

1. Go to the **Detection tab**
2. Click **Calibrate Snap Button**
3. Open Marvel Snap — go to **Proving Grounds** (snapping there costs no in-game currency)
4. Click the Snap button in game within 5 seconds
5. Done — ClipFury detects all future snaps automatically

Marvel Snap must run in **windowed mode** (not fullscreen) for ClipFury to capture it.

---

## Game Profiles

| Game | Status | Detection Method |
|---|---|---|
| Marvel Snap | Available | Click detection |
| Call of Duty | Coming soon | Region detection |
| Fortnite | Coming soon | Region detection |
| GTA Online | Coming soon | Region detection |
| Marathon | Coming soon | Audio + Region |
| Arc Raiders | Coming soon | Region detection |
| Custom | Pro | User-defined |

---

## OBS Integration (Optional)

For higher quality recordings, ClipFury can use OBS Replay Buffer instead of the built-in recorder:

1. OBS → Tools → WebSocket Server Settings → Enable
2. OBS → Output → Replay Buffer → Enable, set duration
3. ClipFury → Settings → OBS tab → enter connection details → Connect

ClipFury falls back to the built-in FFmpeg recorder if OBS is not connected.

---

## SnapFury Integration

Connect your SnapFury account in Settings → SnapFury tab to enable one-click uploads. Enable Auto-upload to have every clip posted to the community automatically after detection.

---

## Building

Run as Administrator (required for symlink permissions during packaging):

```bash
npm run build
```

Produces `dist/ClipFury-Setup-0.1.1-beta.exe`. Without a code signing certificate, Windows SmartScreen will warn users on install — click More info → Run anyway.

---

## Project Structure

```
src/
  main/index.js          Electron main process, system tray, IPC
  audio/monitor.js       Speech recognition fallback (Chromium Web Speech API)
  audio/click-monitor.js Global mouse click detection via uiohook-napi
  capture/recorder.js    FFmpeg screen capture, OBS fallback
  capture/obs.js         OBS WebSocket integration
  upload/snapfury.js     SnapFury API upload
  renderer/settings.html Settings window
  renderer/clips.html    Clips browser window
assets/                  Icons, installer graphics
```

---

© 2025 ClipFury · Not affiliated with any game publisher · [clipfury.net](https://clipfury.net)
