import { ValidationError } from '../core/errors.js';
import { parseCommand } from '../utils/commandParser.js';
import { makeResponder } from './messageFormatter.js';
import { CommandRegistry } from './commandRegistry.js';
import { registerCommands } from './commands/index.js';
import { CommandRateLimiter } from './services/commandRateLimiter.js';

export class CommandRouter {
  constructor(options) {
    this.config = options.config;
    this.logger = options.logger;
    this.rest = options.rest;
    this.gateway = options.gateway;
    this.sessions = options.sessions;
    this.guildConfigs = options.guildConfigs ?? null;
    this.voiceStateStore = options.voiceStateStore;
    this.lyrics = options.lyrics;
    this.library = options.library ?? null;
    this.permissionService = options.permissionService ?? null;
    this.botUserId = options.botUserId ?? null;
    this.startedAt = options.startedAt;
    this.metrics = options.metrics ?? null;
    this.errorReporter = options.errorReporter ?? null;
    this.commandRateLimiter = options.commandRateLimiter ?? new CommandRateLimiter({
      logger: this.logger?.child?.('rate-limit'),
      enabled: this.config.commandRateLimitEnabled,
      userWindowMs: this.config.commandUserWindowMs,
      userMaxCommands: this.config.commandUserMax,
      guildWindowMs: this.config.commandGuildWindowMs,
      guildMaxCommands: this.config.commandGuildMax,
      bypassCommands: this.config.commandRateLimitBypass,
    });

    this.responder = makeResponder(this.rest, {
      enableEmbeds: this.config.enableEmbeds,
    });

    this.registry = new CommandRegistry();
    registerCommands(this.registry);

    this._bindSessionEvents();
  }

  async handleMessage(message) {
    if (!message?.content) return;
    if (message.author?.bot) return;

    const guildId = message.guild_id ?? null;
    const guildConfig = await this._resolveGuildConfig(guildId);
    const configuredPrefix = guildConfig?.prefix ?? this.config.prefix;
    const fallbackPrefix = this.config.prefix;

    const parsed = parseCommand(message.content, configuredPrefix)
      ?? (configuredPrefix !== fallbackPrefix ? parseCommand(message.content, fallbackPrefix) : null);
    if (!parsed) return;

    const command = this.registry.resolve(parsed.name);
    if (!command) {
      this.metrics?.commandsTotal?.inc?.(1, { command: parsed.name.toLowerCase(), outcome: 'unknown' });
      await this._safeReply(message.channel_id, 'warning', `Unknown command: \`${parsed.name}\``);
      return;
    }

    const context = this._buildContext(message, parsed, command, {
      prefix: configuredPrefix,
      guildConfig,
    });
    if (context.guildId && this.sessions.has(context.guildId)) {
      this.sessions.bindTextChannel(context.guildId, context.channelId);
    }

    try {
      if (context.guildId && this.permissionService) {
        const canSend = await this.permissionService.canBotSendMessages(context.guildId, context.channelId);
        if (canSend === false) {
          this.logger?.warn?.('Bot lacks send permission in command channel', {
            guildId: context.guildId,
            channelId: context.channelId,
            command: command.name,
          });
          this.metrics?.commandsTotal?.inc?.(1, { command: command.name, outcome: 'blocked_bot_send_perm' });
          return;
        }
      }

      const rateCheck = this.commandRateLimiter.consume({
        guildId: context.guildId,
        userId: context.authorId,
        commandName: command.name,
      });
      if (!rateCheck.allowed) {
        const retrySec = Math.max(0.1, (rateCheck.retryAfterMs ?? 1_000) / 1000).toFixed(1);
        throw new ValidationError(`Rate limit hit (${rateCheck.scope}). Please retry in ${retrySec}s.`);
      }

      await command.execute(context);
      this.metrics?.commandsTotal?.inc?.(1, { command: command.name, outcome: 'success' });
    } catch (err) {
      if (err instanceof ValidationError) {
        this.metrics?.commandsTotal?.inc?.(1, { command: command.name, outcome: 'validation_error' });
        await context.reply.warning(err.message);
        return;
      }

      this.metrics?.commandsTotal?.inc?.(1, { command: command.name, outcome: 'internal_error' });
      this.logger?.error?.('Command execution failed', {
        command: command.name,
        guildId: context.guildId,
        channelId: context.channelId,
        error: err instanceof Error ? err.message : String(err),
      });
      this.errorReporter?.captureException?.(err, {
        source: 'command_router',
        command: command.name,
        guildId: context.guildId,
        channelId: context.channelId,
      });

      await context.reply.error('Command failed unexpectedly. Please try again.');
    }
  }

