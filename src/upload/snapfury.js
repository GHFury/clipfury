const fs   = require("fs");
const path = require("path");
// Use http or https depending on the server URL (http for localhost, https for production)
const { execFile } = require("child_process");

// Base URL is read from store so it works with both local dev and production

// Uploads a clip file to SnapFury — gets a presigned URL then PUTs the file
async function uploadToSnapFury(clipPath, store) {
  const token   = store.get("snapfuryToken");
  const baseUrl = (store.get("snapfuryServer") || "https://snapfury.com").replace(/\/$/, "");
  if (!token) throw new Error("Not logged in to SnapFury. Open Settings → SnapFury tab.");
  if (!fs.existsSync(clipPath)) throw new Error("Clip file not found");

  const filename    = path.basename(clipPath);
  const fileSize    = fs.statSync(clipPath).size;
  const contentType = "video/mp4";

  // Step 1 — get a presigned upload URL from SnapFury
  const { url, publicUrl } = await apiRequest("POST", "/api/upload", token, baseUrl, {
    filename,
    contentType,
    size: fileSize,
    type: "video",
  });

  // Step 2 — PUT the file directly to storage
  await uploadFile(clipPath, url, contentType);

  // Step 3 — create the clip record
  const title = generateTitle(filename);
  const clip  = await apiRequest("POST", "/api/clips", token, baseUrl, {
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
function apiRequest(method, endpoint, token, baseUrl, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url     = new URL(baseUrl + endpoint);
    const http    = require(url.protocol === "https:" ? "https" : "http");

    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === "https:" ? 443 : 80),
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
        console.log(`[SnapFury API] ${method} ${endpoint} → ${res.statusCode}`);
        console.log(`[SnapFury API] Response body:`, data.slice(0, 300));
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) reject(new Error(parsed.error || `HTTP ${res.statusCode}: ${data.slice(0, 200)}`));
          else resolve(parsed);
        } catch {
          reject(new Error(`Invalid response from SnapFury (${res.statusCode}): ${data.slice(0, 200)}`));
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
    const fileSize   = fs.statSync(filePath).size;
    const fileStream = fs.createReadStream(filePath);
    const url        = new URL(uploadUrl);
    const http       = require(url.protocol === "https:" ? "https" : "http");

    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === "https:" ? 443 : 80),
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
