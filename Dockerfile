FROM node:20-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates ffmpeg python3 python3-pip \
  && python3 -m pip install --break-system-packages --no-cache-dir yt-dlp \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /var/data/music /var/data/backups logs \
  && chown -R node:node /app /var/data

USER node

ENV DASHBOARD_HOST=0.0.0.0
ENV CONFIG_PATH=/var/data/channels.json
ENV CONFIG_BACKUP_DIR=/var/data
ENV MUSIC_DIRS=/var/data/music
ENV YTDLP_PATH=yt-dlp

EXPOSE 10000
CMD ["npm", "start"]
