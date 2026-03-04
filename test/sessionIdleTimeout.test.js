import test from 'node:test';
import assert from 'node:assert/strict';

import { SessionManager } from '../src/bot/sessionManager.js';

function createManager(overrides = {}) {
  const defaultConfig = {
    sessionIdleMs: 20,
    defaultDedupeEnabled: false,
    defaultStayInVoiceEnabled: false,
    voteSkipRatio: 0.5,
    voteSkipMinVotes: 2,
  };

  return new SessionManager({
    gateway: {},
    config: { ...defaultConfig, ...(overrides.config ?? {}) },
    guildConfigs: null,
    logger: null,
    voiceStateStore: overrides.voiceStateStore ?? null,
    botUserId: overrides.botUserId ?? null,
  });
}

function createIdleSession() {
  return {
    guildId: 'guild-1',
    connection: {
      channelId: 'voice-1',
    },
    player: {
      playing: false,
      currentTrack: null,
      queue: {
        pendingSize: 0,
      },
    },
    settings: {
      stayInVoiceEnabled: false,
    },
    idleTimer: null,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('idle timeout destroys session when no playback and no listeners', async () => {
  const manager = createManager({
    voiceStateStore: {
      countUsersInChannel() {
        return 0;
      },
    },
  });
  const session = createIdleSession();

  const calls = [];
  manager.destroy = async (guildId, reason) => {
    calls.push([guildId, reason]);
    return true;
  };

  manager._scheduleIdleTimeout(session);
  await sleep(50);
  manager._clearIdleTimer(session);

  assert.deepEqual(calls, [['guild-1', 'idle_timeout']]);
});

test('idle timeout does not destroy session while human listeners are in VC', async () => {
  const manager = createManager({
    voiceStateStore: {
      countUsersInChannel(guildId, channelId, excludedIds) {
        assert.equal(guildId, 'guild-1');
        assert.equal(channelId, 'voice-1');
        assert.deepEqual(excludedIds, ['bot-1']);
        return 1;
      },
    },
    botUserId: 'bot-1',
  });
  const session = createIdleSession();

  let destroyCalls = 0;
  manager.destroy = async () => {
    destroyCalls += 1;
    return true;
  };

  manager._scheduleIdleTimeout(session);
  await sleep(55);
  manager._clearIdleTimer(session);

  assert.equal(destroyCalls, 0);
});

test('idle timeout does not destroy session while playback is active', async () => {
  const manager = createManager({
    voiceStateStore: {
      countUsersInChannel() {
        return 0;
      },
    },
  });
  const session = createIdleSession();
  session.player.playing = true;

  let destroyCalls = 0;
  manager.destroy = async () => {
    destroyCalls += 1;
    return true;
  };

  manager._scheduleIdleTimeout(session);
  await sleep(55);
  manager._clearIdleTimer(session);

  assert.equal(destroyCalls, 0);
});

test('idle timeout does not destroy session while a current track is present', async () => {
  const manager = createManager({
    voiceStateStore: {
      countUsersInChannel() {
        return 0;
      },
    },
  });
  const session = createIdleSession();
  session.player.currentTrack = { id: 'track-1' };

  let destroyCalls = 0;
  manager.destroy = async () => {
    destroyCalls += 1;
    return true;
  };

  manager._scheduleIdleTimeout(session);
  await sleep(55);
  manager._clearIdleTimer(session);

  assert.equal(destroyCalls, 0);
});

test('idle timeout does not destroy session while voice stream is active', async () => {
  const manager = createManager({
    voiceStateStore: {
      countUsersInChannel() {
        return 0;
      },
    },
  });
  const session = createIdleSession();
  session.connection.isStreaming = true;

  let destroyCalls = 0;
  manager.destroy = async () => {
    destroyCalls += 1;
    return true;
  };

  manager._scheduleIdleTimeout(session);
  await sleep(55);
  manager._clearIdleTimer(session);

  assert.equal(destroyCalls, 0);
});
