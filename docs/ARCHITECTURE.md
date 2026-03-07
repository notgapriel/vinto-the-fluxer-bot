# Architecture

## Runtime Overview

The bot is split into clear layers:

- `src/index.js`: process bootstrap and startup sequence
- `src/app/bootstrap.js`: composes all runtime dependencies
- `src/gateway.js`: websocket lifecycle with reconnect/resume
- `src/rest.js`: API transport wrapper with retry and timeout handling
- `src/bot/`: command router, command registry, guild sessions, domain services
- `src/player/`: queue model and playback pipeline
- `src/voice/`: LiveKit connection and PCM frame publishing
- `src/storage/`: MongoDB connectivity and collections
- `src/monitoring/`: readiness, health, metrics, and Sentry hooks

## Command Flow (High Level)

1. Gateway receives `MESSAGE_CREATE`.
2. `commandRouter` parses prefix/command and checks permissions/rate limits.
3. Matching command handler resolves tracks and applies business logic.
4. `sessionManager` selects or creates a guild playback session.
5. `MusicPlayer` updates queue and coordinates playback pipeline.
6. `VoiceConnection` publishes PCM frames to LiveKit.
7. Relevant data is persisted through guild config/music library stores.

## Playback Resolution Strategy

The player resolves input in this order:

1. Plain text query:
   - Deezer search first when `DEEZER_ARL` is configured and Deezer import is enabled
   - otherwise YouTube search
2. Known provider URL types via `play-dl` validation:
   - YouTube video/playlist
   - SoundCloud track/playlist
   - Spotify track/album/playlist
   - Deezer track/album/playlist
3. Provider-specific direct URL resolution by URL pattern:
   - Audius
   - Spotify artist URLs
   - SoundCloud fallback URL patterns
   - Deezer fallback URL patterns
4. Generic URL fallback by direct metadata lookup or YouTube search

Playback path notes:

- Deezer: direct media URL resolution with encrypted-stream handling and resume/retry fallback.
- SoundCloud: direct API/transcoding playback path.
- Audius: direct API playback path.
- Spotify: metadata resolver only. Track, album, playlist, and artist URLs are resolved through the Spotify Web API, then mirrored to a playable provider. Current mirror preference is Deezer first, then YouTube fallback.
- Generic fallback resolution can still map to YouTube search when a provider URL cannot be resolved directly.

## Data Model Notes

MongoDB stores:

- `guild_configs`: prefix, DJ roles, vote-skip and other guild settings
- `guild_playlists`: saved guild playlists
- user favorites and playback history collections (managed by music library store)

In-memory caches reduce DB load for hot guild config reads.

## Reliability and Operations

- Gateway and REST clients use retry/backoff patterns.
- Graceful shutdown handles active sessions on `SIGINT` and `SIGTERM`.
- Monitoring endpoints:
  - `/healthz`
  - `/readyz`
  - `/metrics`
- Optional Sentry reporting can capture unhandled runtime exceptions.

