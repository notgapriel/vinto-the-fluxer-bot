import test from 'node:test';
import assert from 'node:assert/strict';

import { MusicPlayer } from '../src/player/MusicPlayer.js';

function createPlayer() {
  return new MusicPlayer({
    async sendAudio() {},
  }, {
    logger: null,
  });
}

function createResponse({
  url,
  contentType,
  ok = true,
  headers = {},
  bodyText = '',
}) {
  const headerMap = new Map([
    ['content-type', contentType ?? ''],
    ...Object.entries(headers).map(([key, value]) => [String(key).toLowerCase(), String(value)]),
  ]);

  return {
    ok,
    url,
    headers: {
      get(name) {
        return headerMap.get(String(name).toLowerCase()) ?? null;
      },
    },
    body: {
      async cancel() {},
    },
    async text() {
      return bodyText;
    },
  };
}

test('generic URL resolver builds live radio track from direct audio stream response', async () => {
  const player = createPlayer();
  const originalFetch = global.fetch;

  global.fetch = async () => createResponse({
    url: 'https://radio.example.com/live',
    contentType: 'audio/mpeg',
    headers: {
      'icy-name': 'Retro FM',
    },
  });

  try {
    const tracks = await player._resolveSingleUrlTrack('https://radio.example.com/listen', 'user-1');
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].source, 'radio-stream');
    assert.equal(tracks[0].title, 'Retro FM');
    assert.equal(tracks[0].duration, 'Live');
    assert.equal(tracks[0].isLive, true);
    assert.equal(tracks[0].url, 'https://radio.example.com/live');
  } finally {
    global.fetch = originalFetch;
  }
});

test('generic URL resolver follows pls playlists to the final radio stream', async () => {
  const player = createPlayer();
  const originalFetch = global.fetch;
  const requests = [];

  global.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url === 'https://radio.example.com/tunein') {
      return createResponse({
        url,
        contentType: 'audio/x-scpls',
        bodyText: '[playlist]\nFile1=https://stream.radio.example.com/live\nTitle1=Radio Example\nLength1=-1\nNumberOfEntries=1\nVersion=2\n',
      });
    }

    return createResponse({
      url: 'https://stream.radio.example.com/live',
      contentType: 'audio/mpeg',
      headers: {
        'icy-name': 'Radio Example',
      },
    });
  };

  try {
    const tracks = await player._resolveSingleUrlTrack('https://radio.example.com/tunein', 'user-1');
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].source, 'radio-stream');
    assert.equal(tracks[0].title, 'Radio Example');
    assert.equal(tracks[0].url, 'https://stream.radio.example.com/live');
    assert.deepEqual(requests, [
      'https://radio.example.com/tunein',
      'https://stream.radio.example.com/live',
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('play() uses direct HTTP pipeline for live radio tracks', async () => {
  const player = createPlayer();
  let radioPipelineCalled = false;

  player._startHttpUrlPipeline = async () => {
    radioPipelineCalled = true;
    player.ffmpeg = {
      stdout: {
        pipe() {},
      },
      once() {},
    };
  };
  player._awaitInitialPlaybackChunk = async () => {};
  player._startYouTubePipeline = async () => {
    throw new Error('youtube pipeline should not be used');
  };
  player._startPlayDlPipeline = async () => {
    throw new Error('play-dl pipeline should not be used');
  };

  player.enqueueResolvedTracks([
    player._buildTrack({
      title: 'Retro FM',
      url: 'https://radio.example.com/live',
      duration: 'Live',
      source: 'radio-stream',
      requestedBy: 'user-1',
      isLive: true,
    }),
  ]);

  await player.play();
  assert.equal(radioPipelineCalled, true);
  assert.equal(player.canSeekCurrentTrack(), false);
});
