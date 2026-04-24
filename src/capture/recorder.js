const path   = require("path");
const fs     = require("fs");
const { execFile, execFileSync } = require("child_process");

// ffmpeg-static gives us the path to a bundled ffmpeg binary
let ffmpegPath;
try {
  ffmpegPath = require("ffmpeg-static");
} catch {
  ffmpegPath = "ffmpeg"; // Fall back to system ffmpeg
}

let builtinProcess    = null;
let builtinOutputPath = null;

/**
 * Main entry point — saves a clip using OBS replay buffer or built-in recorder.
 * In test mode, generates a short solid-color clip to verify the pipeline.
 */
async function saveReplayBuffer(store, testMode = false) {
  const clipLength = store.get("clipLength") || 90;
  const saveDir    = store.get("saveDir");
  const obsEnabled = store.get("obsEnabled");

  ensureDir(saveDir);

  // In test mode generate a quick 3-second clip to verify saving works
  if (testMode) {
    return await saveTestClip(saveDir);
  }

  const { saveOBSReplay, getOBSStatus } = require("./obs");
  if (obsEnabled && getOBSStatus() === "connected") {
    console.log("Saving via OBS replay buffer...");
    const obsPath  = await saveOBSReplay(store);
    const destPath = path.join(saveDir, generateFilename());
    fs.copyFileSync(obsPath, destPath);
    return destPath;
  } else {
    console.log("Saving via built-in recorder...");
    return await saveBuiltinClip(saveDir, clipLength);
  }
}

/**
 * Generates a short test clip (3 seconds, solid color) to verify
 * that the save pipeline and file system are working correctly.
 * Does not require Marvel Snap to be open.
 */
async function saveTestClip(saveDir) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(saveDir, generateFilename("TEST"));

    // Generate a 3-second solid purple clip — no screen capture needed
    const args = [
      "-y",
      "-f",      "lavfi",
      "-i",      "color=c=0x4A3DC8:size=1280x720:rate=30",
      "-f",      "lavfi",
      "-i",      "anullsrc=r=44100:cl=stereo",
      "-t",      "3",
      "-c:v",    "libx264",
      "-preset", "ultrafast",
      "-crf",    "28",
      "-c:a",    "aac",
      "-b:a",    "64k",
      "-shortest",
      outputPath,
    ];

    console.log("Generating test clip:", outputPath);

    execFile(ffmpegPath, args, { timeout: 15000 }, (err, stdout, stderr) => {
      if (err) {
        console.error("Test clip error:", err.message);
        reject(new Error("Failed to generate test clip: " + err.message));
        return;
      }
      if (!fs.existsSync(outputPath)) {
        reject(new Error("Test clip file was not created"));
        return;
      }
      console.log("Test clip saved:", outputPath);
      resolve(outputPath);
    });
  });
}

/**
 * Captures the screen using FFmpeg gdigrab.
 * Tries to capture the Marvel Snap window first,
 * falls back to full desktop if the game isn't open.
 */
async function saveBuiltinClip(saveDir, clipLength) {
  // Check if Marvel Snap window exists
  const targetWindow = getWindowTitle();
  console.log("Capturing window:", targetWindow);

  return new Promise((resolve, reject) => {
    const outputPath = path.join(saveDir, generateFilename());

    const args = [
      "-y",
      "-f",        "gdigrab",
      "-framerate", "30",
      "-i",         targetWindow,
      "-t",         String(clipLength),
      "-c:v",       "libx264",
      "-preset",    "ultrafast",
      "-crf",       "23",
      "-pix_fmt",   "yuv420p",
      "-c:a",       "aac",
      "-b:a",       "128k",
      outputPath,
    ];

    const proc = execFile(ffmpegPath, args, { timeout: (clipLength + 30) * 1000 }, (err) => {
      if (err && err.code === "ETIMEDOUT") {
        reject(new Error("Recording timed out"));
        return;
      }
      if (!fs.existsSync(outputPath)) {
        reject(new Error("Clip file was not created — check FFmpeg logs"));
        return;
      }
      resolve(outputPath);
    });

    proc.on("error", reject);
  });
}

/**
 * Checks if Marvel Snap is running and returns the appropriate
 * gdigrab input string — window title if found, desktop otherwise.
 */
function getWindowTitle() {
  try {
    // Use PowerShell to check for the Marvel Snap window
    const result = execFileSync("powershell", [
      "-Command",
      "Get-Process | Where-Object {$_.MainWindowTitle -like '*Marvel Snap*'} | Select-Object -First 1 -ExpandProperty MainWindowTitle"
    ], { timeout: 3000, encoding: "utf8" }).trim();

    if (result && result.length > 0) {
      return `title=${result}`;
    }
  } catch {
    // PowerShell not available or timed out — use desktop
  }
  return "desktop"; // Capture full screen as fallback
}

async function startBuiltinRecorder(saveDir) {
  if (builtinProcess) return;
  ensureDir(saveDir);
  builtinOutputPath = path.join(saveDir, generateFilename());

  const args = [
    "-y", "-f", "gdigrab", "-framerate", "30",
    "-i", getWindowTitle(),
    "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
    builtinOutputPath,
  ];

  builtinProcess = execFile(ffmpegPath, args);
  console.log("Built-in recorder started:", builtinOutputPath);
}

async function stopBuiltinRecorder() {
  if (!builtinProcess) return null;
  builtinProcess.kill("SIGINT");
  builtinProcess = null;
  const result = builtinOutputPath;
  builtinOutputPath = null;
  return result;
}

function generateFilename(prefix = "ClipFury") {
  const now   = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
  return `${prefix}_${stamp}.mp4`;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = { saveReplayBuffer, startBuiltinRecorder, stopBuiltinRecorder, saveTestClip };
