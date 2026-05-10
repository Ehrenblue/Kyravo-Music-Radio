import dotenv from "dotenv";
import { loadConfig } from "./config.js";

dotenv.config({ override: true });

const permissions = String(1024 + 1048576 + 2097152 + 33554432);
const scopes = ["bot", "applications.commands"];

const config = await loadConfig();

for (const bot of config.bots) {
  const token = process.env[bot.tokenEnv];
  const clientId = process.env[bot.clientIdEnv];

  if (!token || !clientId) {
    console.log(`${bot.name}: Token oder Client-ID fehlt.`);
    continue;
  }

  try {
    const before = await discordRequest(token, "GET", "/applications/@me");
    const updated = await discordRequest(token, "PATCH", "/applications/@me", {
      install_params: { scopes, permissions },
      integration_types_config: {
        "0": {
          oauth2_install_params: { scopes, permissions }
        }
      }
    });

    console.log(`${bot.name}: Install-Link fuer Server gesetzt.`);
    console.log(`  App: ${updated.name || before.name || clientId}`);
    console.log(`  Guild Install: ${hasGuildInstall(updated) ? "aktiv" : "nicht bestaetigt"}`);
    console.log(`  Public Bot: ${updated.bot_public === false ? "aus" : "an oder nicht gemeldet"}`);
    console.log(`  Code Grant Pflicht: ${updated.bot_require_code_grant ? "an" : "aus oder nicht gemeldet"}`);
    console.log(`  Link: ${inviteUrl(clientId)}`);
  } catch (error) {
    console.log(`${bot.name}: Install-Einstellungen konnten nicht gesetzt werden: ${error.message}`);
  }
}

function inviteUrl(clientId) {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("permissions", permissions);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("integration_type", "0");
  url.searchParams.set("disable_guild_select", "false");
  return url.toString();
}

function hasGuildInstall(application) {
  return Boolean(application.integration_types_config?.["0"]?.oauth2_install_params);
}

async function discordRequest(token, method, path, body) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (response.ok) return response.json();

  const text = await response.text();
  throw new Error(`Discord HTTP ${response.status}: ${text}`);
}
