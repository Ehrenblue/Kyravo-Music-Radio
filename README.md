# Kyravo Discord Radio Bot

Ein Discord-Musikbot mit lokaler Weboberfläche. Er kann lokale Musikdateien, YouTube-Links und Spotify-Links als Quellen verwenden. Spotify wird dabei als Metadatenquelle genutzt: Der Bot liest Titel/Künstler aus Spotify und sucht dann eine abspielbare Quelle, statt Spotify-Audio direkt in Discord zu streamen.

Wichtig: Ein einzelner Discord-Bot-Account kann pro Discord-Server nur in einem Voice-Channel gleichzeitig sein. Für mehrere gleichzeitige Channels im selben Server brauchst du mehrere Bot-Accounts/Tokens und trägst sie in `config/channels.json` ein.

## Voraussetzungen

- Node.js 20 oder neuer
- `yt-dlp` installiert und im PATH, oder `YTDLP_PATH` in `.env` setzen
- Ein oder mehrere Discord-Bots im Discord Developer Portal
- Optional: Spotify Developer App für Spotify-Links

## Installation

1. Projektabhängigkeiten installieren:

   ```powershell
   npm install
   ```

2. `.env.example` zu `.env` kopieren und ausfüllen:

   ```powershell
   Copy-Item .env.example .env
   ```

3. `config/channels.json` öffnen und pro Voice-Channel eintragen:

   - `guildId`: ID deines Discord-Servers
   - `voiceChannelId`: ID des Voice-Channels
   - `botId`: welcher Bot diesen Channel bespielt
   - `enabled`: auf `true` setzen
   - `sources`: lokale Ordner/Dateien, YouTube-Links oder Spotify-Links

4. Bot starten:

   ```powershell
   npm start
   ```

   `npm start` startet einen Wächterprozess. Wenn Dashboard oder Bot abstürzen oder `http://localhost:3333` nicht mehr antwortet, startet dieser Prozess den Bot automatisch neu.

5. Dashboard öffnen:

   `http://localhost:3333`

   Als Dashboard-Key den Wert aus `DASHBOARD_KEY` in deiner `.env` eintragen.

## Discord-Bot Einrichten

