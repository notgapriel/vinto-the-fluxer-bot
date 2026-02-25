# Fluxer Music Bot

Robust, self-hostable music bot for Fluxer with resilient gateway handling, queue/session safety, and persistent guild-level music data.

## Why This Project

- Production-minded architecture (reconnect/resume, retries, graceful shutdown).
- Source ingestion from YouTube, SoundCloud, Spotify URLs, and Deezer URLs.
- Persistent playlists, favorites, and history backed by MongoDB.
- Built-in monitoring endpoints and optional Sentry integration.
- Command system designed for long-term maintainability.

## Feature Overview

- Reliable connectivity:
  - gateway heartbeat watchdog, reconnect backoff, session resume
  - hardened REST retries and `429` handling
- Music playback:
  - queue management, play-next, seek, history, loop, shuffle, filters, EQ
  - DJ role controls and vote-skip for shared voice channels
  - URL import from Spotify/Deezer/SoundCloud resolved to playable YouTube tracks
- Persistence:
  - guild config store with cache and MongoDB persistence
  - guild playlists, user favorites, and playback history
- Operations:
  - `/healthz`, `/readyz`, `/metrics`
  - structured logging
  - optional Sentry exceptions

## Requirements

- Node.js `>= 20`
- MongoDB (local or managed)
- `ffmpeg` available on PATH or configured via `FFMPEG_BIN`
- `yt-dlp` recommended for resilient YouTube fallback (`YTDLP_BIN`)

## Quick Start

```bash
npm install
cp .env.example .env
```

On Windows (PowerShell), use:

```powershell
Copy-Item .env.example .env
```

Set at minimum:

- `BOT_TOKEN`
- `MONGODB_URI`

Then start:

```bash
npm start
```

Development mode:

```bash
npm run dev
```

Run tests:

```bash
npm test
```

## Configuration

`loadConfig` lives in `src/config.js`. A complete variable reference is in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

Common flags:

- `ENABLE_YT_SEARCH`, `ENABLE_YT_PLAYBACK`
- `ENABLE_SPOTIFY_IMPORT`, `ENABLE_DEEZER_IMPORT`
- `COMMAND_RATE_LIMIT_ENABLED` and related limits
- `MONITORING_ENABLED`, `MONITORING_HOST`, `MONITORING_PORT`
- `SENTRY_DSN`, `SENTRY_ENVIRONMENT`

Spotify helper for refresh token:

```bash
npm run spotify:token
```

## Commands

Default prefix: `!`

Core playback:

- `play <query|url>`, `playnext <query|url>`, `search <query>`, `pick <index>`
- `skip`, `pause`, `resume`, `replay`, `previous`, `seek <time>`
- `queue [page]`, `now`, `history [page]`, `remove <index>`, `clear`, `shuffle`
- `loop <off|track|queue>`, `volume [0-200]`
- `filter`, `eq`, `tempo`, `pitch`, `effects`

Library:

- `playlist <create|add|remove|show|list|delete|play> ...`
- `fav`, `favs`, `ufav`, `favplay`

Server/config:

- `prefix`, `settings`, `djrole`, `musiclog`, `voteskipcfg`, `247`, `dedupe`

Advanced:

- `mood`, `panel`, `musicwebhook`, `queueguard`, `template`, `charts`, `recap`
- `voiceprofile`, `reputation`, `taste`, `handoff`, `party`, `import`

## Architecture

High-level architecture and request flow are documented in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Key modules:

- `src/index.js`: startup orchestration
- `src/app/bootstrap.js`: dependency wiring and runtime lifecycle
- `src/bot/`: command router, registry, sessions, services
- `src/player/`: queue and playback pipeline
- `src/voice/`: LiveKit audio publishing
- `src/storage/`: MongoDB integration
- `src/monitoring/`: health/readiness/metrics and Sentry hooks

## Operations Notes

- If YouTube returns a bot-check challenge, use `YTDLP_COOKIES_FILE` or `YTDLP_COOKIES_FROM_BROWSER`.
- If Spotify URL imports fail, verify `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `SPOTIFY_REFRESH_TOKEN`.
- If SoundCloud URL imports fail, set `SOUNDCLOUD_CLIENT_ID` or keep `SOUNDCLOUD_AUTO_CLIENT_ID=1`.
- Guild configuration data is stored in collection `guild_configs`.

## Project Standards

- Contributing guide: [CONTRIBUTING.md](CONTRIBUTING.md)
- Security policy: [SECURITY.md](SECURITY.md)
- Code of conduct: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)
- Support channels: [SUPPORT.md](SUPPORT.md)
- Project changelog: [CHANGELOG.md](CHANGELOG.md)

## Legal

- Code license: [LICENSE](LICENSE)
- License model: source-available, private-use-only (public/commercial bot operation is prohibited without written permission).
- Operator policy templates: [TERMS.md](TERMS.md), [PRIVACY.md](PRIVACY.md)
- Respect third-party provider terms when operating this bot publicly.
