import { registerLibraryCommands } from './libraryCommands.js';
import { registerConfigCommands } from './configCommands.js';
import { registerAdvancedCommands } from './advancedCommands.js';
import {
  PLAYLIST_PAGE_SIZE,
  FAVORITES_PAGE_SIZE,
  createCommand,
  ensureGuild,
  requireLibrary,
  getGuildConfigOrThrow,
  ensureDjAccessByConfig,
  parseRequiredInteger,
  normalizeIndex,
  trackLabel,
  ensureConnectedSession,
  resolveQueueGuard,
  applyVoiceProfileIfConfigured,
  updateGuildConfig,
  parseOnOff,
  parseRoleId,
  parseTextChannelId,
  ensureManageGuildAccess,
  getSessionOrThrow,
  ensureDjAccess,
} from './commandHelpers.js';
import { registerCorePlaybackCommands } from './corePlaybackCommands.js';
import { registerQueueEffectsAndMiscCommands } from './queueEffectsMiscCommands.js';

export function registerCommands(registry) {
  registerCorePlaybackCommands(registry);

  registerLibraryCommands(registry, {
    PLAYLIST_PAGE_SIZE,
    FAVORITES_PAGE_SIZE,
    createCommand,
    ensureGuild,
    requireLibrary,
    getGuildConfigOrThrow,
    ensureDjAccessByConfig,
    parseRequiredInteger,
    normalizeIndex,
    trackLabel,
    ensureConnectedSession,
    resolveQueueGuard,
    applyVoiceProfileIfConfigured,
  });

  registerQueueEffectsAndMiscCommands(registry);

  registerConfigCommands(registry, {
    createCommand,
    ensureGuild,
    getGuildConfigOrThrow,
    updateGuildConfig,
    parseOnOff,
    parseRoleId,
    parseTextChannelId,
    ensureManageGuildAccess,
  });

  registerAdvancedCommands(registry, {
    createCommand,
    ensureGuild,
    getSessionOrThrow,
    ensureConnectedSession,
    ensureManageGuildAccess,
    ensureDjAccess,
    parseRequiredInteger,
    parseTextChannelId,
    requireLibrary,
  });
}
