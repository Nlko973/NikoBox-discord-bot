# NikoBox

Production-ready Discord music bot with a Next.js dashboard and Lavalink audio streaming.

## Features

- Discord.js v14 + TypeScript slash commands: `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/shuffle`, `/repeat`, `/volume`, `/seek`, `/nowplaying`
- Lavalink v4 streaming, no local audio storage
- YouTube videos/playlists and text search
- Spotify URL handling (tracks, albums, playlists) resolved through the public Spotify embed endpoint into per-track search queries
- Multi-guild queues, repeat, shuffle, volume, absolute seek, forward/backward seek
- Web dashboard with per-guild control, live WebSocket updates, queue remove/reorder/clear, progress seeking
- Docker Compose deployment with restart policies
- Ubuntu 24.04 friendly installer for small VPS instances

## Quick VPS Install

1. Create a Discord application and bot at <https://discord.com/developers/applications>.
2. Enable the bot, copy `DISCORD_TOKEN`, copy the application id as `DISCORD_CLIENT_ID`, and invite the bot with `bot` and `applications.commands` scopes.
3. Clone and install:

```bash
git clone <your-repo-url> NikoBox
cd NikoBox
./install.sh
```

On first run, `install.sh` creates `.env` and stops if required secrets still contain placeholders. Edit `.env`, then run:

```bash
./install.sh
```

The installer:

- installs `git`, Docker Engine, and Docker Compose plugin when missing
- creates `.env` from `.env.example`
- builds bot and web images
- starts Lavalink, bot, and dashboard with `docker compose`
- waits for health checks
- prints final URLs and service status

## Required Environment

```env
DISCORD_TOKEN=...
DISCORD_CLIENT_ID=...
DASHBOARD_ADMIN_TOKEN=...
LAVALINK_PASSWORD=...
```

Optional provider variables:

```env
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=
```

The current implementation keeps provider handling lightweight for low-resource VPS hosts: Spotify links are resolved through the public Spotify embed endpoint into per-track search queries and then queued through YouTube/SoundCloud via Lavalink. No Spotify API credentials are required.

## Services

- `lavalink`: audio node, internal port `2333`
- `bot`: Discord client plus REST/WebSocket dashboard API, default host port `4000`
- `web`: Next.js dashboard, default host port `3000`

All services use `restart: unless-stopped`, so they auto-start after reboot when Docker starts.

## Commands

```bash
docker compose ps
docker compose logs -f
docker compose logs -f bot
docker compose restart
docker compose down
docker compose up -d --build
```

## Updating

```bash
git pull
docker compose up -d --build
docker compose ps
```

For predictable releases, set a tag before building:

```bash
export NIKOBOX_TAG=2026-06-21
docker compose build
docker compose up -d
```

## Rollback

Keep the previous Docker image tag available, then run:

```bash
./scripts/rollback.sh previous
```

Or manually:

```bash
export NIKOBOX_TAG=previous
docker compose up -d --no-build bot web
```

## Lavalink Configuration

Lavalink is configured in `lavalink/application.yml`.

Important choices for low-resource VPS hosts:

- Java heap is controlled by `JAVA_OPTS` in `.env`, default `-Xms128m -Xmx512m`
- local audio source is disabled
- no audio files are stored by NikoBox
- player update interval is low enough for dashboard progress without noisy CPU usage
- YouTube playback uses the Lavalink YouTube plugin

If YouTube behavior changes, update the plugin dependency in `lavalink/application.yml`, then run:

```bash
docker compose up -d --build lavalink
```

## Dashboard

Open `http://your-vps-ip:3000` and enter `DASHBOARD_ADMIN_TOKEN`.

Dashboard play requires a Discord voice channel id because the web panel cannot know which voice channel your browser user is in. Slash `/play` can infer the voice channel from the Discord member.

For public exposure, put the dashboard behind HTTPS with a reverse proxy and keep `DASHBOARD_ADMIN_TOKEN` strong.

## Troubleshooting

`401 Unauthorized` in dashboard:

- The admin token in the web input must match `DASHBOARD_ADMIN_TOKEN`.

Bot online but commands do not appear:

- Guild commands are instant when `DISCORD_GUILD_IDS` is set.
- Global commands may take time to propagate.
- Verify `DISCORD_CLIENT_ID` is the application id, not the bot user id.

No audio:

- Check `docker compose logs -f lavalink`.
- Verify the bot has permission to connect and speak in the voice channel.
- Confirm `LAVALINK_PASSWORD` matches in `.env` and `docker-compose.yml`.

VPS runs out of RAM:

- Lower `JAVA_OPTS`, for example `-Xms96m -Xmx384m`.
- Avoid running other memory-heavy services on a 1 GB VPS.

Dashboard WebSocket does not update:

- Set `NEXT_PUBLIC_BOT_WS_URL=ws://your-vps-ip:4000/ws` for browser access.
- If behind HTTPS, use `wss://...`.

## Local Development

```bash
npm install
npm run build -w @nikobox/shared
npm run dev -w @nikobox/bot
npm run dev -w @nikobox/web
```

For local audio testing, run Lavalink with Docker:

```bash
docker compose up -d lavalink
```
