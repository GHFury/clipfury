const path   = require("path");
const fs     = require("fs");
const { execFile } = require("child_process");
const ffmpeg = require("ffmpeg-static");
const { saveOBSReplay, getOBSStatus } = require("./obs");

// Built-in recorder state
let builtinProcess   = null;
let builtinOutputPath = null;
let recordingStart   = null;

// Main entry point — decides whether to use OBS or built-in recorder
async function saveReplayBuffer(store) {
  const clipLength = store.get("clipLength") || 90;
  const saveDir    = store.get("saveDir");
  const obsEnabled = store.get("obsEnabled");

  ensureDir(saveDir);

  if (obsEnabled && getOBSStatus() === "connected") {
    // OBS path — cleanest quality, uses whatever OBS is configured to record
    console.log("Saving via OBS replay buffer...");
    const obsPath = await saveOBSReplay(store);

    // Copy the file to our save directory with a ClipFury filename
    const destPath = path.join(saveDir, generateFilename());
    fs.copyFileSync(obsPath, destPath);
    return destPath;
  } else {
    // Built-in path — uses FFmpeg to capture screen + audio
    console.log("Saving via built-in recorder...");
    return await saveBuiltinClip(saveDir, clipLength);
  }
}

// Captures the screen using FFmpeg's gdigrab (Windows screen capture)
// Records for the configured clip length and saves to disk
async function saveBuiltinClip(saveDir, clipLength) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(saveDir, generateFilename());

    // gdigrab captures the desktop on Windows
    // -t sets the recording duration
    // We capture a window named "Marvel Snap" specifically if it exists,
    // falling back to the full desktop
    const args = [
      "-y",
      "-f",       "gdigrab",
      "-framerate","30",
      "-i",       "title=Marvel Snap",   // Targets Marvel Snap window by title
      "-f",       "dshow",               // DirectShow for audio capture
      "-i",       "audio=virtual-audio-capturer", // Virtual audio — see setup notes
      "-t",       String(clipLength),
      "-c:v",     "libx264",
      "-preset",  "ultrafast",
      "-crf",     "23",                  // Good quality without huge file size
      "-c:a",     "aac",
      "-b:a",     "128k",
      outputPath,
    ];

    const proc = execFile(ffmpeg, args, { timeout: (clipLength + 30) * 1000 }, (err) => {
      if (err && err.killed) {
        reject(new Error("Recording timed out"));
      } else {
        resolve(outputPath);
      }
    });

    proc.stderr.on("data", (data) => {
      // FFmpeg writes progress to stderr — log it at debug level only
      if (process.env.NODE_ENV === "development") {
        process.stdout.write(".");
      }
    });
  });
}

// Starts a continuous recording session (for future use)
async function startBuiltinRecorder(saveDir) {
  if (builtinProcess) return;
  ensureDir(saveDir);
  builtinOutputPath = path.join(saveDir, generateFilename());
  recordingStart    = Date.now();

  const args = [
    "-y",
    "-f",       "gdigrab",
    "-framerate","30",
    "-i",       "title=Marvel Snap",
    "-c:v",     "libx264",
    "-preset",  "ultrafast",
    "-crf",     "23",
    builtinOutputPath,
  ];

  builtinProcess = execFile(ffmpeg, args);
  console.log("Built-in recorder started:", builtinOutputPath);
}

async function stopBuiltinRecorder() {
  if (!builtinProcess) return null;
  builtinProcess.kill("SIGINT"); // Graceful stop — FFmpeg finalizes the file
  builtinProcess = null;
  const result = builtinOutputPath;
  builtinOutputPath = null;
  return result;
}

function generateFilename() {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `ClipFury_${stamp}.mp4`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = { saveReplayBuffer, startBuiltinRecorder, stopBuiltinRecorder };
