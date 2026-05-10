import path from "node:path";
import SpotifyWebApi from "spotify-web-api-node";
import { listLocalFiles } from "./local-library.js";
import { isYoutubePlaylistUrl, runYtdlp, sanitizeYoutubeUrl } from "./media-tools.js";

let spotifyApi;

function getSpotify() {
  if (!process.env.SPOTIFY_CLIENT_ID || !process.env.SPOTIFY_CLIENT_SECRET) return null;
  if (!spotifyApi) {
    spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET
    });
  }
  return spotifyApi;
}

async function ensureSpotifyToken() {
  const api = getSpotify();
  if (!api) return null;
  const token = await api.clientCredentialsGrant();
  api.setAccessToken(token.body.access_token);
  return api;
}

function spotifyId(value, kind) {
  const urlMatch = value.match(new RegExp(`${kind}/([A-Za-z0-9]+)`));
  if (urlMatch) return urlMatch[1];
  const uriMatch = value.match(new RegExp(`spotify:${kind}:([A-Za-z0-9]+)`));
  return uriMatch?.[1];
}

async function spotifyTracks(source) {
  const api = await ensureSpotifyToken();
  if (!api) {
    return [{ type: "search", value: source.value, title: "Spotify link (missing API credentials)" }];
  }

  const trackId = spotifyId(source.value, "track");
  if (trackId) {
    const item = await api.getTrack(trackId);
    const track = item.body;
    return [{
      type: "search",
      value: `${track.name} ${track.artists.map((artist) => artist.name).join(" ")}`,
      title: `${track.name} - ${track.artists.map((artist) => artist.name).join(", ")}`
    }];
  }

  const playlistId = spotifyId(source.value, "playlist") || spotifyId(source.value, "album");
  if (playlistId) {
    const tracks = [];
    let offset = 0;
    do {
      const page = source.value.includes("/album/") || source.value.includes(":album:")
        ? await api.getAlbumTracks(playlistId, { limit: 50, offset })
        : await api.getPlaylistTracks(playlistId, { limit: 100, offset });
      const items = page.body.items || [];
      for (const item of items) {
        const track = item.track || item;
        if (!track || track.is_local) continue;
        tracks.push({
          type: "search",
          value: `${track.name} ${track.artists.map((artist) => artist.name).join(" ")}`,
          title: `${track.name} - ${track.artists.map((artist) => artist.name).join(", ")}`
        });
      }
      offset += items.length;
      if (!page.body.next) break;
    } while (offset < 1000);
    return tracks;
  }

  return [{ type: "search", value: source.value, title: "Spotify search" }];
}

async function youtubeTracks(source) {
  if (!isYoutubePlaylistUrl(source.value)) {
    return [{ type: "youtube", value: sanitizeYoutubeUrl(source.value), title: source.value }];
  }

  try {
    const raw = await runYtdlp([
      "--flat-playlist",
      "--yes-playlist",
      "--ignore-errors",
      "--no-warnings",
      "--dump-single-json",
      source.value
    ]);
    const data = JSON.parse(raw);
    const entries = Array.isArray(data.entries) ? data.entries : [];
    const tracks = entries
      .map((entry, index) => youtubeEntryTrack(entry, index))
      .filter(Boolean);

    if (tracks.length) return tracks;
  } catch (error) {
    console.error(`YouTube playlist konnte nicht gelesen werden: ${error.message}`);
  }

  return [{ type: "youtube", value: sanitizeYoutubeUrl(source.value), title: source.value }];
}

function youtubeEntryTrack(entry, index) {
  if (!entry) return null;
  const url = entry.webpage_url || entry.url;
  const videoId = entry.id || (typeof url === "string" ? youtubeIdFromUrl(url) : null);
  const value = videoId ? `https://www.youtube.com/watch?v=${videoId}` : url;
  if (!value) return null;

  return {
    type: "youtube",
    value,
    title: entry.title || `YouTube Track ${index + 1}`
  };
}

function youtubeIdFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.hostname.includes("youtu.be")) return url.pathname.replace("/", "");
    return url.searchParams.get("v");
  } catch {
    return null;
  }
}

export async function expandSources(sources) {
  const tracks = [];
  for (const source of sources) {
    if (source.type === "local") {
      try {
        const files = await listLocalFiles(source.value);
        tracks.push(...files.map((file) => ({ type: "local", value: file, title: path.basename(file) })));
      } catch (error) {
        console.error(`Lokale Quelle konnte nicht gelesen werden (${source.value}): ${error.message}`);
      }
    }
    if (source.type === "youtube") {
      tracks.push(...await youtubeTracks(source));
    }
    if (source.type === "spotify") {
      tracks.push(...await spotifyTracks(source));
    }
  }
  return tracks;
}
