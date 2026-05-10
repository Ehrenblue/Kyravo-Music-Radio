import { ChannelType, Client, GatewayIntentBits } from "discord.js";
import { once } from "node:events";
import { ChannelSession } from "./audio.js";

const radioCommands = [
  {
    name: "play",
    description: "Startet Musik im Voice-Channel, in dem du gerade bist."
  },
  {
    name: "stop",
    description: "Stoppt Musik im Voice-Channel, in dem du gerade bist."
  },
  {
    name: "status",
    description: "Zeigt den Radio-Status fuer deinen aktuellen Voice-Channel."
  }
];

export class RadioBotManager {
  constructor(config) {
    this.config = config;
    this.clients = new Map();
    this.sessions = new Map();
    this.status = new Map();
    this.assignments = new Map();
    this.dynamicChannelIds = new Set();
  }

  async start() {
    await this.stop();

    for (const botConfig of this.config.bots) {
      const token = process.env[botConfig.tokenEnv];
      if (!token) continue;
      const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
      });
      client.once("clientReady", () => console.log(`${botConfig.name} ready as ${client.user.tag}`));
      client.on("voiceStateUpdate", (oldState, newState) => this.onVoiceState(oldState, newState, botConfig.id));
      client.on("interactionCreate", (interaction) => this.onInteraction(interaction).catch((error) => console.error(error)));
      try {
        await client.login(token);
        await waitForReady(client);
        await client.guilds.fetch();
        await registerGuildCommands(client, botConfig.name);
        this.clients.set(botConfig.id, client);
      } catch (error) {
        console.error(`Bot '${botConfig.id}' konnte sich nicht anmelden: ${error.message}`);
        client.destroy();
      }
    }

    const assignmentErrors = this.buildAssignments();

    for (const channel of this.config.channels.filter((item) => item.enabled)) {
      if (assignmentErrors.has(channel.id)) {
        this.status.set(channel.id, { state: "blocked", current: null, error: assignmentErrors.get(channel.id) });
        continue;
      }

      const assignedBotId = this.assignments.get(channel.id);
      const client = this.clients.get(assignedBotId);
      if (!client) {
        this.status.set(channel.id, { state: "offline", current: null, error: "Bot token fehlt oder Login fehlgeschlagen." });
        continue;
      }
      this.sessions.set(channel.id, new ChannelSession({ client, channelConfig: channel, status: this.status }));
      this.status.set(channel.id, { state: "armed", current: null, error: null, botId: assignedBotId });
    }
  }

  async stop() {
    for (const session of this.sessions.values()) session.stop();
    this.sessions.clear();
    this.assignments.clear();
    this.dynamicChannelIds.clear();
    for (const client of this.clients.values()) client.destroy();
    this.clients.clear();
  }

  async reload(config) {
    this.config = config;
    await this.start();
  }

  async startChannel(channelId) {
    const session = this.sessions.get(channelId);
    if (!session) throw new Error("Channel ist nicht aktiv oder kein Bot ist angemeldet.");
    await session.start();
  }

  stopChannel(channelId) {
    this.sessions.get(channelId)?.stop();
  }

  async onInteraction(interaction) {
    if (!interaction.isChatInputCommand() || !["play", "stop", "status"].includes(interaction.commandName)) return;

    await interaction.deferReply({ ephemeral: true });

    try {
      const channel = await this.channelForInteraction(interaction);
      if (!channel) {
        await interaction.editReply("Geh zuerst in einen Voice-Channel und nutze den Befehl dort erneut.");
        return;
      }

      if (interaction.commandName === "play") {
        await this.startChannel(channel.id);
        await interaction.editReply(`Radio gestartet: ${channel.name || channel.id}`);
        return;
      }

      if (interaction.commandName === "stop") {
        this.stopChannel(channel.id);
        await interaction.editReply(`Radio gestoppt: ${channel.name || channel.id}`);
        return;
      }

      const state = this.status.get(channel.id);
      await interaction.editReply(channelStatusText(channel, state));
    } catch (error) {
      await interaction.editReply(error.message || "Der Befehl konnte nicht ausgefuehrt werden.");
    }
  }

  getStatus() {
    const result = Object.fromEntries(this.status.entries());
    for (const [channelId, botId] of this.assignments.entries()) {
      result[channelId] = { ...(result[channelId] || {}), botId };
    }
    for (const [channelId, session] of this.sessions.entries()) {
      if (!this.dynamicChannelIds.has(channelId)) continue;
      result[channelId] = {
        ...(result[channelId] || {}),
        botId: session.config.botId,
        dynamic: true
      };
    }
    return result;
  }

  getGuilds() {
    const guilds = [];
    for (const [botId, client] of this.clients.entries()) {
      for (const guild of client.guilds.cache.values()) {
        guilds.push({
          botId,
          id: guild.id,
          name: guild.name,
          memberCount: guild.memberCount ?? null
        });
      }
    }
    return guilds.sort((left, right) => `${left.botId}:${left.name}`.localeCompare(`${right.botId}:${right.name}`));
  }

  async getVoiceChannels({ botId, guildId }) {
    const client = this.clientForGuild(botId, guildId);
    if (!client) throw new Error(`Bot '${botId}' ist nicht angemeldet.`);

    const guild = await client.guilds.fetch(guildId);
    const channels = await guild.channels.fetch();
    return [...channels.values()]
      .filter((channel) => channel && channel.type === ChannelType.GuildVoice)
      .sort((left, right) => left.rawPosition - right.rawPosition)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        parentName: channel.parent?.name || null
      }));
  }

  async onVoiceState(oldState, newState, botId) {
    if (newState.member?.user.bot) return;
    if (oldState.channelId === newState.channelId) return;

    const leftChannel = oldState.channelId
      ? this.findManagedChannelForVoice(oldState.guild.id, oldState.channelId, botId)
      : null;
    if (leftChannel) {
      const humansLeft = oldState.channel?.members.filter((member) => !member.user.bot).size ?? 0;
      if (humansLeft === 0) this.sessions.get(leftChannel.id)?.stop();
    }

    // Joining is command-driven only. Voice updates are only used to leave empty channels.
  }

  buildAssignments() {
    this.assignments.clear();
    const used = new Map();
    const errors = new Map();

    const enabledChannels = this.config.channels.filter((item) => item.enabled);
    for (const channel of enabledChannels.filter((item) => item.botId && item.botId !== "auto")) {
      this.assignExplicitBot(channel, used, errors);
    }

    for (const channel of enabledChannels.filter((item) => !item.botId || item.botId === "auto")) {
      this.assignAutomaticBot(channel, used, errors);
    }

    return errors;
  }

  assignExplicitBot(channel, used, errors) {
    const client = this.clients.get(channel.botId);
    if (!client) {
      errors.set(channel.id, `Bot '${channel.botId}' ist nicht angemeldet. Token fehlt oder Login ist fehlgeschlagen.`);
      return;
    }
    if (!client.guilds.cache.has(channel.guildId)) {
      errors.set(channel.id, `Bot '${channel.botId}' ist noch nicht auf diesem Discord-Server eingeladen.`);
      return;
    }

    const key = `${channel.botId}:${channel.guildId}`;
    if (used.has(key)) {
      errors.set(channel.id, `Bot '${channel.botId}' ist in diesem Server schon fuer '${used.get(key)}' aktiv. Waehle 'Automatisch' oder einen anderen Bot aus dem Pool.`);
      return;
    }

    used.set(key, channel.name || channel.id);
    this.assignments.set(channel.id, channel.botId);
  }

  assignAutomaticBot(channel, used, errors) {
    const candidates = [...this.clients.entries()]
      .filter(([, client]) => client.guilds.cache.has(channel.guildId))
      .map(([botId]) => botId);

    for (const botId of candidates) {
      const assignedKey = `${botId}:${channel.guildId}`;
      if (!used.has(assignedKey)) {
        used.set(assignedKey, channel.name || channel.id);
        this.assignments.set(channel.id, botId);
        return;
      }
    }

    const needed = this.config.channels.filter((item) =>
      item.enabled &&
      item.guildId === channel.guildId &&
      (!item.botId || item.botId === "auto" || this.clients.has(item.botId))
    ).length;
    const available = candidates.length;
    errors.set(channel.id, `Kein freier Bot im Pool fuer diesen Server. Aktive Channels: ${needed}, eingeladene Bot-Accounts: ${available}. Lade weitere Bot-Accounts auf diesen Server ein und trage ihre Tokens ein.`);
  }

  assignedBotId(channel) {
    return this.assignments.get(channel.id) || channel.botId;
  }

  clientForGuild(botId, guildId) {
    if (botId && botId !== "auto") return this.clients.get(botId);
    return [...this.clients.values()].find((client) => client.guilds.cache.has(guildId));
  }

  async channelForInteraction(interaction) {
    if (!interaction.inGuild()) return null;

    const voiceState = interaction.guild.voiceStates.cache.get(interaction.user.id)
      || await interaction.guild.voiceStates.fetch(interaction.user.id).catch(() => null);
    const voiceChannelId = voiceState?.channelId;
    if (!voiceChannelId) return null;

    return this.findConfiguredChannelForVoice(interaction.guildId, voiceChannelId)
      || this.findManagedChannelForVoice(interaction.guildId, voiceChannelId)
      || this.ensureDynamicChannel({
        guildId: interaction.guildId,
        voiceChannelId,
        voiceChannelName: voiceState.channel?.name
      });
  }

  findConfiguredChannelForVoice(guildId, voiceChannelId, botId = null) {
    return this.config.channels.find((channel) =>
      channel.enabled &&
      channel.guildId === guildId &&
      channel.voiceChannelId === voiceChannelId &&
      (!botId || this.assignedBotId(channel) === botId)
    ) || null;
  }

  findManagedChannelForVoice(guildId, voiceChannelId, botId = null) {
    for (const session of this.sessions.values()) {
      const channel = session.config;
      if (
        channel.guildId === guildId &&
        channel.voiceChannelId === voiceChannelId &&
        (!botId || this.assignedBotId(channel) === botId)
      ) {
        return channel;
      }
    }
    return null;
  }

  ensureDynamicChannel({ guildId, voiceChannelId, voiceChannelName }) {
    const existing = this.findManagedChannelForVoice(guildId, voiceChannelId);
    if (existing) return existing;

    const id = dynamicChannelId(guildId, voiceChannelId);
    const template = this.defaultChannelTemplate(guildId);
    if (!template) {
      this.status.set(id, {
        state: "blocked",
        current: null,
        error: "Keine Standard-Musikquelle konfiguriert. Lege im Dashboard mindestens eine Quelle an.",
        dynamic: true
      });
      return null;
    }

    const botId = this.availableBotForGuild(guildId);
    if (!botId) {
      this.status.set(id, {
        state: "blocked",
        current: null,
        error: "Kein freier Bot im Pool fuer diesen Server. Jeder gleichzeitig bespielte Voice-Channel braucht einen eigenen eingeladenen Bot-Account.",
        dynamic: true
      });
      return null;
    }

    const client = this.clients.get(botId);
    const channel = {
      ...template,
      id,
      name: voiceChannelName ? `${voiceChannelName} (auto)` : `Voice-Channel ${voiceChannelId}`,
      guildId,
      voiceChannelId,
      botId,
      enabled: true,
      stayWhenEmpty: false,
      sources: [...(template.sources || [])]
    };

    this.dynamicChannelIds.add(id);
    this.sessions.set(id, new ChannelSession({ client, channelConfig: channel, status: this.status }));
    this.status.set(id, { state: "armed", current: null, error: null, botId, dynamic: true });
    return channel;
  }

  defaultChannelTemplate(guildId) {
    return this.config.channels.find((channel) => channel.enabled && channel.guildId === guildId && channel.sources?.length)
      || this.config.channels.find((channel) => channel.guildId === guildId && channel.sources?.length)
      || this.config.channels.find((channel) => channel.enabled && channel.sources?.length)
      || this.config.channels.find((channel) => channel.sources?.length)
      || null;
  }

  availableBotForGuild(guildId) {
    const candidates = [...this.clients.entries()]
      .filter(([, client]) => client.guilds.cache.has(guildId))
      .map(([botId]) => botId);
    const active = this.activeBotIdsForGuild(guildId);
    const reserved = this.configuredBotIdsForGuild(guildId);
    return candidates.find((botId) => !active.has(botId) && !reserved.has(botId))
      || candidates.find((botId) => !active.has(botId))
      || null;
  }

  activeBotIdsForGuild(guildId) {
    const active = new Set();
    for (const session of this.sessions.values()) {
      if (!session.connection) continue;
      if (session.config.guildId !== guildId) continue;
      const botId = this.assignedBotId(session.config);
      if (botId) active.add(botId);
    }
    return active;
  }

  configuredBotIdsForGuild(guildId) {
    const reserved = new Set();
    for (const channel of this.config.channels) {
      if (!channel.enabled || channel.guildId !== guildId) continue;
      const botId = this.assignedBotId(channel);
      if (botId && botId !== "auto") reserved.add(botId);
    }
    return reserved;
  }
}

async function waitForReady(client) {
  if (client.isReady()) return;
  await once(client, "clientReady");
}

async function registerGuildCommands(client, botName) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.commands.set(radioCommands);
    } catch (error) {
      console.error(`${botName}: Slash-Commands konnten auf '${guild.name}' nicht registriert werden: ${error.message}`);
    }
  }
}

function channelStatusText(channel, state) {
  if (!state) return `Status fuer ${channel.name || channel.id}: unbekannt`;
  if (state.error) return `Status fuer ${channel.name || channel.id}: ${state.state} - ${state.error}`;
  if (state.current) return `Status fuer ${channel.name || channel.id}: ${state.state} - ${state.current}`;
  return `Status fuer ${channel.name || channel.id}: ${state.state}`;
}

function dynamicChannelId(guildId, voiceChannelId) {
  return `dynamic-${guildId}-${voiceChannelId}`;
}
