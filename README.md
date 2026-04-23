# ClipFury

Automatic Marvel Snap clip capture for Windows. Listens for snap audio cues in real time and saves a clip of the moment automatically — no manual recording, no missed snaps.

Built with Electron, Vosk (offline speech recognition), and FFmpeg.

---

## What It Does

ClipFury runs silently in your system tray while you play Marvel Snap. When it detects the snap audio cue ("Snap", "Oh Snap", "Opponent Snapped"), it saves a clip of the last 60-90 seconds automatically. You get a notification, and the clip is ready to review, upload, or share.

No OBS required to get started, though OBS integration is available for power users who want full control over recording quality.

---

## Getting Started

### Requirements

- Windows 10 or later
- Node.js 18+
- Marvel Snap installed (Steam)
- SoX audio tool (for the built-in recorder — see below)

### Install

```bash
git clone https://github.com/YOUR_USERNAME/clipfury.git
cd clipfury
npm install
```

### Download the Vosk Speech Model

ClipFury uses Vosk for offline speech recognition — no internet required, no API key.

1. Download the small English model from https://alphacephei.com/vosk/models
2. Look for `vosk-model-small-en-us` (about 40MB)
3. Extract it to the `models/` folder in the project root

Your folder structure should look like:
```
clipfury/
  models/
    vosk-model-small-en-us/
      am/
      conf/
      ...
```

### Install SoX (for built-in audio recording)

SoX handles audio capture when OBS is not in use.

1. Download from https://sourceforge.net/projects/sox/
2. Install and make sure `sox` is available in your PATH
3. Verify by running `sox --version` in a terminal

### Run

```bash
npm run dev
```

ClipFury starts in the system tray. Right-click the tray icon to access settings and controls.

---

## Using OBS Instead

If you already use OBS and want better recording quality:

1. Open OBS
2. Go to Tools → WebSocket Server Settings → Enable WebSocket Server
3. Note your port and password
4. In ClipFury → Settings → OBS tab, enter your connection details
5. In OBS → Output → Replay Buffer, enable it and set the duration to match your clip length setting
6. Start the replay buffer in OBS before you play

ClipFury will use OBS automatically when connected.

---

## Settings

Right-click the tray icon to access:

- **Clip Length** — 60 seconds, 90 seconds, or 3 minutes
- **Auto-upload** — automatically push clips to SnapFury after detection
- **Open Clips Folder** — see all saved clips
- **My Clips** — browse, preview, upload, or delete clips
- **Pause Detection** — temporarily disable snap detection

Full settings including save folder, OBS connection, and SnapFury account are in the Settings window.

---

## Building a Distributable

```bash
npm run build
```

This produces a Windows installer in the `dist/` folder. For distribution you will need a code signing certificate — without one Windows SmartScreen will warn users when they install. For development and internal testing the unsigned build works fine.

---

## Notes on Audio Detection

The detection looks for these phrases:
- "snap"
- "oh snap"
- "opponent snapped"

The 8-second cooldown between detections prevents a single snap event from triggering multiple saves. If detection is firing when it shouldn't, check that your system audio output is being captured — some audio setups route game audio through a virtual device that SoX may not pick up by default.

---

Part of the SnapFury project. See snapfury.com.
