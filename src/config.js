import fs from "node:fs/promises";
import path from "node:path";

const defaultConfigPath = path.resolve("config", "channels.json");
const configPath = path.resolve(process.env.CONFIG_PATH || defaultConfigPath);
const backupDir = path.resolve(process.env.CONFIG_BACKUP_DIR || path.dirname(configPath), "backups");

export async function loadConfig() {
  await ensureConfigFile();
  const raw = await fs.readFile(configPath, "utf8");
  return JSON.parse(raw);
}

export async function saveConfig(config) {
  const normalized = normalizeConfig(config);
  validateConfig(normalized);
  await backupCurrentConfig();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function publicConfig(config) {
  return {
    bots: config.bots.map((bot) => ({
      id: bot.id,
      name: bot.name,
      hasToken: Boolean(process.env[bot.tokenEnv]),
      inviteUrl: inviteUrl(process.env[bot.clientIdEnv]),
      clientIdEnv: bot.clientIdEnv,
      tokenEnv: bot.tokenEnv
    })),
    channels: config.channels
  };
}

function inviteUrl(clientId) {
  if (!clientId) return null;
  const permissions = 1024 + 1048576 + 2097152 + 33554432;
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("permissions", String(permissions));
  url.searchParams.set("scope", "bot applications.commands");
  url.searchParams.set("integration_type", "0");
  url.searchParams.set("disable_guild_select", "false");
  return url.toString();
}

export function normalizeConfig(config) {
  return {
    bots: (config.bots || []).map((bot) => ({
      id: bot.id,
      name: bot.name,
      tokenEnv: bot.tokenEnv,
      clientIdEnv: bot.clientIdEnv
    })),
    channels: (config.channels || []).map((channel) => ({
      id: channel.id,
      name: channel.name,
      guildId: channel.guildId,
      voiceChannelId: channel.voiceChannelId,
      botId: channel.botId,
      enabled: Boolean(channel.enabled),
      volume: Number(channel.volume ?? 0.55),
      stayWhenEmpty: channel.stayWhenEmpty !== false,
      sources: channel.sources || []
    }))
  };
}

function validateConfig(config) {
  if (!Array.isArray(config.bots) || config.bots.length === 0) {
    throw new Error("Konfiguration ohne Bot-Slots wird nicht gespeichert.");
  }

  for (const bot of config.bots) {
    if (!bot.id || !bot.tokenEnv || !bot.clientIdEnv) {
      throw new Error("Mindestens ein Bot-Slot ist unvollständig.");
    }
  }
}

async function backupCurrentConfig() {
  try {
    const current = await fs.readFile(configPath, "utf8");
    const parsed = JSON.parse(current);
    if (!Array.isArray(parsed.bots) || parsed.bots.length === 0) return;
    await fs.mkdir(backupDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(path.join(backupDir, `channels-${stamp}.json`), current, "utf8");
  } catch {
    // A missing or malformed current config should not block saving a valid replacement.
  }
}

async function ensureConfigFile() {
  try {
    await fs.access(configPath);
    return;
  } catch {
    // Continue and seed the runtime config from the repository default.
  }

  const seed = await fs.readFile(defaultConfigPath, "utf8");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, seed, "utf8");
}
