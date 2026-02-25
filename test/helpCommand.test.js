import test from 'node:test';
import assert from 'node:assert/strict';

import { registerCommands } from '../src/bot/commands/index.js';
import { CommandRegistry } from '../src/bot/commandRegistry.js';

function setup() {
  const registry = new CommandRegistry();
  registerCommands(registry);
  return { registry, help: registry.resolve('help') };
}

test('help command sends paginated embed payload', async () => {
  const { registry, help } = setup();
  let sentChannelId = null;
  let sentPayload = null;
  let registeredPagination = null;

  await help.execute({
    prefix: '!',
    registry,
    channelId: 'channel-1',
    rest: {
      async sendMessage(channelId, payload) {
        sentChannelId = channelId;
        sentPayload = payload;
        return { id: 'message-1' };
      },
    },
    async registerHelpPagination(channelId, messageId, pages) {
      registeredPagination = { channelId, messageId, pages };
    },
  });

  assert.equal(sentChannelId, 'channel-1');
  assert.ok(sentPayload);
  assert.ok(Array.isArray(sentPayload.embeds));
  assert.ok(sentPayload.embeds.length > 0);
  assert.match(sentPayload.embeds[0].title, /^Help \d+\/\d+$/);
  assert.equal(typeof sentPayload.embeds[0].description, 'string');
  assert.ok(sentPayload.embeds[0].description.length > 0);

  assert.ok(registeredPagination);
  assert.equal(registeredPagination.channelId, 'channel-1');
  assert.equal(registeredPagination.messageId, 'message-1');
  assert.ok(Array.isArray(registeredPagination.pages));
  assert.ok(registeredPagination.pages.length > 0);
  const combinedDescriptions = registeredPagination.pages
    .map((page) => page?.embeds?.[0]?.description ?? '')
    .join('\n');
  assert.match(combinedDescriptions, /`!help`/);
});
