# Privacy Policy

Last updated: February 21, 2026

## Data We Process

This bot processes and stores the minimum data required to provide music features:

- Guild/server configuration:
  - command prefix
  - playback settings (autoplay, dedupe, 24/7, vote-skip)
  - DJ role ids
  - optional music log channel id
- User and guild music data:
  - saved playlists
  - user favorites
  - playback history
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

## Data Retention

Data is retained until removed by command, overwritten by user action, or deleted by the operator.

## Data Sharing

No data is sold. Data may be processed by infrastructure providers used by the bot operator
(hosting, database, monitoring).

## Security

The operator is responsible for securing MongoDB access, bot token handling, and host security.

## Contact

The bot operator is responsible for support and privacy requests for their deployment.
