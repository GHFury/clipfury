const { BrowserWindow, ipcMain } = require("electron");
const path = require("path");

let speechWindow     = null;
let onDetectCallback = null;
let isRunning        = false;

// Keeps the speech monitor running as a silent fallback
// Primary detection is now handled by the mouse click monitor
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

  ipcMain.once("speech-started", () => {
    isRunning = true;
    console.log("Audio monitor active (fallback)");
  });

  ipcMain.on("speech-stopped", () => { isRunning = false; });
  ipcMain.on("speech-error",   (_, err) => console.error("Speech error:", err));

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

module.exports = { startAudioMonitor, stopAudioMonitor, getMonitorStatus, triggerTestSnap };
