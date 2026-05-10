# Kyravo Bot 24/7 Online Betreiben

Damit der Bot weiter online bleibt, wenn dieser PC aus ist, muss er auf einem externen Server laufen. Dieses Projekt ist jetzt fuer Render vorbereitet. Alternativ kannst du denselben Docker-Container auf einem VPS verwenden.

## Wichtig

- Dein PC muss danach nicht mehr laufen.
- YouTube, YouTube-Playlists, Radio-Links und Spotify-Metadaten funktionieren vom Server aus.
- Lokale Musik von diesem PC funktioniert nur, solange sie auch auf den Server hochgeladen wird. Im Cloud-Setup ist der lokale Musikordner `/var/data/music`.
- Nutze `.env.cloud.example` als Vorlage fuer Server-Umgebungsvariablen.
- Nutze `config/channels.cloud.example.json` als Vorlage, wenn du keine Windows-Pfade wie `D:\Kyravo Musik` in der Cloud verwenden willst.
- Ein Discord-Bot-Account kann pro Discord-Server weiterhin nur einen Voice-Channel gleichzeitig bespielen. Fuer mehrere gleichzeitige Voice-Channels im selben Server brauchst du mehrere Bot-Accounts/Tokens.

## Render Deployment

Render braucht ein GitHub-, GitLab- oder Bitbucket-Repository. Lade dieses Projekt zuerst in ein Git-Repository hoch.

1. Erstelle ein neues Repository bei GitHub, GitLab oder Bitbucket.
2. Lade diesen Projektordner dorthin hoch.
3. Oeffne Render: https://dashboard.render.com
4. Waehle `New` -> `Blueprint`.
5. Verbinde dein Repository.
6. Render erkennt die Datei `render.yaml`.
7. Setze die geheimen Umgebungsvariablen:

```env
DASHBOARD_KEY=kyravo-dashboard-9J7mQ4xV2pL8
DISCORD_CLIENT_ID_MAIN=deine_discord_application_id
DISCORD_TOKEN_MAIN=dein_discord_bot_token
DISCORD_CLIENT_ID_RADIO2=zweite_application_id
DISCORD_TOKEN_RADIO2=zweiter_bot_token
DISCORD_CLIENT_ID_RADIO3=
DISCORD_TOKEN_RADIO3=
DISCORD_CLIENT_ID_RADIO4=
DISCORD_TOKEN_RADIO4=
DISCORD_CLIENT_ID_RADIO5=
DISCORD_TOKEN_RADIO5=
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

8. Klicke `Apply`.
9. Warte, bis der Deploy live ist.
10. Oeffne danach die Render-URL, zum Beispiel:

```text
https://kyravo-discord-radio.onrender.com
```

11. Melde dich im Dashboard mit deinem Dashboard-Key an.
12. Pruefe im Dashboard die Voice-Channels und Quellen.

## Warum Render Starter Statt Free?

Fuer einen Discord-Musikbot ist ein schlafender Free-Server nicht sinnvoll. Der Bot muss dauerhaft mit Discord verbunden bleiben. Das vorbereitete `render.yaml` nutzt deshalb `plan: starter`.

## Lokale Musik In Der Cloud

Der Cloud-Server kann nicht auf `C:\Users\...` auf diesem PC zugreifen. Fuer lokale Dateien hast du drei Optionen:

1. Lade Musikdateien auf den Server-Datentrager `/var/data/music`.
2. Lege die Musikdateien im Repository ab, wenn es nur wenige kleine Dateien sind.
3. Nutze statt lokalen Dateien YouTube-, YouTube-Playlist-, Spotify- oder Radio-Links.

## VPS Alternative

Auf einem eigenen Linux-VPS kannst du den Bot mit Docker laufen lassen:

```bash
docker build -t kyravo-discord-radio .
docker run -d \
  --name kyravo-discord-radio \
  --restart unless-stopped \
  -p 3333:3333 \
  -e PORT=3333 \
  -e DASHBOARD_HOST=0.0.0.0 \
  -e DASHBOARD_KEY="dein_dashboard_key" \
  -e DISCORD_CLIENT_ID_MAIN="deine_client_id" \
  -e DISCORD_TOKEN_MAIN="dein_token" \
  -v kyravo-data:/var/data \
  kyravo-discord-radio
```

Danach ist das Dashboard unter `http://SERVER-IP:3333` erreichbar.
