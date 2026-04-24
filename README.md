# ClipFury

Automatic Marvel Snap clip capture for Windows. Listens for snap audio cues in real time and saves a clip automatically — no manual recording, no missed snaps.

Built with Electron, FFmpeg, and Chromium's built-in speech recognition.

---

## What It Does

ClipFury runs silently in your system tray while you play Marvel Snap. When it detects the snap audio cue ("Snap", "Oh Snap", "Opponent Snapped"), it saves a clip automatically. You get a notification, and the clip is ready to review, upload, or share.

No external speech recognition engine required — ClipFury uses the speech recognition built into Electron's Chromium engine.

---

## Getting Started

### Requirements

- Windows 10 or later
- Node.js 20 LTS (use nvm-windows to manage versions)
- Marvel Snap installed (Steam)

### Install

```bash
git clone https://github.com/YOUR_USERNAME/clipfury.git
cd clipfury
npm install
```

### Run

```bash
npm run dev
```

ClipFury starts in the system tray. Right-click the tray icon to access settings and controls.

---

## Using OBS (Optional)

If you already use OBS and want higher quality recordings:

1. Open OBS → Tools → WebSocket Server Settings → Enable
2. In ClipFury → Settings → OBS tab, enter your connection details
3. In OBS → Output → Replay Buffer, enable it and set duration to match your clip length
4. Start the replay buffer in OBS before you play

ClipFury uses OBS automatically when connected, falling back to the built-in recorder otherwise.

---

## Settings

Right-click the tray icon to access:

- **Clip Length** — 60 seconds, 90 seconds, or 3 minutes
- **Auto-upload** — automatically push clips to SnapFury after detection
- **Open Clips Folder** — see all saved clips
- **My Clips** — browse, preview, upload, or delete clips
- **Pause Detection** — temporarily disable snap detection

---

## Building a Distributable

```bash
npm run build
```

Produces a Windows installer in `dist/`. For public distribution you will need a code signing certificate — without one Windows SmartScreen will warn users on install. Fine for development and internal testing.

---

## Notes

Detection phrases: "snap", "oh snap", "opponent snapped"

The 8-second cooldown between detections prevents a single snap event from triggering multiple saves.

---

Part of the SnapFury project. See snapfury.com.
