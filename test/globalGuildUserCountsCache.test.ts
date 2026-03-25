import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearGlobalGuildAndUserCountsCache,
  fetchCachedGlobalGuildAndUserCounts,
  fetchGlobalGuildCount,
  getCachedGlobalGuildAndUserCounts,
} from '../src/bot/commands/commandHelpers.ts';

test('fetchCachedGlobalGuildAndUserCounts reuses cached user totals for the same rest client', async () => {
  clearGlobalGuildAndUserCountsCache();

  let guildListCalls = 0;
  let memberCalls = 0;
  const rest = {
    async listCurrentUserGuilds() {
      guildListCalls += 1;
      return [{ id: '1' }, { id: '2' }];
    },
    async listGuildMembers(guildId: string) {
      memberCalls += 1;
      if (guildId === '1') return [{ user: { id: '10' } }];
      if (guildId === '2') return [{ user: { id: '20' } }, { user: { id: '21' } }];
      return [];
    },
  };

  const first = await fetchCachedGlobalGuildAndUserCounts(rest);
  const second = await fetchCachedGlobalGuildAndUserCounts(rest);

  assert.deepEqual(first, { guildCount: 2, userCount: 3, incompleteGuildCount: 0 });
  assert.deepEqual(second, first);
  assert.equal(guildListCalls, 1);
  assert.equal(memberCalls, 2);
  assert.deepEqual(getCachedGlobalGuildAndUserCounts(rest), first);
});

test('fetchGlobalGuildCount can return guild total before expensive user counting', async () => {
  clearGlobalGuildAndUserCountsCache();

  let guildListCalls = 0;
  let memberCalls = 0;
  const rest = {
    async listCurrentUserGuilds() {
      guildListCalls += 1;
      return [{ id: '1' }, { id: '2' }, { id: '3' }];
    },
    async listGuildMembers() {
      memberCalls += 1;
      throw new Error('should not be called');
    },
  };

  const guildCount = await fetchGlobalGuildCount(rest);

  assert.equal(guildCount, 3);
  assert.equal(guildListCalls, 1);
  assert.equal(memberCalls, 0);
});
