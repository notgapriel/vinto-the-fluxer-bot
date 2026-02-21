import test from 'node:test';
import assert from 'node:assert/strict';

import { registerCommands } from '../src/bot/commands/index.js';
import { CommandRegistry } from '../src/bot/commandRegistry.js';

function buildAutoplayCommand() {
  const registry = new CommandRegistry();
  registerCommands(registry);
  return registry.resolve('autoplay');
}

function baseGuildConfig() {
  return {
    guildId: 'guild-1',
    prefix: '!',
    settings: {
      autoplayEnabled: false,
      dedupeEnabled: false,
      stayInVoiceEnabled: false,
      voteSkipRatio: 0.5,
      voteSkipMinVotes: 2,
      djRoleIds: [],
      musicLogChannelId: null,
    },
  };
}

test('config command allows users with manage guild permission', async () => {
  const autoplay = buildAutoplayCommand();
  let replied = false;

  await autoplay.execute({
    guildId: 'guild-1',
    args: [],
    message: {
      guild_id: 'guild-1',
      author: { id: 'user-1' },
      member: { permissions: '32' },
    },
    guildConfigs: {
      async get() {
        return baseGuildConfig();
      },
      async update() {
        throw new Error('update should not be called');
      },
    },
    sessions: {
      applyGuildConfig() {},
    },
    reply: {
      async info() {
        replied = true;
      },
    },
  });

  assert.equal(replied, true);
});

test('config command rejects users without manage guild permission', async () => {
  const autoplay = buildAutoplayCommand();

  await assert.rejects(
    () => autoplay.execute({
      guildId: 'guild-1',
      args: [],
      message: {
        guild_id: 'guild-1',
        author: { id: 'user-1' },
        member: { permissions: '0' },
      },
      guildConfigs: {
        async get() {
          return baseGuildConfig();
        },
      },
      sessions: {
        applyGuildConfig() {},
      },
      reply: {
        async info() {},
      },
    }),
    /Manage Server/
  );
});
