import dotenv from "dotenv";
import fs from "node:fs/promises";
import { loadConfig } from "./config.js";
import { RadioBotManager } from "./bot.js";
import { createServer } from "./server.js";

dotenv.config({ override: true });

await ensureConfiguredMusicDirs();

const config = await loadConfig();
const manager = new RadioBotManager(config);
await manager.start();

const port = Number(process.env.PORT || process.env.DASHBOARD_PORT || 3333);
const host = process.env.DASHBOARD_HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const server = createServer(manager).listen(port, host, () => {
  console.log(`Dashboard running at http://${host}:${port}`);
});

async function shutdown(signal) {
  console.log(`Shutdown requested by ${signal}`);
  server.close(async () => {
    await manager.stop();
    process.exit(0);
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function ensureConfiguredMusicDirs() {
  const configuredDirs = (process.env.MUSIC_DIRS || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);

  for (const directory of configuredDirs) {
    await fs.mkdir(directory, { recursive: true }).catch(() => {});
  }
}
