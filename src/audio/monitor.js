const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");

let speechWindow     = null;
let onDetectCallback = null;
let isRunning        = false;

/**
 * Starts audio monitoring using Electron's built-in Web Speech API.
 * Creates a hidden background window that runs speech recognition
 * using Chromium's native engine — no native modules required.
 */
async function startAudioMonitor(onDetect) {
  if (isRunning) return;
  onDetectCallback = onDetect;

  speechWindow = new BrowserWindow({
    width:  1,
    height: 1,
    show:   false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration:  true,
      contextIsolation: false,
    }
  });

  speechWindow.loadFile(
    path.join(__dirname, "../renderer/speech-monitor.html")
  );

  ipcMain.on("snap-detected", (_, phrase) => {
    if (onDetectCallback) onDetectCallback(phrase);
  });

  ipcMain.on("speech-started", () => {
    isRunning = true;
    console.log("Audio monitor active — listening for snap cues");
  });

  ipcMain.on("speech-stopped", () => {
    isRunning = false;
  });

  ipcMain.on("speech-error", (_, err) => {
    console.error("Speech monitor error:", err);
  });

  return true;
}

function stopAudioMonitor() {
  if (!isRunning && !speechWindow) return;

  if (speechWindow && !speechWindow.isDestroyed()) {
    speechWindow.webContents.send("stop-listening");
    setTimeout(() => {
      if (speechWindow && !speechWindow.isDestroyed()) {
        speechWindow.destroy();
        speechWindow = null;
      }
    }, 1000);
  }

  isRunning = false;
  console.log("Audio monitor stopped");
}

function getMonitorStatus() {
  return { running: isRunning };
}

function triggerTestSnap() {
  if (speechWindow && !speechWindow.isDestroyed()) {
    speechWindow.webContents.send("test-snap");
  } else if (onDetectCallback) {
    onDetectCallback("TEST");
  }
}

module.exports = {
  startAudioMonitor,
  stopAudioMonitor,
  getMonitorStatus,
  triggerTestSnap,
};
