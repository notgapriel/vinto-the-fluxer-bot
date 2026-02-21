import 'dotenv/config';
import dns from 'node:dns';

import { loadConfig } from './config.js';
import { createLogger } from './core/logger.js';
import { Gateway } from './gateway.js';
import { RestClient } from './rest.js';
import { CommandRouter, SessionManager, VoiceStateStore } from './commands.js';
import { LyricsService } from './bot/services/lyricsService.js';
import { GuildConfigStore } from './bot/services/guildConfigStore.js';
import { MongoService } from './storage/mongo.js';
import { initializePlayDlAuth } from './integrations/playDlAuth.js';
import { sleep } from './utils/retry.js';
import { MusicLibraryStore } from './bot/services/musicLibraryStore.js';
import { PermissionService } from './bot/services/permissionService.js';
import { MetricsRegistry } from './monitoring/metrics.js';
import { MonitoringServer } from './monitoring/server.js';
import { initializeSentry } from './monitoring/sentry.js';

const startedAt = Date.now();
const config = loadConfig();
const logger = createLogger({ level: config.logLevel, name: 'fluxer-bot' });
const metrics = new MetricsRegistry();
const metricsSessionsActive = metrics.gauge('sessions_active', 'Number of active guild sessions');
const metricsGatewayConnected = metrics.gauge('gateway_connected', 'Gateway connection state (1=connected)');
const metricsGatewayReconnects = metrics.counter('gateway_reconnects_total', 'Gateway reconnect schedules');
const metricsTracksStarted = metrics.counter('tracks_started_total', 'Tracks started');
const metricsTrackErrors = metrics.counter('track_errors_total', 'Track playback errors');
const metricsCommandsTotal = metrics.counter('commands_total', 'Commands processed by outcome');
const metricsRestRetriesTotal = metrics.counter('rest_retries_total', 'REST retries triggered');

dns.setDefaultResultOrder(config.dnsResultOrder);
logger.info('DNS resolution order configured', { order: config.dnsResultOrder });
await initializePlayDlAuth(config, logger.child('media-auth'));
const errorReporter = await initializeSentry(config, logger.child('sentry'));

const rest = new RestClient({
  token: config.token,
  base: config.apiBase,
  timeoutMs: config.restTimeoutMs,
  maxRetries: config.restMaxRetries,
  retryBaseDelayMs: config.restRetryBaseDelayMs,
  logger: logger.child('rest'),
  metrics: {
    restRetriesTotal: metricsRestRetriesTotal,
  },
});

const mongo = new MongoService({
  uri: config.mongoUri,
  dbName: config.mongoDb,
  maxPoolSize: config.mongoMaxPoolSize,
  minPoolSize: config.mongoMinPoolSize,
  connectTimeoutMs: config.mongoConnectTimeoutMs,
  serverSelectionTimeoutMs: config.mongoServerSelectionTimeoutMs,
  logger: logger.child('mongo'),
});
await mongo.connect();

const guildConfigs = new GuildConfigStore({
  collection: mongo.collection('guild_configs'),
  logger: logger.child('guild-configs'),
  cacheTtlMs: config.guildConfigCacheTtlMs,
  maxCacheSize: config.guildConfigCacheMaxSize,
  defaults: {
    prefix: config.prefix,
    settings: {
      autoplayEnabled: config.defaultAutoplayEnabled,
      dedupeEnabled: config.defaultDedupeEnabled,
      stayInVoiceEnabled: config.defaultStayInVoiceEnabled,
      voteSkipRatio: config.voteSkipRatio,
      voteSkipMinVotes: config.voteSkipMinVotes,
      djRoleIds: [],
      musicLogChannelId: null,
    },
  },
});
await guildConfigs.init();

const musicLibrary = new MusicLibraryStore({
  guildPlaylistsCollection: mongo.collection('guild_playlists'),
  userFavoritesCollection: mongo.collection('user_favorites'),
  guildHistoryCollection: mongo.collection('guild_history'),
  logger: logger.child('music-library'),
  maxPlaylistsPerGuild: config.maxSavedPlaylistsPerGuild,
  maxTracksPerPlaylist: config.maxSavedTracksPerPlaylist,
  maxFavoritesPerUser: config.maxFavoritesPerUser,
  maxHistoryTracks: config.persistentHistorySize,
});
await musicLibrary.init();

const gatewayUrl = await resolveGatewayUrl();
const gateway = new Gateway({
  url: gatewayUrl,
  token: config.token,
  intents: 0,
  logger: logger.child('gateway'),
});

const voiceStateStore = new VoiceStateStore(logger.child('voice-state'));
voiceStateStore.register(gateway);

const sessions = new SessionManager({
  gateway,
  config,
  guildConfigs,
  logger: logger.child('sessions'),
});
metricsSessionsActive.set(0);
metricsGatewayConnected.set(0);
let gatewayConnected = false;

