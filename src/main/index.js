const { app, Tray, Menu, BrowserWindow, ipcMain, shell, Notification, nativeImage } = require("electron");
const path   = require("path");
const fs     = require("fs");
const Store  = require("electron-store");
const { startAudioMonitor, stopAudioMonitor, triggerTestSnap } = require("../audio/monitor");
const { startClickMonitor, stopClickMonitor, startCalibration, getClickMonitorStatus } = require("../audio/click-monitor");
const { connectOBS, disconnectOBS, getOBSStatus } = require("../capture/obs");
const { saveReplayBuffer, startBuiltinRecorder, stopBuiltinRecorder, saveTestClip } = require("../capture/recorder");
const { uploadToSnapFury } = require("../upload/snapfury");

const store = new Store({
  defaults: {
    clipLength:    90,       // seconds
    saveDir:       path.join(app.getPath("videos"), "ClipFury"),
    quality:       "1080p",
    autoUpload:    false,
    obsEnabled:    false,
    obsHost:       "localhost",
    obsPort:       4455,
    obsPassword:   "",
    snapfuryToken: null,
    launchOnStartup: false,
    snapButtonX:    null,
    snapButtonY:    null,
    monitorRes:     '2560x1440',
    firstRun:       true,
  }
});

let tray         = null;
let settingsWin  = null;
let clipsWin     = null;
let overlayWin   = null;
let isMonitoring = false;
let lastClipPath = null;

