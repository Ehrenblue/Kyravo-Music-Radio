import fs from "node:fs/promises";
import path from "node:path";

const envPath = path.resolve(".env");

export async function updateEnvValues(values) {
  let text = "";
  try {
    text = await fs.readFile(envPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const lines = text ? text.split(/\r?\n/) : [];
  const seen = new Set();
  const nextLines = lines.map((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (!match || !(match[1] in values)) return line;
    seen.add(match[1]);
    return `${match[1]}=${values[match[1]]}`;
  });

  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) nextLines.push(`${key}=${value}`);
    process.env[key] = value;
  }

  await fs.writeFile(envPath, `${nextLines.join("\n").replace(/\n+$/u, "")}\n`, "utf8");
}