gateway.on('open', () => {
  gatewayConnected = true;
  metricsGatewayConnected.set(1);
});
gateway.on('close', () => {
  gatewayConnected = false;
  metricsGatewayConnected.set(0);
});
gateway.on('reconnect_scheduled', () => {
  metricsGatewayReconnects.inc(1);
});

sessions.on('trackStart', () => {
  metricsTracksStarted.inc(1);
  metricsSessionsActive.set(sessions.sessions.size);
});
sessions.on('trackError', () => {
  metricsTrackErrors.inc(1);
});
sessions.on('destroyed', () => {
  metricsSessionsActive.set(sessions.sessions.size);
});
const metricsSessionGaugeInterval = setInterval(() => {
  metricsSessionsActive.set(sessions.sessions.size);
}, 5_000);
metricsSessionGaugeInterval.unref();

const lyrics = new LyricsService(logger.child('lyrics'));
const me = await verifyApiConnectivity();
const permissions = new PermissionService({
  rest,
  botUserId: me?.id ?? null,
  logger: logger.child('permissions'),
});

const router = new CommandRouter({
  config,
  logger: logger.child('commands'),
  rest,
  gateway,
  sessions,
  guildConfigs,
  voiceStateStore,
  lyrics,
  library: musicLibrary,
  permissionService: permissions,
  metrics: {
    commandsTotal: metricsCommandsTotal,
  },
  errorReporter,
  botUserId: me?.id ?? null,
  startedAt,
});

let shuttingDown = false;
const monitoringServer = new MonitoringServer({
  enabled: config.monitoringEnabled,
  host: config.monitoringHost,
  port: config.monitoringPort,
  logger: logger.child('monitoring'),
  metrics,
  getHealth: () => ({
    ok: !shuttingDown && (gatewayConnected || Date.now() - startedAt < 60_000),
    gatewayConnected,
    shuttingDown,
    sessions: sessions.sessions.size,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
  }),
});
await monitoringServer.start().catch((err) => {
  logger.warn('Monitoring server failed to start', {
    error: err instanceof Error ? err.message : String(err),
  });
});

gateway.on('MESSAGE_CREATE', (message) => {
  router.handleMessage(message).catch((err) => {
    logger.error('Unhandled MESSAGE_CREATE handler error', {
      error: err instanceof Error ? err.message : String(err),
    });
    errorReporter?.captureException?.(err, { source: 'message_create_handler' });
  });
});

gateway.connect();

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.warn('Shutdown requested', { signal });

  await sessions.shutdown().catch((err) => {
    logger.error('Session shutdown failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  clearInterval(metricsSessionGaugeInterval);
  gateway.disconnect();
  await monitoringServer.stop().catch((err) => {
    logger.error('Monitoring server shutdown failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  await mongo.close().catch((err) => {
    logger.error('MongoDB shutdown failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  });
  await errorReporter?.flush?.(1_500);

  setTimeout(() => {
    process.exit(0);
  }, 200).unref();
}

process.on('SIGINT', () => {
  shutdown('SIGINT').catch(() => process.exit(1));
});

process.on('SIGTERM', () => {
  shutdown('SIGTERM').catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', {
    error: reason instanceof Error ? reason.message : String(reason),
  });
  errorReporter?.captureException?.(reason instanceof Error ? reason : new Error(String(reason)), {
    source: 'unhandled_rejection',
  });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', {
    error: err instanceof Error ? err.message : String(err),
  });
  errorReporter?.captureException?.(err, { source: 'uncaught_exception' });
});

async function verifyApiConnectivity() {
  let lastError = null;

  for (let attempt = 1; attempt <= config.apiCheckRetries; attempt += 1) {
    try {
      const me = await rest.getCurrentUser();
      logger.info('REST API check succeeded', {
        apiBase: config.apiBase,
        user: me?.username ?? 'unknown',
      });
      return me;
    } catch (err) {
      lastError = err;
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn('REST API check failed', {
        attempt,
        totalAttempts: config.apiCheckRetries,
        error: detail,
      });

      if (attempt < config.apiCheckRetries) {
        await sleep(config.apiCheckDelayMs * attempt);
      }
    }
  }

  const finalDetail = lastError instanceof Error ? lastError.message : String(lastError);
  const message = `REST API check failed after ${config.apiCheckRetries} attempt(s): ${finalDetail}`;

  if (config.strictStartupCheck) {
    throw new Error(message);
  }

  logger.warn(`${message}. Continuing startup due to non-strict mode.`);
  return null;
}

async function resolveGatewayUrl() {
  if (!config.autoGatewayUrl) {
    return config.gatewayUrl;
  }

  try {
    const data = await rest.getGatewayBot();
    if (typeof data?.url === 'string' && data.url.startsWith('ws')) {
      logger.info('Gateway URL resolved from API', { url: data.url });
      return data.url;
    }
  } catch (err) {
    logger.warn('Failed to resolve gateway URL from API, using configured fallback', {
      error: err instanceof Error ? err.message : String(err),
      fallback: config.gatewayUrl,
    });
  }

  return config.gatewayUrl;
}