// Make sure the save directory exists
function ensureSaveDir() {
  const dir = store.get("saveDir");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Show a Windows toast notification
function notify(title, body) {
  if (Notification.isSupported()) {
    new Notification({ title, body, icon: path.join(__dirname, "../../assets/icon.png") }).show();
  }
}

// Called by the audio monitor when a snap phrase is detected
async function onSnapDetected(phrase, testMode = false) {
  console.log(`Snap detected: "${phrase}"${testMode ? " (test)" : ""}`);
  notify("ClipFury", testMode ? "Test snap — saving clip..." : "Snap detected — saving clip...");

  try {
    // Small delay so the Windows notification doesn't steal window focus
    // from Marvel Snap before FFmpeg starts capturing
    if (!testMode) await new Promise(r => setTimeout(r, 1500));

    const clipPath = testMode
      ? await saveTestClip(store.get("saveDir"))
      : await saveReplayBuffer(store);

    if (clipPath) {
      lastClipPath = clipPath;
      rebuildTray(); // Rebuild NOW so upload option becomes available
      notify("ClipFury", testMode
        ? "Test clip saved! Right-click → Upload Last Clip to test upload."
        : "Clip saved! Right-click the tray to upload."
      );

      if (store.get("autoUpload") && store.get("snapfuryToken") && !testMode) {
        notify("ClipFury", "Uploading to SnapFury...");
        await uploadToSnapFury(clipPath, store);
        notify("ClipFury", "Uploaded to SnapFury!");
      }

      if (clipsWin && !clipsWin.isDestroyed()) {
        clipsWin.webContents.send("clips-updated");
      }
    }
  } catch (err) {
    console.error("Failed to save clip:", err);
    notify("ClipFury", err.message.includes("Borderless") ? err.message : "Failed to save clip: " + err.message);
  }
}

// Build the right-click tray menu
function buildTrayMenu() {
  const obsStatus    = getOBSStatus();
  const clipLength   = store.get("clipLength");
  const autoUpload   = store.get("autoUpload");
  const hasLastClip  = !!lastClipPath;

  return Menu.buildFromTemplate([
    {
      label:   "ClipFury",
      enabled: false,
      icon:    nativeImage.createFromPath(path.join(__dirname, "../../assets/tray-logo.png")).resize({ width: 16, height: 16 }),
    },
    { type: "separator" },

    // Status indicators
    {
      label:   `Recording: ${isMonitoring ? "Active" : "Stopped"}`,
      enabled: false,
      icon:    nativeImage.createEmpty(),
    },
    {
      label:   `Snap Button: ${store.get("snapButtonX") ? `Calibrated (${store.get("snapButtonX")}, ${store.get("snapButtonY")})` : "Not calibrated — open Settings"}`,
      enabled: false,
    },
    {
      label:   `OBS: ${obsStatus === "connected" ? "Connected" : "Not connected"}`,
      enabled: false,
    },
    { type: "separator" },

    // Clip length
    {
      label: "Clip Length",
      submenu: [
        { label: "60 seconds",  type: "radio", checked: clipLength === 60,  click: () => { store.set("clipLength", 60);  rebuildTray(); } },
        { label: "90 seconds",  type: "radio", checked: clipLength === 90,  click: () => { store.set("clipLength", 90);  rebuildTray(); } },
        { label: "3 minutes",   type: "radio", checked: clipLength === 180, click: () => { store.set("clipLength", 180); rebuildTray(); } },
      ]
    },

    // Auto-upload toggle
    {
      label:   `Auto-upload to SnapFury: ${autoUpload ? "On" : "Off"}`,
      type:    "checkbox",
      checked: autoUpload,
      click:   () => { store.set("autoUpload", !autoUpload); rebuildTray(); }
    },

    { type: "separator" },

    // Actions
    {
      label:   "Upload Last Clip to SnapFury",
      enabled: hasLastClip,
      click:   () => showUploadDialog(lastClipPath),
    },
    {
      label: "Test Snap Detection (Quick)",
      click: () => onSnapDetected("TEST", true),
    },
    {
      label: "Open Clips Folder",
      click: () => shell.openPath(store.get("saveDir")),
    },
    {
      label: "My Clips",
      click: () => openClipsWindow(),
    },

    { type: "separator" },

    {
      label: isMonitoring ? "Pause Detection" : "Resume Detection",
      click: () => toggleMonitoring(),
    },
    {
      label: "Settings",
      click: () => openSettingsWindow(),
    },

    { type: "separator" },

    { label: "Quit ClipFury", click: () => app.quit() },
  ]);
}

function rebuildTray() {
  if (tray) tray.setContextMenu(buildTrayMenu());
}

async function toggleMonitoring() {
  if (isMonitoring) {
    stopAudioMonitor();
    isMonitoring = false;
    notify("ClipFury", "Detection paused.");
  } else {
    await startAudioMonitor(onSnapDetected);
    isMonitoring = true;
    notify("ClipFury", "Detection active — watching for snaps.");
  }
  rebuildTray();
}

function showUploadDialog(clipPath) {
  if (!clipPath || !fs.existsSync(clipPath)) {
    notify("ClipFury", "No clip found to upload.");
    return;
  }
  openSettingsWindow("upload");
}

function openSettingsWindow(tab = "general") {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    settingsWin.webContents.send("navigate-tab", tab);
    return;
  }

  settingsWin = new BrowserWindow({
    width:           520,
    height:          620,
    resizable:       false,
    frame:           true,
    title:           "ClipFury Settings",
    backgroundColor: "#f0e6c8",
    icon:            path.join(__dirname, "../../assets/icon.png"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    }
  });

  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, "../renderer/settings.html"));
  settingsWin.on("closed", () => { settingsWin = null; });
}

function openClipsWindow() {
  if (clipsWin && !clipsWin.isDestroyed()) {
    clipsWin.focus();
    return;
  }

  clipsWin = new BrowserWindow({
    width:           900,
    height:          600,
    title:           "ClipFury — My Clips",
    backgroundColor: "#f0e6c8",
    icon:            path.join(__dirname, "../../assets/icon.png"),
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    }
  });

  clipsWin.setMenu(null);
  clipsWin.loadFile(path.join(__dirname, "../renderer/clips.html"));
  clipsWin.on("closed", () => { clipsWin = null; });
}

// IPC handlers — renderer windows communicate with main via these

