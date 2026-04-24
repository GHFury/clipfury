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
    return await saveBuiltinClip(saveDir, clipLength, store);
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
 * Captures Marvel Snap using FFmpeg gdigrab.
 * Targets the game window directly to avoid capturing all monitors.
 * Falls back to primary monitor only if the window isn't found.
 */
async function saveBuiltinClip(saveDir, clipLength, store) {
  const monitorRes = store ? store.get("monitorRes") || "2560x1440" : "2560x1440";
  const source     = getCaptureSource(monitorRes);

  return new Promise((resolve, reject) => {
    const outputPath = path.join(saveDir, generateFilename());

    const args = ["-y", "-f", "gdigrab", "-framerate", "30"];

    if (source.isWindow) {
      // Window capture — pass title=SNAP as a single unquoted array element
      // execFile does NOT use shell so no quoting needed — just the raw value
      args.push("-i", source.input);  // source.input = "title=SNAP" (no shell quotes)
    } else {
      // Desktop fallback — limit to primary monitor dimensions
      const [w, h] = source.size.split("x");
      args.push(
        "-offset_x",  "0",
        "-offset_y",  "0",
        "-video_size", `${w}x${h}`,
        "-i",          "desktop"
      );
    }

    args.push(
      "-t",        String(clipLength),
      "-c:v",      "libx264",
      "-preset",   "fast",
      "-crf",      "23",
      "-pix_fmt",  "yuv420p",
      "-vf",       "format=yuv420p",
      "-movflags", "+faststart",
      outputPath
    );

    console.log("FFmpeg command:", ffmpegPath);
    console.log("FFmpeg args:", JSON.stringify(args));

    let ffmpegStderr = "";
    const proc = execFile(ffmpegPath, args, { timeout: (clipLength + 30) * 1000 }, (err) => {
      // Always log ffmpeg output for debugging
      if (ffmpegStderr) {
        const lines = ffmpegStderr.split("\n").filter(l => l.includes("error") || l.includes("Error") || l.includes("Failed") || l.includes("Cannot") || l.includes("Invalid"));
        if (lines.length > 0) console.log("FFmpeg errors:", lines.join("\n"));
      }

      if (err && err.code === "ETIMEDOUT") {
        reject(new Error("Recording timed out")); return;
      }
      if (err) {
        console.error("FFmpeg exit error:", err.message);
        console.error("Full stderr:", ffmpegStderr.slice(-500));
      }
      if (!fs.existsSync(outputPath)) {
        reject(new Error(`FFmpeg failed to create file. Error: ${ffmpegStderr.slice(-300)}`)); return;
      }
      const size = fs.statSync(outputPath).size;
      if (size < 10000) {
        try { fs.unlinkSync(outputPath); } catch {}
        reject(new Error(`Empty clip (${size} bytes). FFmpeg error: ${ffmpegStderr.slice(-300)}`)); return;
      }
      console.log(`Clip saved: ${outputPath} (${(size/1e6).toFixed(1)}MB)`);
      resolve(outputPath);
    });

    proc.stderr.on("data", (data) => { ffmpegStderr += data; });
    proc.on("error", (err) => reject(new Error("FFmpeg process error: " + err.message)));
  });
}

/**
 * Returns the gdigrab capture source for Marvel Snap.
 *
 * Marvel Snap runs as process "SNAP" with window title "SNAP".
 * We verify it's running before attempting capture and fall back
 * to primary monitor desktop capture if not found.
 */
function getCaptureSource(monitorRes) {
  try {
    // Check if SNAP process has a visible window
    const result = execFileSync("powershell", [
      "-Command",
      "Get-Process -Name SNAP -ErrorAction SilentlyContinue | Where-Object {$_.MainWindowTitle -ne ''} | Select-Object -First 1 -ExpandProperty MainWindowTitle"
    ], { timeout: 3000, encoding: "utf8" }).trim();

    if (result && result.length > 0) {
      console.log(`Marvel Snap window found: "${result}"`);
      return { input: `title=${result}`, isWindow: true };
    }

    console.log("Marvel Snap not running — falling back to desktop capture");
  } catch (err) {
    console.log("Window search error:", err.message);
  }

  // Fallback to primary monitor only
  return { input: "desktop", isWindow: false, size: monitorRes };
}

async function startBuiltinRecorder(saveDir) {
  if (builtinProcess) return;
  ensureDir(saveDir);
  builtinOutputPath = path.join(saveDir, generateFilename());

  const { input } = getCaptureSource();
  const args = [
    "-y", "-f", "gdigrab", "-framerate", "30",
    "-i", input,
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
