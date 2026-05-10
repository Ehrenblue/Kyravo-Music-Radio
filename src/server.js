import express from "express";
import { loadConfig, publicConfig, saveConfig } from "./config.js";
import { updateEnvValues } from "./env-store.js";
import { browseLocalMusic } from "./local-library.js";

export function createServer(manager) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static("public"));

  app.get("/healthz", (_request, response) => {
    response.json({
      ok: true,
      pid: process.pid,
      uptimeSeconds: Math.round(process.uptime())
    });
  });

  app.use("/api", (request, response, next) => {
    const key = process.env.DASHBOARD_KEY;
    if (!key && !isPublicDashboard()) return next();
    if (key && request.headers.authorization === `Bearer ${key}`) return next();
    if (!key) return response.status(503).json({ error: "Dashboard-Key fehlt auf dem Server. Setze DASHBOARD_KEY in den Umgebungsvariablen." });
    response.status(401).json({ error: "Dashboard-Key fehlt oder ist falsch." });
  });

  app.get("/api/config", asyncHandler(async (_request, response) => {
    response.json(publicConfig(await loadConfig()));
  }));

  app.put("/api/config", asyncHandler(async (request, response) => {
    await saveConfig(request.body);
    await manager.reload(request.body);
    response.json(publicConfig(request.body));
  }));

  app.get("/api/status", (_request, response) => {
    response.json(manager.getStatus());
  });

  app.get("/api/local/music", asyncHandler(async (request, response) => {
    response.json(await browseLocalMusic(String(request.query.path || "")));
  }));

  app.put("/api/bots/:id/credentials", asyncHandler(async (request, response) => {
    const config = await loadConfig();
    const bot = config.bots.find((item) => item.id === request.params.id);
    if (!bot) throw new Error("Bot-Slot wurde nicht gefunden.");

    const clientId = String(request.body.clientId || "").trim();
    const token = String(request.body.token || "").trim();
    const updates = {};

    if (clientId) {
      if (!/^\d{15,25}$/.test(clientId)) throw new Error("Die Client-ID sieht nicht wie eine Discord Application ID aus.");
      updates[bot.clientIdEnv] = clientId;
    }

    if (token) {
      if (!/^[\w-]{20,}\.[\w-]{5,}\.[\w-]{20,}$/u.test(token)) throw new Error("Der Token sieht nicht wie ein Discord Bot Token aus.");
      updates[bot.tokenEnv] = token;
    }

    if (!Object.keys(updates).length) throw new Error("Trage mindestens Client-ID oder Token ein.");
    await updateEnvValues(updates);
    await manager.reload(config);
    response.json(publicConfig(config));
  }));

  app.get("/api/discord/guilds", (_request, response) => {
    response.json(manager.getGuilds());
  });

  app.get("/api/discord/guilds/:guildId/voice-channels", asyncHandler(async (request, response) => {
    response.json(await manager.getVoiceChannels({
      botId: request.query.botId,
      guildId: request.params.guildId
    }));
  }));

  app.post("/api/channels/:id/start", asyncHandler(async (request, response) => {
    await manager.startChannel(request.params.id);
    response.json(manager.getStatus());
  }));

  app.post("/api/channels/:id/stop", (request, response) => {
    manager.stopChannel(request.params.id);
    response.json(manager.getStatus());
  });

  app.post("/api/reload", asyncHandler(async (_request, response) => {
    const config = await loadConfig();
    await manager.reload(config);
    response.json(publicConfig(config));
  }));

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(400).json({ error: error.message || "Unerwarteter Serverfehler." });
  });

  return app;
}

function asyncHandler(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function isPublicDashboard() {
  return Boolean(process.env.RENDER || process.env.PORT || process.env.NODE_ENV === "production" || process.env.DASHBOARD_HOST === "0.0.0.0");
}
