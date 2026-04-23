const OBSWebSocket = require("obs-websocket-js").default;
const path = require("path");
const fs   = require("fs");

const obs    = new OBSWebSocket();
let obsStatus = "disconnected";
let obsStore  = null;

async function connectOBS(store) {
  obsStore = store;
  const host     = store.get("obsHost")     || "localhost";
  const port     = store.get("obsPort")     || 4455;
  const password = store.get("obsPassword") || "";

  try {
    await obs.connect(`ws://${host}:${port}`, password);
    obsStatus = "connected";
    console.log("Connected to OBS WebSocket");

    obs.on("ConnectionClosed", () => {
      obsStatus = "disconnected";
      console.log("OBS connection closed");
    });

    // Make sure replay buffer is running when we connect
    await ensureReplayBufferRunning();
    return true;
  } catch (err) {
    obsStatus = "disconnected";
    throw new Error(`Could not connect to OBS: ${err.message}. Make sure OBS is open and WebSocket server is enabled.`);
  }
}

async function ensureReplayBufferRunning() {
  try {
    const { outputActive } = await obs.call("GetReplayBufferStatus");
    if (!outputActive) {
      await obs.call("StartReplayBuffer");
      console.log("Started OBS replay buffer");
    }
  } catch (err) {
    console.error("Could not start replay buffer:", err.message);
  }
}

async function disconnectOBS() {
  try {
    await obs.disconnect();
  } catch {}
  obsStatus = "disconnected";
}

// Tells OBS to save the replay buffer to disk, returns the saved file path
async function saveOBSReplay(store) {
  if (obsStatus !== "connected") {
    throw new Error("OBS is not connected");
  }

  // Listen for the save event so we know where OBS put the file
  return new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("OBS did not save the replay in time"));
    }, 15000);

    obs.once("ReplayBufferSaved", (event) => {
      clearTimeout(timeout);
      const savedPath = event.savedReplayPath;
      console.log("OBS saved replay to:", savedPath);
      resolve(savedPath);
    });

    try {
      await obs.call("SaveReplayBuffer");
    } catch (err) {
      clearTimeout(timeout);
      reject(err);
    }
  });
}

function getOBSStatus() {
  return obsStatus;
}

module.exports = { connectOBS, disconnectOBS, saveOBSReplay, getOBSStatus };