ipcMain.handle("get-settings",    ()          => store.store);
ipcMain.handle("save-settings",   (_, data)   => { store.set(data); rebuildTray(); return true; });
ipcMain.handle("get-clips",       ()          => getClipsList());
ipcMain.handle("get-last-clip",   ()          => lastClipPath);
ipcMain.handle("open-clips-dir",  ()          => shell.openPath(store.get("saveDir")));
ipcMain.handle("delete-clip",     (_, p)      => { try { fs.unlinkSync(p); return true; } catch { return false; } });
ipcMain.handle("upload-snapfury", (_, p)      => uploadToSnapFury(p, store));
ipcMain.handle("connect-obs",     ()          => connectOBS(store));

ipcMain.handle("start-calibration", () => {
  return new Promise((resolve) => {
    notify("ClipFury", "Click the Snap button in Marvel Snap now!");
    startCalibration((x, y) => {
      store.set("snapButtonX", x);
      store.set("snapButtonY", y);
      // Restart click monitor with new position
      stopClickMonitor();
      startClickMonitor(x, y, onSnapDetected);
      notify("ClipFury", `Snap button calibrated at (${x}, ${y}) — ready to detect!`);
      rebuildTray();
      resolve({ x, y });
    });
  });
});

ipcMain.handle("get-calibration", () => ({
  x: store.get("snapButtonX"),
  y: store.get("snapButtonY"),
}));
ipcMain.handle("test-detection", () => onSnapDetected("TEST", true));

// Returns list of clips in the save directory
function getClipsList() {
  const dir = store.get("saveDir");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => /\.(mp4|mov|mkv)$/i.test(f))
    .map(f => {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      return { name: f, path: full, size: stat.size, created: stat.birthtimeMs };
    })
    .sort((a, b) => b.created - a.created);
}

// App lifecycle
app.whenReady().then(async () => {
  // Hide from taskbar and dock — tray only
  app.setAppUserModelId("com.snapfury.clipfury");
  if (app.dock) app.dock.hide();

  ensureSaveDir();

  // Create tray
  // Use tray@2x on high-DPI displays, tray.png otherwise
  const iconPath = path.join(__dirname, "../../assets/tray.png");
  tray = new Tray(iconPath);
  tray.setToolTip("ClipFury — Snap detection active");
  tray.setContextMenu(buildTrayMenu());

  // Double-click opens clips window
  tray.on("double-click", () => openClipsWindow());

  // Connect to OBS if enabled
  if (store.get("obsEnabled")) {
    try {
      await connectOBS(store);
      console.log("OBS connected");
    } catch {
      console.log("OBS not available — will use built-in recorder");
    }
  }

  // Start click monitor if calibrated (primary detection method)
  const snapX = store.get("snapButtonX");
  const snapY = store.get("snapButtonY");
  if (snapX && snapY) {
    startClickMonitor(snapX, snapY, onSnapDetected);
    console.log(`Click monitor active at (${snapX}, ${snapY})`);
  } else {
    console.log("Snap button not calibrated yet — open Settings → Detection to calibrate");
  }

  // Start audio monitor as fallback
  await startAudioMonitor(onSnapDetected);
  isMonitoring = true;

  rebuildTray();

  // First run — open settings so user knows what to do
  const isFirstRun = store.get("firstRun");
  if (isFirstRun) {
    store.set("firstRun", false);
    setTimeout(() => {
      openSettingsWindow("general");
      notify("ClipFury", "Welcome to ClipFury! Set up your Snap button in Settings.");
    }, 1500);
  } else {
    notify("ClipFury", "Running in the system tray — ready to catch your snaps.");
  }
});

app.on("window-all-closed", (e) => {
  // Prevent app from quitting when all windows are closed
  e.preventDefault();
});

app.on("before-quit", () => {
  stopAudioMonitor();
  stopClickMonitor();
  disconnectOBS();
});
