import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const audioExtensions = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".webm"]);

export function isAudioFile(filePath) {
  return audioExtensions.has(path.extname(filePath).toLowerCase());
}

export function musicRoots() {
  const configured = (process.env.MUSIC_DIRS || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

  const defaults = [path.join(os.homedir(), "Music"), os.homedir()];
  return uniquePaths([...configured, ...defaults].map((root) => path.resolve(root)));
}

export async function browseLocalMusic(requestedPath = "") {
  const roots = await localRoots();
  if (!requestedPath) {
    return {
      current: "",
      parent: null,
      roots: roots.map((root) => ({ name: displayName(root), path: root })),
      directories: [],
      files: []
    };
  }

  const current = path.resolve(requestedPath);
  const stat = await fs.stat(current);
  if (!stat.isDirectory()) throw new Error("Der Pfad ist kein Ordner.");

  const entries = await fs.readdir(current, { withFileTypes: true });
  const directories = [];
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      directories.push({ name: entry.name, path: fullPath });
    } else if (entry.isFile() && isAudioFile(fullPath)) {
      files.push({ name: entry.name, path: fullPath });
    }
  }

  directories.sort((left, right) => left.name.localeCompare(right.name));
  files.sort((left, right) => left.name.localeCompare(right.name));

  return {
    current,
    parent: parentPath(current),
    roots: roots.map((root) => ({ name: displayName(root), path: root })),
    directories,
    files
  };
}

export async function listLocalFiles(inputPath) {
  const resolved = path.resolve(inputPath);
  const stat = await fs.stat(resolved);
  if (stat.isFile()) return isAudioFile(resolved) ? [resolved] : [];

  const entries = await fs.readdir(resolved, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true }));
  const files = [];
  for (const entry of entries) {
    const full = path.join(resolved, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listLocalFiles(full));
    } else if (entry.isFile() && isAudioFile(full)) {
      files.push(full);
    }
  }
  return files;
}

async function localRoots() {
  const roots = [...musicRoots()];
  if (process.platform === "win32") {
    for (let code = 67; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      try {
        const stat = await fs.stat(drive);
        if (stat.isDirectory()) roots.push(drive);
      } catch {
        // Drive letters can be absent or inaccessible.
      }
    }
  } else {
    roots.push("/");
  }
  return uniquePaths(roots);
}

function parentPath(current) {
  const parent = path.dirname(current);
  return normalizeForCompare(parent) === normalizeForCompare(current) ? null : parent;
}

function displayName(root) {
  if (process.platform === "win32" && /^[A-Za-z]:\\$/u.test(root)) return root;
  return path.basename(root) || root;
}

function uniquePaths(paths) {
  const seen = new Set();
  const result = [];
  for (const item of paths) {
    const normalized = normalizeForCompare(item);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(item);
  }
  return result;
}

function normalizeForCompare(value) {
  return path.resolve(value).toLowerCase();
}
