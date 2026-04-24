const { uIOhook, UiohookMouseEvent } = require("uiohook-napi");

// How close a click needs to be to the calibrated position (in pixels)
// Generous radius since snap button is fairly large
const CLICK_RADIUS_PX  = 150;

// Minimum time between detections — prevents double-triggering on one snap
const COOLDOWN_MS      = 8000;

let calibratedX     = null;
let calibratedY     = null;
let onSnapCallback  = null;
let lastDetectedAt  = 0;
let isRunning       = false;
let calibrationMode = false;
let onCalibrated    = null;

/**
 * Starts listening for mouse clicks globally.
 * When a click lands within CLICK_RADIUS_PX of the calibrated
 * Snap button position, fires the onSnap callback.
 */
function startClickMonitor(snapX, snapY, onSnap) {
  if (isRunning) stopClickMonitor();

  calibratedX    = snapX;
  calibratedY    = snapY;
  onSnapCallback = onSnap;
  isRunning      = true;

  uIOhook.on("mousedown", handleMouseClick);
  uIOhook.start();

  console.log(`Click monitor started — watching for clicks near (${snapX}, ${snapY}) ±${CLICK_RADIUS_PX}px`);
}

function stopClickMonitor() {
  if (!isRunning) return;
  try {
    uIOhook.removeAllListeners("mousedown");
    uIOhook.stop();
  } catch (err) {
    console.error("Error stopping click monitor:", err);
  }
  isRunning = false;
  console.log("Click monitor stopped");
}

/**
 * Enters calibration mode — the next mouse click anywhere on screen
 * will be captured as the Snap button position.
 */
function startCalibration(callback) {
  calibrationMode = true;
  onCalibrated    = callback;

  if (!isRunning) {
    uIOhook.on("mousedown", handleMouseClick);
    uIOhook.start();
    isRunning = true;
  }

  console.log("Calibration mode — waiting for Snap button click...");
}

function handleMouseClick(event) {
  const x = event.x;
  const y = event.y;

  // Calibration mode — capture this click as the Snap button position
  if (calibrationMode) {
    calibrationMode = false;
    console.log(`Snap button calibrated at (${x}, ${y})`);
    if (onCalibrated) onCalibrated(x, y);
    onCalibrated = null;

    // Stop if we weren't already monitoring
    if (!onSnapCallback) {
      stopClickMonitor();
    }
    return;
  }

  // Normal mode — check if click is near the calibrated Snap button
  if (calibratedX === null || calibratedY === null) return;

  const distance = Math.sqrt(
    Math.pow(x - calibratedX, 2) +
    Math.pow(y - calibratedY, 2)
  );

  if (distance <= CLICK_RADIUS_PX) {
    const now = Date.now();
    if (now - lastDetectedAt < COOLDOWN_MS) {
      console.log(`Click near snap button but in cooldown (${Math.round((COOLDOWN_MS - (now - lastDetectedAt)) / 1000)}s remaining)`);
      return;
    }

    lastDetectedAt = now;
    console.log(`Snap button click detected at (${x}, ${y}) — distance: ${Math.round(distance)}px`);

    if (onSnapCallback) onSnapCallback("SNAP_BUTTON");
  }
}

function getClickMonitorStatus() {
  return {
    running:     isRunning,
    calibrated:  calibratedX !== null,
    calibratedX,
    calibratedY,
  };
}

module.exports = {
  startClickMonitor,
  stopClickMonitor,
  startCalibration,
  getClickMonitorStatus,
};
