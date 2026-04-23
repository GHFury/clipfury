const fs   = require("fs");
const path = require("path");
const http = require("https");
const { execFile } = require("child_process");

const SNAPFURY_BASE = "https://snapfury.com";

// Uploads a clip file to SnapFury — gets a presigned URL then PUTs the file
async function uploadToSnapFury(clipPath, store) {
  const token = store.get("snapfuryToken");
  if (!token) throw new Error("Not logged in to SnapFury");
  if (!fs.existsSync(clipPath)) throw new Error("Clip file not found");

  const filename    = path.basename(clipPath);
  const fileSize    = fs.statSync(clipPath).size;
  const contentType = "video/mp4";

  // Step 1 — get a presigned upload URL from SnapFury
  const { url, publicUrl } = await apiRequest("POST", "/api/upload", token, {
    filename,
    contentType,
    size: fileSize,
    type: "video",
  });

  // Step 2 — PUT the file directly to storage
  await uploadFile(clipPath, url, contentType);

  // Step 3 — create the clip record
  const title = generateTitle(filename);
  const clip  = await apiRequest("POST", "/api/clips", token, {
    title,
    videoUrl:   publicUrl,
    visibility: "public",
    tags:       [],
  });

  return clip;
}

function generateTitle(filename) {
  // Turn "ClipFury_2025-04-23_14-30-00.mp4" into a readable title
  const base = path.basename(filename, ".mp4");
  const parts = base.replace("ClipFury_", "").split("_");
  if (parts.length >= 2) {
    const date = parts[0];
    const time = parts[1].replace(/-/g, ":");
    return `Snap — ${date} at ${time}`;
  }
  return "My Snap";
}

// Makes an authenticated JSON request to the SnapFury API
function apiRequest(method, endpoint, token, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url     = new URL(SNAPFURY_BASE + endpoint);

    const options = {
      hostname: url.hostname,
      path:     url.pathname,
      method,
      headers: {
        "Content-Type":  "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Authorization":  `Bearer ${token}`,
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data",  (chunk) => { data += chunk; });
      res.on("end",   () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(parsed.error || `HTTP ${res.statusCode}`));
          else resolve(parsed);
        } catch {
          reject(new Error("Invalid response from SnapFury"));
        }
      });
    });

    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Streams the file directly to the presigned storage URL
function uploadFile(filePath, uploadUrl, contentType) {
  return new Promise((resolve, reject) => {
    const fileSize = fs.statSync(filePath).size;
    const fileStream = fs.createReadStream(filePath);
    const url = new URL(uploadUrl);

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   "PUT",
      headers: {
        "Content-Type":   contentType,
        "Content-Length": fileSize,
        "x-upsert":       "true",
      },
    };

    const req = http.request(options, (res) => {
      res.resume(); // Drain response
      if (res.statusCode >= 400) {
        reject(new Error(`Storage upload failed: HTTP ${res.statusCode}`));
      } else {
        resolve();
      }
    });

    req.on("error", reject);
    fileStream.pipe(req);
  });
}

module.exports = { uploadToSnapFury };
