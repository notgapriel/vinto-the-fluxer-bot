import test from 'node:test';
import assert from 'node:assert/strict';

import { registerCommands } from '../src/bot/commands/index.js';
import { CommandRegistry } from '../src/bot/commandRegistry.js';

function setup() {
  const registry = new CommandRegistry();
  registerCommands(registry);
  return { registry, help: registry.resolve('help') };
}

test('help command groups output by categories', async () => {
  const { registry, help } = setup();
  let payload = null;

  await help.execute({
    prefix: '!',
    registry,
    reply: {
      async info(text, fields) {
        payload = { text, fields };
      },
    },
  });

  assert.equal(payload.text, 'Commands by category');
  assert.ok(Array.isArray(payload.fields));
  assert.ok(payload.fields.length > 0);

  const names = payload.fields.map((field) => field.name);
  assert.ok(names.some((name) => name.startsWith('Playback')));
  assert.ok(names.some((name) => name.startsWith('Configuration')));
  assert.equal(names.some((name) => name.startsWith('Available')), false);
});