  _buildContext(message, parsed, command, options = {}) {
    const channelId = message.channel_id;

    return {
      config: this.config,
      prefix: options.prefix ?? this.config.prefix,
      logger: this.logger,
      rest: this.rest,
      gateway: this.gateway,
      sessions: this.sessions,
      guildConfigs: this.guildConfigs,
      guildConfig: options.guildConfig ?? null,
      voiceStateStore: this.voiceStateStore,
      lyrics: this.lyrics,
      library: this.library,
      permissionService: this.permissionService,
      botUserId: this.botUserId,
      registry: this.registry,
      startedAt: this.startedAt,

      message,
      command,
      commandName: parsed.name,
      args: parsed.args,
      rawArgs: parsed.rawArgs,
      guildId: message.guild_id ?? null,
      channelId,
      authorId: message.author?.id ?? message.user_id ?? message.member?.user?.id ?? null,

      safeTyping: async () => {
        try {
          await this.rest.sendTyping(channelId);
        } catch {
          // typing indicator is optional
        }
      },

      reply: {
        info: async (text, fields = null) => this._safeReply(channelId, 'info', text, fields),
        success: async (text, fields = null) => this._safeReply(channelId, 'success', text, fields),
        warning: async (text, fields = null) => this._safeReply(channelId, 'warning', text, fields),
        error: async (text, fields = null) => this._safeReply(channelId, 'error', text, fields),
        plain: async (text) => this._safeReply(channelId, 'plain', text),
      },
    };
  }

  async _resolveGuildConfig(guildId) {
    if (!guildId || !this.guildConfigs) return null;

    try {
      return await this.guildConfigs.get(guildId);
    } catch (err) {
      this.logger?.warn?.('Failed to resolve guild config', {
        guildId,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  _bindSessionEvents() {
    this.sessions.on('trackStart', async ({ session, track }) => {
      const channelId = this._resolveEventChannelId(session);
      if (!channelId) return;

      await this._safeReply(
        channelId,
        'info',
        `Now playing: **${track.title}** (${track.duration})`
      );
    });

    this.sessions.on('trackError', async ({ session, track, error }) => {
      const channelId = this._resolveEventChannelId(session);
      if (!channelId) return;
      await this._safeReply(
        channelId,
        'error',
        `Playback error on **${track?.title ?? 'unknown'}**: ${error?.message ?? 'unknown error'}`
      );
    });

    this.sessions.on('queueEmpty', async ({ session }) => {
      const channelId = this._resolveEventChannelId(session);
      if (!channelId) return;

      const idleSeconds = Math.floor(this.config.sessionIdleMs / 1000);
      const suffix = session.settings.stayInVoiceEnabled
        ? '24/7 mode is enabled, so I will stay connected.'
        : `I will disconnect after ${idleSeconds}s of inactivity.`;
      await this._safeReply(
        channelId,
        'info',
        `Queue is empty. ${suffix}`
      );
    });

    this.sessions.on('autoplayQueued', async ({ session, track }) => {
      const channelId = this._resolveEventChannelId(session);
      if (!channelId) return;
      await this._safeReply(
        channelId,
        'info',
        `Autoplay added: **${track.title}** (${track.duration})`
      );
    });

    this.sessions.on('autoplayFailed', async ({ session, error }) => {
      const channelId = this._resolveEventChannelId(session);
      if (!channelId) return;
      await this._safeReply(
        channelId,
        'warning',
        `Autoplay failed: ${error?.message ?? 'unknown error'}`
      );
    });

    this.sessions.on('destroyed', async ({ session, reason }) => {
      const channelId = this._resolveEventChannelId(session);
      if (!channelId) return;
      if (reason === 'manual_command') return;

      const reasonText = reason === 'idle_timeout'
        ? 'Session closed due to inactivity.'
        : `Session closed (${reason}).`;

      await this._safeReply(channelId, 'warning', reasonText);
    });

    this.sessions.on('trackEnd', async ({ session, track, seekRestart }) => {
      if (!this.library || !session?.guildId || !track || seekRestart) return;

      await this.library.appendGuildHistory(session.guildId, track).catch((err) => {
        this.logger?.warn?.('Failed to persist guild history entry', {
          guildId: session.guildId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });
  }

  _resolveEventChannelId(session) {
    return session?.settings?.musicLogChannelId ?? session?.textChannelId ?? null;
  }

  async _safeReply(channelId, type, text, fields = null) {
    try {
      if (type === 'info') return await this.responder.info(channelId, text, fields);
      if (type === 'success') return await this.responder.success(channelId, text, fields);
      if (type === 'warning') return await this.responder.warning(channelId, text, fields);
      if (type === 'error') return await this.responder.error(channelId, text, fields);
      return await this.responder.plain(channelId, text);
    } catch (err) {
      this.logger?.warn?.('Failed to send command response', {
        channelId,
        type,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}
