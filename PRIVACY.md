# Privacy Policy

Last updated: March 8, 2026

## Data We Process

This bot processes and stores the minimum data required to provide music features:

- Guild/server configuration:
  - command prefix
  - playback settings (dedupe, 24/7, vote-skip)
  - DJ role ids
  - optional music log channel id
- User and guild music data:
  - saved guild playlists
  - user favorites
  - guild playback history
  - queue templates
  - queue guard configuration
  - voice-channel playback profiles
  - optional weekly recap channel and recap send-state
  - optional session panel channel/message state
  - optional music webhook target URL
- Lightweight preference and usage signals:
  - requester ids attached to saved tracks/history entries
  - per-user taste terms derived from track metadata
  - per-guild user reputation counters such as plays, skips, and favorites
- Runtime/operational data:
  - structured logs
  - optional metrics
  - optional error traces (if Sentry is enabled by operator)

## How Data Is Used

Data is used only to operate bot functionality and reliability:

- execute commands
- persist queue/library features
- enforce configured permissions/rules
- monitor uptime and failures
- generate optional recap, template, and personalization features

## Data Retention

Data is retained until removed by command, overwritten by user action, or deleted by the operator.

## Data Sharing

No data is sold. Data may be processed by infrastructure providers used by the bot operator
(hosting, database, monitoring).

## Security

The operator is responsible for securing MongoDB access, bot token handling, and host security.

## Operator Responsibility

If you self-host this bot, you are the data controller/operator for your deployment. You are responsible for:

- choosing what infrastructure providers are used
- protecting secrets, database access, and monitoring endpoints
- answering deletion/privacy requests for your own instance
- adjusting this policy text if your deployment collects more data than the default code path

## Contact

The bot operator is responsible for support and privacy requests for their deployment.
