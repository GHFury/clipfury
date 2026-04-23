const path   = require("path");
const fs     = require("fs");
const { app } = require("electron");

// The phrases we listen for — all confirmed Marvel Snap audio cues
const SNAP_PHRASES = [
  "snap",
  "oh snap",
  "opponent snapped",
  "i snap",
];

// Minimum gap between detections to avoid triggering multiple times on one snap
const DETECTION_COOLDOWN_MS = 8000;

let recognizer     = null;
let recorder       = null;
let lastDetectedAt = 0;
let isRunning      = false;
let onDetectCallback = null;

// Find the Vosk model directory — bundled with the app in production
function getModelPath() {
  const candidates = [
    path.join(process.resourcesPath, "models", "vosk-model-small-en-us"),
    path.join(__dirname, "../../../models/vosk-model-small-en-us"),
    path.join(app.getAppPath(), "models", "vosk-model-small-en-us"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function startAudioMonitor(onDetect) {
  if (isRunning) return;
  onDetectCallback = onDetect;

  const modelPath = getModelPath();
  if (!modelPath) {
    throw new Error(
      "Vosk speech model not found. Download it from https://alphacephei.com/vosk/models " +
      "and place it in the models/ folder as vosk-model-small-en-us."
    );
  }

  try {
    const vosk = require("vosk");
    vosk.setLogLevel(-1); // Suppress Vosk log spam

    const model = new vosk.Model(modelPath);
    recognizer  = new vosk.Recognizer({ model, sampleRate: 16000 });

    const recorder = require("node-record-lpcm16");
    const stream = recorder.record({
      sampleRate:     16000,
      channels:       1,
      audioType:      "raw",
      recorder:       "sox",   // Falls back to arecord on Linux
    });

    stream.stream()
      .on("data", (chunk) => {
        if (!recognizer) return;
        if (recognizer.acceptWaveform(chunk)) {
          const result = recognizer.result();
          checkForSnap(result.text);
        } else {
          // Check partial results too for faster response
          const partial = recognizer.partialResult();
          if (partial.partial) checkForSnap(partial.partial);
        }
      })
      .on("error", (err) => {
        console.error("Audio stream error:", err);
      });

    isRunning = true;
    console.log("Audio monitor running — listening for snap cues");
  } catch (err) {
    throw new Error(`Failed to start audio monitor: ${err.message}`);
  }
}

function checkForSnap(text) {
  if (!text || !text.trim()) return;

  const lower = text.toLowerCase().trim();
  const now   = Date.now();

  // Enforce cooldown so a single snap doesn't fire multiple times
  if (now - lastDetectedAt < DETECTION_COOLDOWN_MS) return;

  for (const phrase of SNAP_PHRASES) {
    if (lower.includes(phrase)) {
      lastDetectedAt = now;
      console.log(`Snap phrase matched: "${phrase}" in "${lower}"`);
      if (onDetectCallback) onDetectCallback(phrase);
      break;
    }
  }
}

function stopAudioMonitor() {
  if (!isRunning) return;
  try {
    if (recorder) recorder.stop();
    if (recognizer) { recognizer.free(); recognizer = null; }
  } catch (err) {
    console.error("Error stopping audio monitor:", err);
  }
  isRunning = false;
  console.log("Audio monitor stopped");
}

function getMonitorStatus() {
  return { running: isRunning, lastDetectedAt };
}

module.exports = { startAudioMonitor, stopAudioMonitor, getMonitorStatus };
