const { app, Tray, Menu, BrowserWindow, ipcMain, shell, Notification, nativeImage } = require("electron");
const path   = require("path");
const fs     = require("fs");
const Store  = require("electron-store");
const { startAudioMonitor, stopAudioMonitor }   = require("../audio/monitor");
const { connectOBS, disconnectOBS, getOBSStatus } = require("../capture/obs");
const { saveReplayBuffer, startBuiltinRecorder, stopBuiltinRecorder } = require("../capture/recorder");
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
async function onSnapDetected(phrase) {
  console.log(`Snap detected: "${phrase}"`);
  notify("ClipFury", `Snap detected — saving clip...`);

  try {
    const clipPath = await saveReplayBuffer(store);
    if (clipPath) {
      lastClipPath = clipPath;
      notify("ClipFury", "Clip saved! Right-click the tray to upload.");

      // Auto-upload to SnapFury if enabled
      if (store.get("autoUpload") && store.get("snapfuryToken")) {
        notify("ClipFury", "Uploading to SnapFury...");
        await uploadToSnapFury(clipPath, store);
        notify("ClipFury", "Uploaded to SnapFury!");
      }

      // Refresh clips window if it's open
      if (clipsWin && !clipsWin.isDestroyed()) {
        clipsWin.webContents.send("clips-updated");
      }
    }
  } catch (err) {
    console.error("Failed to save clip:", err);
    notify("ClipFury", "Failed to save clip. Check your settings.");
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
ipcMain.handle("test-detection",  ()          => onSnapDetected("TEST"));

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

  // Start audio monitoring
  try {
    await startAudioMonitor(onSnapDetected);
    isMonitoring = true;
    console.log("Audio monitoring started");
  } catch (err) {
    console.error("Audio monitor failed to start:", err);
    isMonitoring = false;
  }

  rebuildTray();

  notify("ClipFury", "Running in the system tray — ready to catch your snaps.");
});

app.on("window-all-closed", (e) => {
  // Prevent app from quitting when all windows are closed
  e.preventDefault();
});

app.on("before-quit", () => {
  stopAudioMonitor();
  disconnectOBS();
});
