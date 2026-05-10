import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

export const ytdlpPath = resolveYtdlpPath(process.env.YTDLP_PATH);

export function runYtdlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ytdlpPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => stdout += chunk);
    child.stderr.on("data", (chunk) => stderr += chunk);
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `yt-dlp beendet mit Code ${code}`));
    });
  });
}

export function sanitizeYoutubeUrl(value) {
  try {
    const url = new URL(value);
    if (!isYoutubeHost(url.hostname)) return value;
    url.searchParams.delete("list");
    url.searchParams.delete("start_radio");
    url.searchParams.delete("pp");
    return url.toString();
  } catch {
    return value;
  }
}

export function isYoutubePlaylistUrl(value) {
  try {
    const url = new URL(value);
    if (!isYoutubeHost(url.hostname)) return false;
    return Boolean(url.searchParams.get("list")) || url.pathname.startsWith("/playlist");
  } catch {
    return false;
  }
}

function isYoutubeHost(hostname) {
  return /^(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)$/i.test(hostname);
}

function resolveYtdlpPath(configuredPath) {
  if (configuredPath && !/^https?:\/\//i.test(configuredPath) && fs.existsSync(configuredPath)) {
    return configuredPath;
  }

  const found = findOnPath("yt-dlp");
  if (found) return found;

  const wingetPath = findWingetYtdlp();
  if (wingetPath) return wingetPath;

  return "yt-dlp";
}

function findOnPath(command) {
  const lookup = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(lookup, [command], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
}

function findWingetYtdlp() {
  if (!process.env.LOCALAPPDATA) return null;
  const packagesDir = path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages");
  if (!fs.existsSync(packagesDir)) return null;

  for (const entry of fs.readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("yt-dlp.yt-dlp")) continue;
    const candidate = path.join(packagesDir, entry.name, "yt-dlp.exe");
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}
