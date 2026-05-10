import dotenv from "dotenv";
import { loadConfig } from "./config.js";

dotenv.config({ override: true });

const permissions = 1024 + 1048576 + 2097152 + 33554432;
const config = await loadConfig();

for (const bot of config.bots) {
  const clientId = process.env[bot.clientIdEnv];
  if (!clientId) {
    console.log(`${bot.name}: ${bot.clientIdEnv} fehlt in .env`);
    continue;
  }
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("permissions", String(permissions));
  url.searchParams.set("scope", "bot applications.commands");
  url.searchParams.set("integration_type", "0");
  url.searchParams.set("disable_guild_select", "false");
  console.log(`${bot.name}: ${url.toString()}`);
}
