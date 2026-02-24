import { ValidationError } from '../../core/errors.js';
import {
  createCommand,
  ensureGuild,
  getSessionOrThrow,
  ensureDjAccess,
  parseRequiredInteger,
  trackLabel,
  parseOnOff,
  getGuildConfigOrThrow,
  updateGuildConfig,
  parseRoleId,
  parseTextChannelId,
  ensureManageGuildAccess,
  ensureConnectedSession,
  requireLibrary,
  ensureSessionTrack,
  computeVoteSkipRequirement,
  fetchGlobalGuildAndUserCounts,
  formatUptimeCompact,
} from './commandHelpers.js';

export function registerQueueEffectsAndMiscCommands(registry) {
  registry.register(createCommand({
    name: 'remove',
    aliases: ['rm'],
    description: 'Remove a queued track by index (from queue view).',
    usage: 'remove <index>',
    async execute(ctx) {
      ensureGuild(ctx);
      const session = getSessionOrThrow(ctx);
      ensureDjAccess(ctx, session, 'remove tracks');

      const index = parseRequiredInteger(ctx.args[0], 'Index');
      const removed = session.player.removeFromQueue(index);

      if (!removed) {
        await ctx.reply.warning('Invalid queue index.');
        return;
      }

      await ctx.reply.success(`Removed: ${trackLabel(removed)}`);
    },
  }));

  registry.register(createCommand({
    name: 'clear',
    aliases: ['cq'],
    description: 'Clear all pending tracks.',
    usage: 'clear',
    async execute(ctx) {
      ensureGuild(ctx);
      const session = getSessionOrThrow(ctx);
      ensureDjAccess(ctx, session, 'clear the queue');

      const removed = session.player.pendingTracks.length;
      session.player.clearQueue();

      await ctx.reply.success(`Cleared ${removed} pending track(s).`);
    },
  }));

  registry.register(createCommand({
    name: 'shuffle',
    aliases: ['mix'],
    description: 'Shuffle pending queue tracks.',
    usage: 'shuffle',
    async execute(ctx) {
      ensureGuild(ctx);
      const session = getSessionOrThrow(ctx);
      ensureDjAccess(ctx, session, 'shuffle the queue');

      const count = session.player.shuffleQueue();
      await ctx.reply.success(`Shuffled ${count} pending track(s).`);
    },
  }));

  registry.register(createCommand({
    name: 'loop',
    aliases: ['repeat'],
    description: 'Set loop mode: off, track, queue.',
    usage: 'loop <off|track|queue>',
    async execute(ctx) {
      ensureGuild(ctx);
      const session = getSessionOrThrow(ctx);
      ensureDjAccess(ctx, session, 'change loop mode');

      if (!ctx.args.length) {
        await ctx.reply.info(`Current loop mode: **${session.player.loopMode}**`);
        return;
      }

      const mode = session.player.setLoopMode(ctx.args[0]);
      await ctx.reply.success(`Loop mode set to **${mode}**.`);
    },
  }));

  registry.register(createCommand({
    name: 'volume',
    aliases: ['vol'],
    description: 'Get/set volume percentage.',
    usage: 'volume [0-200]',
    async execute(ctx) {
      ensureGuild(ctx);
      const session = getSessionOrThrow(ctx);
      ensureDjAccess(ctx, session, 'change volume');

      if (!ctx.args.length) {
        await ctx.reply.info(`Current volume: **${session.player.volumePercent}%**`);
        return;
      }

      const next = session.player.setVolumePercent(ctx.args[0]);
      await ctx.reply.success(`Volume set to **${next}%** (applies immediately to new tracks).`);
    },
  }));

  registry.register(createCommand({
    name: 'filter',
    aliases: ['fx'],
    description: 'Set audio filter preset.',
    usage: 'filter [off|bassboost|nightcore|vaporwave|8d|soft|karaoke|radio]',
    async execute(ctx) {
      ensureGuild(ctx);
      const session = getSessionOrThrow(ctx);
      ensureDjAccess(ctx, session, 'change audio filters');

      if (!ctx.args.length) {
        await ctx.reply.info(
          `Current filter: **${session.player.getAudioEffectsState().filterPreset}**`,
          [{ name: 'Available', value: session.player.getAvailableFilterPresets().join(', ').slice(0, 1000) }]
        );
        return;
      }

      const filter = session.player.setFilterPreset(ctx.args[0]);
      const restarted = session.player.refreshCurrentTrackProcessing();
      await ctx.reply.success(
        `Filter set to **${filter}**.${restarted ? ' Reapplying to current track...' : ''}`
      );
    },
  }));

  registry.register(createCommand({
    name: 'eq',
    description: 'Set EQ preset.',
    usage: 'eq [flat|pop|rock|edm|vocal]',
    async execute(ctx) {
      ensureGuild(ctx);
      const session = getSessionOrThrow(ctx);
      ensureDjAccess(ctx, session, 'change EQ');

      if (!ctx.args.length) {
        await ctx.reply.info(
          `Current EQ: **${session.player.getAudioEffectsState().eqPreset}**`,
          [{ name: 'Available', value: session.player.getAvailableEqPresets().join(', ').slice(0, 1000) }]
        );
        return;
      }

      const args = [...ctx.args];
      if (String(args[0]).toLowerCase() === 'preset') {
        args.shift();
      }

      const preset = session.player.setEqPreset(args[0]);
      const restarted = session.player.refreshCurrentTrackProcessing();
      await ctx.reply.success(
        `EQ preset set to **${preset}**.${restarted ? ' Reapplying to current track...' : ''}`
      );
    },
  }));

  registry.register(createCommand({
    name: 'tempo',
    description: 'Set playback tempo (0.5 - 2.0).',
    usage: 'tempo <0.5-2.0>',
    async execute(ctx) {
      ensureGuild(ctx);
      const session = getSessionOrThrow(ctx);
      ensureDjAccess(ctx, session, 'change tempo');

      const tempo = session.player.setTempoRatio(ctx.args[0]);
      const restarted = session.player.refreshCurrentTrackProcessing();
      await ctx.reply.success(
        `Tempo set to **${tempo.toFixed(2)}x**.${restarted ? ' Reapplying to current track...' : ''}`
      );
    },
  }));

  registry.register(createCommand({
    name: 'pitch',
    description: 'Set pitch shift in semitones (-12 to +12).',
    usage: 'pitch <-12..12>',
    async execute(ctx) {
      ensureGuild(ctx);
      const session = getSessionOrThrow(ctx);
      ensureDjAccess(ctx, session, 'change pitch');

      const pitch = session.player.setPitchSemitones(ctx.args[0]);
      const restarted = session.player.refreshCurrentTrackProcessing();
      const signed = pitch >= 0 ? `+${pitch}` : String(pitch);
      await ctx.reply.success(
        `Pitch set to **${signed} semitones**.${restarted ? ' Reapplying to current track...' : ''}`
      );
    },
  }));

  registry.register(createCommand({
    name: 'effects',
    aliases: ['fxstate'],
    description: 'Show current audio effect state.',
    usage: 'effects',
    async execute(ctx) {
      ensureGuild(ctx);
      const session = getSessionOrThrow(ctx);

      const state = session.player.getAudioEffectsState();
      await ctx.reply.info('Audio effects', [
        { name: 'Filter', value: state.filterPreset, inline: true },
        { name: 'EQ', value: state.eqPreset, inline: true },
        { name: 'Tempo', value: `${state.tempoRatio.toFixed(2)}x`, inline: true },
        { name: 'Pitch', value: String(state.pitchSemitones), inline: true },
      ]);
    },
  }));

  registry.register(createCommand({
    name: 'voteskip',
    aliases: ['vs'],
    description: 'Show current vote-skip progress.',
    usage: 'voteskip',
    async execute(ctx) {
      ensureGuild(ctx);
      const session = getSessionOrThrow(ctx);
      ensureSessionTrack(ctx, session);

      const needed = computeVoteSkipRequirement(ctx, session);
      const current = ctx.sessions.getVoteCount(ctx.guildId);
      await ctx.reply.info(`Vote-skip progress: **${current}/${needed}**`);
    },
  }));

  registry.register(createCommand({
    name: 'lyrics',
    aliases: ['ly'],
    description: 'Show lyrics for current track or a query.',
    usage: 'lyrics [artist - title]',
    async execute(ctx) {
      const query = ctx.args.join(' ').trim();
      const session = ctx.guildId ? ctx.sessions.get(ctx.guildId) : null;
      const fallback = session?.player?.currentTrack?.title ?? null;
      const effectiveQuery = query || fallback;

      if (!effectiveQuery) {
        throw new ValidationError('Provide a song query or play a track first.');
      }

      await ctx.safeTyping();
      const result = await ctx.lyrics.search(effectiveQuery);
      if (!result) {
        await ctx.reply.warning(`No lyrics found for: **${effectiveQuery}**`);
        return;
      }

      await ctx.reply.info(`Lyrics for **${effectiveQuery}**`, [
        { name: `Source: ${result.source}`, value: result.lyrics.slice(0, 1000) },
      ]);
    },
  }));

  registry.register(createCommand({
    name: 'stats',
    description: 'Show runtime statistics.',
    usage: 'stats',
    async execute(ctx) {
      const uptimeSeconds = Math.floor((Date.now() - ctx.startedAt) / 1000);
      const mem = process.memoryUsage();
      const globalCounts = await fetchGlobalGuildAndUserCounts(ctx.rest).catch(() => null);

      const serverCountLabel = globalCounts?.guildCount == null
        ? 'n/a'
        : String(globalCounts.guildCount);
      const userCountLabel = globalCounts?.userCount == null
        ? 'n/a'
        : (
          globalCounts.incompleteGuildCount > 0
            ? `${globalCounts.userCount} (partial)`
            : String(globalCounts.userCount)
        );

      await ctx.reply.info('Runtime statistics', [
        { name: 'Uptime', value: formatUptimeCompact(uptimeSeconds), inline: true },
        { name: 'Guild sessions', value: String(ctx.sessions.sessions.size), inline: true },
        { name: 'Servers total', value: serverCountLabel, inline: true },
        { name: 'Users total', value: userCountLabel, inline: true },
        { name: 'Heap Used', value: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`, inline: true },
      ]);
    },
  }));
}

