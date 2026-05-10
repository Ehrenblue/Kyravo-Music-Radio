let config = { bots: [], channels: [] };
let status = {};
let discordGuilds = [];

const voiceChannelCache = new Map();
const pendingVoiceLoads = new Set();
const localAudioExtensions = new Set([".aac", ".flac", ".m4a", ".mp3", ".ogg", ".opus", ".wav", ".webm"]);

const els = {
  key: document.querySelector("#key"),
  stats: document.querySelector("#stats"),
  bots: document.querySelector("#bots"),
  channels: document.querySelector("#channels"),
  notice: document.querySelector("#notice"),
  reload: document.querySelector("#reload"),
  save: document.querySelector("#save"),
  addChannel: document.querySelector("#addChannel")
};

els.key.value = localStorage.getItem("dashboardKey") || "";
els.key.addEventListener("input", () => localStorage.setItem("dashboardKey", els.key.value));

function headers() {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${els.key.value}`
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...headers(), ...options.headers } });
  if (!response.ok) {
    let message = response.statusText;
    try {
      message = (await response.json()).error || message;
    } catch {
      message = await response.text().catch(() => message);
    }
    throw new Error(message);
  }
  return response.json();
}

function setNotice(text) {
  if (!els.notice) return;
  els.notice.textContent = text;
  window.clearTimeout(setNotice.timer);
  setNotice.timer = window.setTimeout(() => els.notice.textContent = "", 4500);
}

function reportError(error) {
  console.error(error);
  setNotice(error?.message || "Dashboard-Fehler");
}

async function load() {
  config = await api("/api/config");
  status = await api("/api/status");
  await loadGuilds();
  render();
}

async function loadGuilds() {
  try {
    discordGuilds = await api("/api/discord/guilds");
  } catch (error) {
    discordGuilds = [];
    setNotice(error.message);
  }
}

async function loadVoiceChannels(channel) {
  if (!channel.botId || !channel.guildId) return [];
  const key = `${channel.botId}:${channel.guildId}`;
  if (voiceChannelCache.has(key)) return voiceChannelCache.get(key);
  if (pendingVoiceLoads.has(key)) return [];

  pendingVoiceLoads.add(key);
  try {
    const channels = await api(`/api/discord/guilds/${channel.guildId}/voice-channels?botId=${encodeURIComponent(channel.botId)}`);
    voiceChannelCache.set(key, channels);
    return channels;
  } catch (error) {
    setNotice(error.message);
    return [];
  } finally {
    pendingVoiceLoads.delete(key);
  }
}

function queueVoiceLoad(channel) {
  if (!channel.botId || !channel.guildId) return;
  const key = `${channel.botId}:${channel.guildId}`;
  if (voiceChannelCache.has(key) || pendingVoiceLoads.has(key)) return;
  loadVoiceChannels(channel)
    .then(() => {
      if (!shouldPauseAutoRender()) render();
    })
    .catch((error) => setNotice(error.message));
}

function render() {
  try {
    renderUnsafe();
  } catch (error) {
    reportError(error);
  }
}

function renderUnsafe() {
  renderStats();

  els.bots.innerHTML = config.bots.map((bot) => {
    const serverCount = discordGuilds.filter((guild) => guild.botId === bot.id).length;
    const tokenClass = bot.hasToken ? "token-ok" : "token-missing";
    return `
      <article class="bot-card ${tokenClass}" data-bot-id="${escapeHtml(bot.id)}">
        <div class="card-head">
          <div>
            <h3>${escapeHtml(bot.name)}</h3>
            <p class="muted">${escapeHtml(bot.id)}</p>
          </div>
          <span class="badge ${bot.hasToken ? "success" : "warning"}">${bot.hasToken ? "Token aktiv" : "Token fehlt"}</span>
        </div>
        <div class="metric-row">
          <div>
            <strong>${serverCount}</strong>
            <span>Server</span>
          </div>
          <div>
            <strong>${bot.inviteUrl ? "bereit" : "fehlt"}</strong>
            <span>Invite</span>
          </div>
        </div>
        <div class="bot-credentials">
          <label class="field">Client-ID
            <input data-credential="clientId" type="text" inputmode="numeric" placeholder="${escapeHtml(bot.clientIdEnv)}">
          </label>
          <label class="field">Bot-Token
            <input data-credential="token" type="password" autocomplete="off" placeholder="${bot.hasToken ? "Token ersetzen" : bot.tokenEnv}">
          </label>
          <button data-action="saveBot" type="button">Bot-Zugang speichern</button>
        </div>
        <div class="button-row">
          ${bot.inviteUrl ? `<a class="link-button" href="${escapeHtml(bot.inviteUrl)}" target="_blank" rel="noreferrer">Bot einladen</a>` : `<a class="link-button" href="https://discord.com/developers/applications" target="_blank" rel="noreferrer">Developer Portal</a>`}
        </div>
      </article>
    `;
  }).join("");

  for (const botCard of els.bots.querySelectorAll("[data-bot-id]")) {
    botCard.querySelector("[data-action='saveBot']").addEventListener("click", () => saveBotCredentials(botCard).catch(reportError));
  }

  els.channels.innerHTML = "";
  for (const channel of config.channels) {
    els.channels.append(channelView(channel));
  }
}

function renderStats() {
  if (!els.stats) return;
  const states = Object.values(status);
  const playing = states.filter((item) => item.state === "playing").length;
  const blocked = states.filter((item) => ["blocked", "error", "offline"].includes(item.state)).length;
  const activeChannels = config.channels.filter((channel) => channel.enabled).length;
  const tokenBots = config.bots.filter((bot) => bot.hasToken).length;
  const servers = uniqueGuilds(discordGuilds).length;

  els.stats.innerHTML = [
    statCard("Aktive Channels", activeChannels, "bereit"),
    statCard("Spielt gerade", playing, "live"),
    statCard("Discord-Server", servers, "verbunden"),
    statCard("Bot-Tokens", `${tokenBots}/${config.bots.length}`, blocked ? `${blocked} blockiert` : "ok")
  ].join("");
}

function statCard(label, value, note) {
  return `
    <article class="stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(note)}</small>
    </article>
  `;
}

async function saveBotCredentials(botCard) {
  const id = botCard.dataset.botId;
  const clientId = botCard.querySelector("[data-credential='clientId']").value;
  const token = botCard.querySelector("[data-credential='token']").value;
  config = await api(`/api/bots/${encodeURIComponent(id)}/credentials`, {
    method: "PUT",
    body: JSON.stringify({ clientId, token })
  });
  voiceChannelCache.clear();
  await loadGuilds();
  render();
  setNotice("Bot-Zugang gespeichert und Pool neu geladen");
}

function channelView(channel) {
  queueVoiceLoad(channel);

  const item = document.createElement("article");
  const state = status[channel.id] || { state: channel.enabled ? "armed" : "disabled" };
  item.className = `channel-card ${state.state || "unknown"}`;
  const guildsForBot = discordGuilds.filter((guild) => guild.botId === channel.botId);
  const selectedGuild = discordGuilds.find((guild) => guild.botId === channel.botId && guild.id === channel.guildId);
  const voiceChannels = voiceChannelCache.get(`${channel.botId}:${channel.guildId}`) || [];
  const selectedVoice = voiceChannels.find((voice) => voice.id === channel.voiceChannelId);

  item.innerHTML = `
    <header class="channel-top">
      <div class="channel-identity">
        <input data-field="enabled" type="checkbox" ${channel.enabled ? "checked" : ""} aria-label="Channel aktivieren">
        <div>
          <h3>${escapeHtml(channel.name || "Neuer Channel")}</h3>
          <p class="muted">${escapeHtml(channelMeta(channel, state))}</p>
        </div>
      </div>
      <span class="status ${escapeHtml(state.state || "")}">${escapeHtml(state.state || "unknown")}</span>
    </header>

    <div class="quick-facts">
      <span>Bot: ${escapeHtml(state.botId || channel.botId || "auto")}</span>
      <span>Quellen: ${channel.sources?.length || 0}</span>
      <span>Lautstärke: ${Math.round(Number(channel.volume ?? 0.55) * 100)}%</span>
    </div>

    <div class="form-section">
      <h4>Routing</h4>
      <div class="channel-grid">
        ${field("Name", "name", channel.name)}
        ${selectField("Bot", "botId", channel.botId || "auto", botOptions(), "data-rerender=\"true\"")}
        ${guildSelect(channel, guildsForBot, selectedGuild)}
        ${voiceSelect(channel, voiceChannels, selectedVoice)}
        ${field("Lautstärke", "volume", channel.volume ?? 0.55, "number", "0.05", "0", "1")}
        <label class="field">Leer weiterlaufen
          <select data-field="stayWhenEmpty">
            <option value="true" ${channel.stayWhenEmpty !== false ? "selected" : ""}>Ja</option>
            <option value="false" ${channel.stayWhenEmpty === false ? "selected" : ""}>Nein</option>
          </select>
        </label>
      </div>
    </div>

    <details class="advanced-section">
      <summary>Manuelle IDs</summary>
      <div class="advanced-grid">
        ${field("Server-ID", "guildId", channel.guildId)}
        ${field("Voice-Channel-ID", "voiceChannelId", channel.voiceChannelId)}
      </div>
    </details>

    <div class="source-panel">
      <div class="subsection-head">
        <h4>Quellen</h4>
        <button data-action="addSource" type="button" class="mini-button">Quelle hinzufügen</button>
      </div>
      <div class="source-list"></div>
    </div>

    <div class="channel-actions">
      <button data-action="start" type="button" class="primary">Starten</button>
      <button data-action="stop" type="button">Stoppen</button>
      <button data-action="remove" type="button" class="danger-button">Entfernen</button>
    </div>
  `;

  for (const input of item.querySelectorAll("[data-field]")) {
    input.addEventListener("input", () => {
      updateChannel(channel, input);
      if (input.dataset.rerender === "true") render();
    });
  }

  item.querySelector("[data-discord='guild']")?.addEventListener("change", async (event) => {
    const guild = discordGuilds.find((entry) => entry.botId === channel.botId && entry.id === event.target.value);
    channel.guildId = event.target.value;
    channel.voiceChannelId = "";
    if (guild && (!channel.name || channel.name === "Neuer Radio-Channel")) channel.name = guild.name;
    await loadVoiceChannels(channel);
    render();
  });

  item.querySelector("[data-discord='voice']")?.addEventListener("change", (event) => {
    channel.voiceChannelId = event.target.value;
    const voice = voiceChannelCache.get(`${channel.botId}:${channel.guildId}`)?.find((entry) => entry.id === channel.voiceChannelId);
    if (voice && selectedGuild && (!channel.name || channel.name === selectedGuild.name || channel.name === "Neuer Radio-Channel")) {
      channel.name = `${selectedGuild.name} / ${voice.name}`;
    }
    render();
  });

  const sourceList = item.querySelector(".source-list");
  renderSources(sourceList, channel);

  item.querySelector("[data-action='addSource']").addEventListener("click", () => {
    channel.sources ||= [];
    channel.sources.push({ type: "youtube", value: "" });
    renderSources(sourceList, channel);
  });
  item.querySelector("[data-action='start']").addEventListener("click", () => control(channel.id, "start").catch((error) => setNotice(error.message)));
  item.querySelector("[data-action='stop']").addEventListener("click", () => control(channel.id, "stop").catch((error) => setNotice(error.message)));
  item.querySelector("[data-action='remove']").addEventListener("click", () => {
    config.channels = config.channels.filter((entry) => entry !== channel);
    render();
  });

  return item;
}

function channelMeta(channel, state) {
  if (state.current || state.error) return state.current || state.error;
  if ((channel.botId || "auto") === "auto" && state.botId) return `Automatisch zugewiesen: ${state.botId}`;
  if ((channel.botId || "auto") === "auto") return "Bot-Pool: automatisch zuweisen";
  return "Wartet auf User im Voice-Channel";
}

function botOptions() {
  return [
    { value: "auto", label: "Automatisch (Bot-Pool)" },
    ...config.bots.map((bot) => ({ value: bot.id, label: bot.name || bot.id }))
  ];
}

function guildSelect(channel, guilds, selectedGuild) {
  if ((channel.botId || "auto") === "auto") {
    guilds = uniqueGuilds(discordGuilds);
    selectedGuild = guilds.find((guild) => guild.id === channel.guildId);
  }
  const options = guilds.map((guild) => ({
    value: guild.id,
    label: guild.name
  }));
  if (channel.guildId && !selectedGuild) {
    options.unshift({ value: channel.guildId, label: `Manuelle ID: ${channel.guildId}` });
  }
  return selectField("Discord-Server", "guildIdPicker", channel.guildId, options, "data-discord=\"guild\"", "Server auswählen");
}

function voiceSelect(channel, voices, selectedVoice) {
  const options = voices.map((voice) => ({
    value: voice.id,
    label: voice.parentName ? `${voice.parentName} / ${voice.name}` : voice.name
  }));
  if (channel.voiceChannelId && !selectedVoice) {
    options.unshift({ value: channel.voiceChannelId, label: `Manuelle ID: ${channel.voiceChannelId}` });
  }
  const placeholder = channel.guildId && !voices.length ? "Voice-Channels laden" : "Voice-Channel auswählen";
  return selectField("Voice-Channel", "voiceChannelIdPicker", channel.voiceChannelId, options, "data-discord=\"voice\"", placeholder);
}

function uniqueGuilds(guilds) {
  const byId = new Map();
  for (const guild of guilds) {
    if (!byId.has(guild.id)) byId.set(guild.id, { ...guild });
  }
  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function field(label, name, value, type = "text", step = "", min = "", max = "") {
  return `<label class="field">${label}
    <input data-field="${name}" type="${type}" value="${escapeHtml(String(value || ""))}" step="${step}" min="${min}" max="${max}">
  </label>`;
}

function selectField(label, name, value, options, attrs = "", placeholder = "") {
  const placeholderOption = placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : "";
  return `<label class="field">${label}
    <select data-field="${name}" ${attrs}>
      ${placeholderOption}
      ${options.map((option) => `<option value="${escapeHtml(option.value)}" ${String(value || "") === String(option.value) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
    </select>
  </label>`;
}

function renderSources(container, channel) {
  container.innerHTML = "";
  channel.sources ||= [];
  channel.sources.forEach((source, index) => {
    const row = document.createElement("div");
    row.className = `source source-${source.type || "youtube"}`;
    row.innerHTML = `
      <span class="source-dot" aria-hidden="true"></span>
      <select aria-label="Quellentyp">
        <option value="local" ${source.type === "local" ? "selected" : ""}>Lokal</option>
        <option value="youtube" ${source.type === "youtube" ? "selected" : ""}>YouTube</option>
        <option value="spotify" ${source.type === "spotify" ? "selected" : ""}>Spotify</option>
      </select>
      <input type="text" value="${escapeHtml(source.value || "")}" aria-label="Quelle">
      <button class="icon-button" type="button" aria-label="Quelle entfernen">x</button>
      ${source.type === "local" ? `<div class="local-actions"><button data-action="browseLocal" type="button">Auswählen</button></div>` : ""}
    `;
    row.querySelector("select").addEventListener("input", (event) => {
      source.type = event.target.value;
      renderSources(container, channel);
    });
    row.querySelector("input").addEventListener("input", (event) => source.value = event.target.value);
    row.querySelector("[aria-label='Quelle entfernen']").addEventListener("click", () => {
      channel.sources.splice(index, 1);
      renderSources(container, channel);
    });
    row.querySelector("[data-action='browseLocal']")?.addEventListener("click", () => openLocalBrowser(row, container, channel, source, initialLocalPath(source.value)));
    container.append(row);
  });
}

function initialLocalPath(value) {
  if (!value || /^https?:\/\//i.test(value)) return "";
  if (hasLocalAudioExtension(value)) return parentDirectory(value);
  return value;
}

function hasLocalAudioExtension(value) {
  const normalized = String(value).replaceAll("\\", "/");
  const fileName = normalized.split("/").pop() || "";
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0) return false;
  return localAudioExtensions.has(fileName.slice(dotIndex).toLowerCase());
}

function parentDirectory(value) {
  const separator = value.includes("\\") ? "\\" : "/";
  if (separator === "\\" && /^[A-Za-z]:\\[^\\]+$/u.test(value)) return value.slice(0, 3);
  const index = value.lastIndexOf(separator);
  if (index <= 0) return "";
  return value.slice(0, index);
}

async function openLocalBrowser(row, sourceContainer, channel, source, requestedPath = "") {
  let browser = row.querySelector(".local-browser");
  if (!browser) {
    browser = document.createElement("div");
    browser.className = "local-browser";
    row.append(browser);
  }

  browser.innerHTML = `<p class="muted">Lädt...</p>`;
  try {
    const data = await api(`/api/local/music?path=${encodeURIComponent(requestedPath)}`);
    renderLocalBrowser(browser, sourceContainer, channel, source, data);
  } catch (error) {
    browser.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

function renderLocalBrowser(browser, sourceContainer, channel, source, data) {
  const pathInput = `
    <div class="path-open">
      <input data-manual-path type="text" value="${escapeHtml(data.current || source.value || "")}" placeholder="Ordnerpfad eingeben, z. B. D:\\Musik">
      <button data-open-manual type="button">Pfad öffnen</button>
      <button data-use-manual type="button">Pfad übernehmen</button>
    </div>
  `;

  if (!data.current) {
    browser.innerHTML = `
      <div class="browser-head"><span class="muted">Laufwerke und Ordner</span></div>
      ${pathInput}
      <div class="browser-list">
        ${data.roots.map((root) => `<button data-path="${escapeHtml(root.path)}" type="button">${escapeHtml(root.path)}</button>`).join("")}
      </div>
    `;
  } else {
    browser.innerHTML = `
      <div class="browser-head">
        <span title="${escapeHtml(data.current)}">${escapeHtml(data.current)}</span>
        <button data-add-current type="button">Ordner übernehmen</button>
        ${data.parent ? `<button data-parent="${escapeHtml(data.parent)}" type="button">Zurück</button>` : ""}
      </div>
      ${pathInput}
      <div class="browser-list">
        ${data.directories.map((item) => `<button data-path="${escapeHtml(item.path)}" type="button">[Ordner] ${escapeHtml(item.name)}</button>`).join("")}
        ${data.files.map((item) => `<button data-file="${escapeHtml(item.path)}" type="button">${escapeHtml(item.name)}</button>`).join("")}
      </div>
    `;
  }

  for (const button of browser.querySelectorAll("[data-path]")) {
    button.addEventListener("click", () => openLocalBrowser(browser.parentElement, sourceContainer, channel, source, button.dataset.path));
  }
  browser.querySelector("[data-parent]")?.addEventListener("click", (event) => {
    openLocalBrowser(browser.parentElement, sourceContainer, channel, source, event.currentTarget.dataset.parent);
  });
  browser.querySelector("[data-open-manual]")?.addEventListener("click", () => {
    const manualPath = browser.querySelector("[data-manual-path]").value.trim();
    if (!manualPath) return setNotice("Bitte einen Ordnerpfad eingeben");
    openLocalBrowser(browser.parentElement, sourceContainer, channel, source, manualPath);
  });
  browser.querySelector("[data-use-manual]")?.addEventListener("click", () => {
    const manualPath = browser.querySelector("[data-manual-path]").value.trim();
    if (!manualPath) return setNotice("Bitte einen Ordnerpfad eingeben");
    source.type = "local";
    source.value = manualPath;
    renderSources(sourceContainer, channel);
    setNotice("Lokaler Pfad übernommen");
  });
  browser.querySelector("[data-add-current]")?.addEventListener("click", () => {
    source.type = "local";
    source.value = data.current;
    renderSources(sourceContainer, channel);
    setNotice("Lokaler Ordner übernommen");
  });
  for (const button of browser.querySelectorAll("[data-file]")) {
    button.addEventListener("click", () => {
      source.type = "local";
      source.value = button.dataset.file;
      renderSources(sourceContainer, channel);
      setNotice("Lokale Datei übernommen");
    });
  }
}

function updateChannel(channel, input) {
  const key = input.dataset.field;
  if (key.endsWith("Picker")) return;
  if (input.type === "checkbox") channel[key] = input.checked;
  else if (input.type === "number") channel[key] = Number(input.value);
  else if (input.tagName === "SELECT" && ["true", "false"].includes(input.value)) channel[key] = input.value === "true";
  else {
    channel[key] = input.value;
    if (key === "botId") {
      channel.voiceChannelId = "";
      voiceChannelCache.clear();
    }
  }
}

async function control(id, action) {
  status = await api(`/api/channels/${id}/${action}`, { method: "POST" });
  render();
}

els.reload.addEventListener("click", async () => {
  try {
    await api("/api/reload", { method: "POST" });
    voiceChannelCache.clear();
    await load();
    setNotice("Aktualisiert");
  } catch (error) {
    reportError(error);
  }
});

els.save.addEventListener("click", async () => {
  try {
    config = await api("/api/config", { method: "PUT", body: JSON.stringify(config) });
    voiceChannelCache.clear();
    await load();
    setNotice("Gespeichert");
  } catch (error) {
    reportError(error);
  }
});

els.addChannel.addEventListener("click", () => {
  config.channels.push({
    id: `channel-${Date.now()}`,
    name: "Neuer Radio-Channel",
    guildId: "",
    voiceChannelId: "",
    botId: "auto",
    enabled: false,
    volume: 0.55,
    stayWhenEmpty: true,
    sources: []
  });
  render();
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[char]);
}

load().catch((error) => setNotice(error.message));
window.addEventListener("error", (event) => reportError(event.error || new Error(event.message)));
window.addEventListener("unhandledrejection", (event) => reportError(event.reason));
setInterval(async () => {
  try {
    status = await api("/api/status");
    if (shouldPauseAutoRender()) return;
    render();
  } catch {
    // Keep the current UI readable while the bot process restarts.
  }
}, 5000);

function shouldPauseAutoRender() {
  if (document.querySelector(".local-browser")) return true;
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  return active.matches("input, select, textarea");
}
