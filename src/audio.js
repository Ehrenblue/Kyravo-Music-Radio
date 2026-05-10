import { spawn } from "node:child_process";
import { createAudioPlayer, createAudioResource, entersState, joinVoiceChannel, AudioPlayerStatus, VoiceConnectionStatus, StreamType, NoSubscriberBehavior } from "@discordjs/voice";
import ffmpegPath from "ffmpeg-static";
import { expandSources } from "./library.js";
import { runYtdlp, sanitizeYoutubeUrl, ytdlpPath } from "./media-tools.js";

const playlistRefreshMs = Math.max(30, Number(process.env.PLAYLIST_REFRESH_SECONDS || 300)) * 1000;

export class ChannelSession {
  constructor({ client, channelConfig, status }) {
    this.client = client;
    this.config = channelConfig;
    this.status = status;
    this.queue = [];
    this.queueLoadedAt = 0;
    this.current = null;
    this.connection = null;
    this.ffmpeg = null;
    this.downloader = null;
    this.player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play }
    });

    this.player.on(AudioPlayerStatus.Idle, () => this.playNext().catch((error) => this.fail(error)));
    this.player.on("error", (error) => this.fail(error));
  }

  async connect() {
    const guild = await this.client.guilds.fetch(this.config.guildId);
    const channel = await guild.channels.fetch(this.config.voiceChannelId);
    this.connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });
    this.connection.subscribe(this.player);
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
    this.status.set(this.config.id, { state: "connected", current: this.current?.title || null, error: null });
  }

  async start() {
    const isJoining = !this.connection;
    if (isJoining) this.resetQueue();
    if (!this.connection) await this.connect();
    if (isJoining || this.player.state.status === AudioPlayerStatus.Idle) await this.playNext({ reload: isJoining });
  }

  stop() {
    this.player.stop(true);
    this.resetQueue();
    this.cleanupProcesses();
    this.connection?.destroy();
    this.connection = null;
    this.status.set(this.config.id, { state: "stopped", current: null, error: null });
  }

  async playNext({ reload = false } = {}) {
    this.cleanupProcesses();
    if (reload) this.resetQueue();
    if (!this.queue.length) {
      await this.refreshQueue({ keepExistingOnEmpty: !reload });
    } else if (this.shouldRefreshQueue()) {
      await this.refreshQueue({ keepExistingOnEmpty: true, preserveProgress: true });
    }
    if (!this.queue.length) {
      this.status.set(this.config.id, { state: "waiting", current: null, error: "Keine abspielbaren Quellen gefunden." });
      return;
    }

    this.current = this.queue.shift();
    const resource = await this.resourceFor(this.current);
    resource.volume?.setVolume(this.config.volume ?? 0.55);
    this.player.play(resource);
    this.status.set(this.config.id, { state: "playing", current: this.current.title, error: null });
  }

  async refreshQueue({ keepExistingOnEmpty = true, preserveProgress = false } = {}) {
    const tracks = await expandSources(this.config.sources);
    if (!tracks.length && keepExistingOnEmpty && this.queue.length) return;
    this.queue = preserveProgress ? nextTracksAfter(tracks, this.current, this.queue) : tracks;
    this.queueLoadedAt = Date.now();
  }

  resetQueue() {
    this.queue = [];
    this.queueLoadedAt = 0;
    this.current = null;
  }

  shouldRefreshQueue() {
    return this.queueLoadedAt > 0 && Date.now() - this.queueLoadedAt >= playlistRefreshMs;
  }

  async resourceFor(track) {
    if (track.type === "local") {
      return this.ffmpegResource(["-i", track.value]);
    }

    let url = track.value;
    if (track.type === "search") {
      url = await this.searchYoutube(track.value);
    }
    this.downloader = spawn(ytdlpPath, ["-f", "bestaudio/best", "-o", "-", "--no-playlist", "--no-progress", sanitizeYoutubeUrl(url)], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    this.watchChild(this.downloader, "yt-dlp");
    return this.ffmpegResource(["-i", "pipe:0"], this.downloader.stdout);
  }

  async searchYoutube(query) {
    const output = await runYtdlp(["ytsearch1:" + query, "--print", "webpage_url", "--no-playlist", "--no-progress"]);
    return output.split(/\r?\n/).find(Boolean);
  }

  ffmpegResource(inputArgs, stdin) {
    this.ffmpeg = spawn(ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "warning",
      ...inputArgs,
      "-vn",
      "-filter:a",
      `volume=${safeVolume(this.config.volume)}`,
      "-c:a",
      "libopus",
      "-b:a",
      "128k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-f",
      "ogg",
      "pipe:1"
    ], { stdio: stdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"] });

    this.watchChild(this.ffmpeg, "ffmpeg");
    this.ffmpeg.stdin?.on("error", () => {
      // Track changes and process cleanup can close ffmpeg before yt-dlp stops writing.
    });
    stdin?.on("error", () => {
      // Ignore pipe teardown noise; actual playback errors are reported by the child process.
    });
    if (stdin) stdin.pipe(this.ffmpeg.stdin);
    return createAudioResource(this.ffmpeg.stdout, { inputType: StreamType.OggOpus });
  }

  cleanupProcesses() {
    for (const child of [this.ffmpeg, this.downloader]) {
      if (child && !child.killed) child.kill("SIGKILL");
    }
    this.ffmpeg = null;
    this.downloader = null;
  }

  fail(error) {
    this.status.set(this.config.id, { state: "error", current: this.current?.title || null, error: error.message });
    setTimeout(() => this.playNext().catch((nextError) => {
      this.status.set(this.config.id, { state: "error", current: null, error: nextError.message });
    }), 1500);
  }

  watchChild(child, name) {
    child.on("error", (error) => {
      this.status.set(this.config.id, { state: "error", current: this.current?.title || null, error: `${name}: ${error.message}` });
    });
    child.stderr?.on("data", (chunk) => {
      const message = chunk.toString().trim();
      if (message) console.error(`[${this.config.id}] ${name}: ${message}`);
    });
  }
}

function safeVolume(value) {
  const volume = Number(value ?? 0.55);
  if (!Number.isFinite(volume)) return 0.55;
  return Math.max(0, Math.min(volume, 2));
}

function nextTracksAfter(tracks, current, existingQueue) {
  if (!tracks.length) return existingQueue;
  if (!current) return tracks;

  const currentIndex = tracks.findIndex((track) => trackKey(track) === trackKey(current));
  if (currentIndex >= 0) return tracks.slice(currentIndex + 1);

  const nextQueued = existingQueue.find((track) =>
    tracks.some((candidate) => trackKey(candidate) === trackKey(track))
  );
  if (!nextQueued) return tracks.filter((track) => trackKey(track) !== trackKey(current));

  const nextIndex = tracks.findIndex((track) => trackKey(track) === trackKey(nextQueued));
  return nextIndex >= 0 ? tracks.slice(nextIndex) : existingQueue;
}

function trackKey(track) {
  return `${track?.type || ""}:${track?.value || track?.title || ""}`;
}