1. Öffne das [Discord Developer Portal](https://discord.com/developers/applications).
2. Erstelle eine neue Application.
3. Gehe zu `Bot` und erstelle den Bot-User.
4. Aktiviere unter `Privileged Gateway Intents` keine zusätzlichen Intents. Für dieses Projekt reichen `Guilds` und `Guild Voice States`, die im Code gesetzt sind.
5. Kopiere den Bot Token in deine `.env`:

   ```env
   DISCORD_TOKEN_MAIN=dein_token
   DISCORD_CLIENT_ID_MAIN=deine_application_id
   ```

6. Gehe zu `OAuth2` -> `URL Generator`.
7. Wähle Scopes:

   - `bot`
   - `applications.commands`

   Wenn du den Discord-Button `Hinzufügen` / `Add App` verwenden willst, gehe im Developer Portal zusätzlich zu `Installation`:

   - `Install Link`: `Discord Provided Link`
   - `Install Contexts`: `Guild Install` aktivieren
   - Unter `Default Install Settings` fuer `Guild Install` ebenfalls `bot` und `applications.commands` setzen

8. Wähle Bot Permissions:

   - `View Channels`
   - `Connect`
   - `Speak`
   - `Use Voice Activity`

9. Öffne die generierte URL im Browser und lade den Bot auf deinen Server ein.

Alternativ kannst du dir den Einladungslink ausgeben lassen:

```powershell
npm run invite
```

Wenn Discords eigener `Hinzufügen` / `Add App` Button keine Serverauswahl zeigt, setze die Installationswerte der App automatisch:

```powershell
npm run discord:install-settings
```

10. Aktiviere in Discord den Entwicklermodus: `Benutzereinstellungen` -> `Erweitert` -> `Entwicklermodus`.
11. Rechtsklick auf deinen Server -> `Server-ID kopieren`.
12. Rechtsklick auf den Voice-Channel -> `Channel-ID kopieren`.
13. Trage beide IDs im Dashboard oder in `config/channels.json` ein.

## Discord-Befehle

Der Bot registriert Slash-Commands automatisch auf jedem Server, auf dem er eingeladen ist. Nutze die Befehle in Discord, waehrend du im konfigurierten Voice-Channel bist:

```text
/play
/stop
/status
```

Das Dashboard wird damit nur noch fuer Konfiguration, Bot-Tokens und Quellen gebraucht. Der Bot joined nicht automatisch; Starten und Stoppen der Musik geht direkt per Discord-Befehl. Wenn der Bot per `/play` joined, beginnt die Playlist immer wieder beim ersten Track.

## Mehrere Discord-Server

Ein Bot-Account kann mehrere Discord-Server gleichzeitig bedienen. Lade denselben Bot einfach auf jeden Server ein, auf dem Musik laufen soll.

Danach:

1. Dashboard öffnen: `http://localhost:3333`
2. `Channel hinzufügen` klicken
3. Den Bot auswählen
4. Den Discord-Server aus der Liste auswählen
5. Den Voice-Channel aus der Liste auswählen
6. Quellen eintragen
7. `Aktiv` einschalten und speichern

Der Bot joined nicht automatisch, wenn jemand einen Voice-Channel betritt. Nutze im gewünschten Voice-Channel `/play`, um ihn zu starten. Ist der Voice-Channel nicht im Dashboard konfiguriert, erstellt der Bot dabei intern eine temporäre Session und nutzt die Quellen eines vorhandenen Channels als Standard. Verlässt du einen laufenden Channel, geht der Bot raus, sobald dort keine echten User mehr sind.

## Mehrere Channels Im Selben Server

Ein einzelner Bot-Account kann pro Discord-Server nur in einem Voice-Channel gleichzeitig sein. Der Bot nutzt deshalb einen Bot-Pool: Jeder gleichzeitige Voice-Channel im selben Server bekommt automatisch einen eigenen Bot-Account.

Das gilt auch fuer unkonfigurierte Voice-Channels: Nutzt jemand in einem beliebigen Channel `/play`, nimmt der Bot automatisch einen freien Bot-Account aus dem Pool. Sind alle Bot-Accounts in diesem Server bereits in Benutzung, kann Discord keinen weiteren gleichzeitigen Channel bespielen.

Im Dashboard kannst du bei `Bot` einfach `Automatisch (Bot-Pool)` lassen. Der Bot verteilt aktive Channels dann selbst auf freie Bot-Accounts.

Beispiel für einen zweiten Bot in `.env`:

```env
DISCORD_TOKEN_RADIO2=zweiter_token
DISCORD_CLIENT_ID_RADIO2=zweite_application_id
```

Und in `config/channels.json`:

```json
{
  "id": "radio2",
  "name": "Radio 2",
  "tokenEnv": "DISCORD_TOKEN_RADIO2",
  "clientIdEnv": "DISCORD_CLIENT_ID_RADIO2"
}
```

Wiederhole das fuer `radio3`, `radio4` und `radio5`, wenn du mehr gleichzeitige Channels im selben Server brauchst. Lade jeden dieser Bot-Accounts mit `npm run invite` auf denselben Discord-Server ein.

### Bot-Pool Im Dashboard Befuellen

Discord erzeugt Bot-Tokens nur im Developer Portal. Das Dashboard kann sie danach automatisch lokal eintragen und den Pool neu laden:

1. Öffne das [Discord Developer Portal](https://discord.com/developers/applications).
2. Erstelle pro gleichzeitigem Voice-Channel einen zusätzlichen Bot.
3. Kopiere pro Bot die Application ID und den Bot Token.
4. Öffne `http://localhost:3333`.
5. Trage im jeweiligen Bot-Slot `Client-ID` und `Bot-Token` ein.
6. Klicke `Bot-Zugang speichern`.
7. Klicke beim Bot-Slot auf `Bot einladen` und lade ihn auf denselben Server ein.
8. Lass bei deinen Voice-Channels `Automatisch (Bot-Pool)` ausgewählt.

Der Bot speichert die Werte in `.env`, lädt den Pool neu und weist die Voice-Channels danach automatisch freien Bot-Accounts zu.

## Quellen

Lokaler Ordner:

```json
{ "type": "local", "value": "C:/Music/lounge" }
```

Lokale Datei:

```json
{ "type": "local", "value": "C:/Music/lounge/song.mp3" }
```

Im Dashboard kannst du bei einer Quelle `Lokal` auswählen und dann mit `Auswählen` frei durch lokale Laufwerke und Ordner browsen. Du kannst außerdem einen Ordnerpfad direkt eingeben und mit `Pfad öffnen` öffnen oder mit `Pfad übernehmen` speichern.

`MUSIC_DIRS` ist nur noch eine Komfortliste für bevorzugte Startordner:

```env
MUSIC_DIRS=C:/Users/redhu/Music;D:/Musik
```

Mehrere Ordner werden mit Semikolon getrennt. Unterstützte lokale Formate sind `aac`, `flac`, `m4a`, `mp3`, `ogg`, `opus`, `wav` und `webm`.

YouTube:

```json
{ "type": "youtube", "value": "https://www.youtube.com/watch?v=..." }
```

YouTube-Playlist:

```json
{ "type": "youtube", "value": "https://www.youtube.com/watch?v=...&list=..." }
```

YouTube-, Spotify- und lokale Quellen werden in ihrer Reihenfolge abgespielt und beim Abspielen regelmaessig frisch geladen. Wenn du eine Playlist aktualisierst, uebernimmt der Bot neue oder entfernte Songs automatisch beim naechsten Refresh, ohne wieder beim ersten Song anzufangen. Standard sind 2 Minuten:

```env
PLAYLIST_REFRESH_SECONDS=120
```

Spotify:

```json
{ "type": "spotify", "value": "https://open.spotify.com/playlist/..." }
```

Spotify-Playlist oder Album:

```json
{ "type": "spotify", "value": "https://open.spotify.com/playlist/..." }
{ "type": "spotify", "value": "https://open.spotify.com/album/..." }
```

Für Spotify-Playlists und Spotify-Alben setze zusätzlich:

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

Spotify wird als Metadatenquelle genutzt: Der Bot liest Titel und Künstler aus Spotify und sucht dann eine passende abspielbare Quelle.

## Betrieb rund um die Uhr

Der Prozess muss dauerhaft laufen. Standardmäßig macht `npm start` schon einen automatischen Neustart, wenn Bot oder Dashboard ausfallen:

```powershell
npm start
```

Auf diesem Windows-PC kann der Bot automatisch mit deinem Benutzerkonto starten und sich alle 5 Minuten selbst prüfen:

```powershell
npm run autostart:install
```

Wenn Windows die Aufgabenplanung erlaubt, wird dort `Kyravo Discord Radio` angelegt. Falls Windows den Zugriff blockiert, wird automatisch eine normale Autostart-Verknüpfung im Benutzer-Startup-Ordner erstellt. In beiden Fällen startet der Bot beim Windows-Login und wird danach regelmäßig geprüft. Wenn der Bot schon läuft, macht der Wächter nichts. Wenn er nicht läuft, startet er ihn wieder.

Falls du diesen Autostart später entfernen möchtest:

```powershell
npm run autostart:uninstall
```

Logs findest du hier:

- `logs/supervisor.log`
- `logs/bot.out.log`
- `logs/bot.err.log`
- `logs/autostart.log`
- `logs/watchdog.log`

Der Bot joined nur noch per `/play` oder per Start-Button im Dashboard. Wenn der laufende Voice-Channel leer ist, verlässt der Bot ihn automatisch.

## Online Auch Wenn Dieser PC Aus Ist

Dafuer muss der Bot auf einem externen Server laufen. Dieses Projekt ist jetzt fuer Render und Docker vorbereitet:

- `Dockerfile`
- `render.yaml`
- `CLOUD-DEPLOYMENT.md`

Die genaue Schritt-fuer-Schritt-Anleitung findest du in `CLOUD-DEPLOYMENT.md`.
