import test from 'node:test';
import assert from 'node:assert/strict';

import { MusicPlayer } from '../src/player/MusicPlayer.ts';

type MirrorInput = {
  title?: string;
  artist?: string | null;
  durationInSec?: number | null;
};

function createPlayer(overrides = {}) {
  return new MusicPlayer({
    async sendAudio() {},
  }, {
    logger: null,
    deezerArl: null,
    ...overrides,
  });
}

test('bandcamp album urls resolve via mirror import path', async () => {
  const player = createPlayer();
  const originalFetch = global.fetch;

  global.fetch = (async (input) => ({
    ok: true,
    text: async () => `<div data-tralbum="{&quot;artist&quot;:&quot;Tycho&quot;,&quot;art_id&quot;:123,&quot;trackinfo&quot;:[{&quot;title&quot;:&quot;Awake&quot;,&quot;title_link&quot;:&quot;/track/awake&quot;,&quot;duration&quot;:277},{&quot;title&quot;:&quot;Montana&quot;,&quot;title_link&quot;:&quot;/track/montana&quot;,&quot;duration&quot;:241}]}"></div>`,
  }) as unknown as Response) as typeof fetch;

  player._resolveCrossSourceToYouTube = async (items: MirrorInput[], requestedBy: string | null, source: string) => {
    const first = items[0]!;
    return [player._buildTrack({
      title: first.title ?? 'Awake',
      url: 'https://www.youtube.com/watch?v=awake12345',
      duration: first.durationInSec ?? 277,
      requestedBy,
      source,
      artist: first.artist ?? null,
    })];
  };

  try {
    const tracks = await player.previewTracks('https://tycho.bandcamp.com/album/awake', {
      requestedBy: 'user-1',
      limit: 2,
    });
    assert.equal(tracks.length, 2);
    assert.equal(tracks[0]!.title, 'Awake');
  } finally {
    global.fetch = originalFetch;
  }
});

test('audiomack song urls resolve via public metadata api', async () => {
  const player = createPlayer();
  const originalFetch = global.fetch;

  global.fetch = (async (input) => {
    const url = String(input);
    if (!url.startsWith('https://api.audiomack.com/v1/music/song/')) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return {
      ok: true,
      json: async () => ({
        results: [{
          id: 'am123',
          title: '1999',
          url: 'https://audiomack.com/prince/song/1999',
          duration: 379,
          image_base: 'https://images.audiomack.com/demo.jpg',
          artist: 'Prince',
        }],
      }),
    } as unknown as Response;
  }) as typeof fetch;

  player._resolveCrossSourceToYouTube = async (items: MirrorInput[], requestedBy: string | null, source: string) => [
    player._buildTrack({
      title: items[0]!.title ?? '1999',
      url: 'https://www.youtube.com/watch?v=1999demo123',
      duration: items[0]!.durationInSec ?? 379,
      requestedBy,
      source,
      artist: items[0]!.artist ?? null,
    }),
  ];

  try {
    const tracks = await player.previewTracks('https://audiomack.com/prince/song/1999', {
      requestedBy: 'user-1',
    });
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0]!.title, '1999');
  } finally {
    global.fetch = originalFetch;
  }
});

test('mixcloud playlist urls resolve via graphql playlist metadata', async () => {
  const player = createPlayer();
  const originalFetch = global.fetch;

  global.fetch = (async (input) => {
    const url = String(input);
    if (!url.startsWith('https://app.mixcloud.com/graphql')) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return {
      ok: true,
      json: async () => ({
        data: {
          playlistLookup: {
            items: {
              edges: [{
                node: {
                  cloudcast: {
                    audioLength: 3600,
                    name: 'Demo Mix',
                    url: 'https://www.mixcloud.com/demo/demo-mix/',
                    owner: { displayName: 'DJ Demo' },
                    picture: { url: 'https://thumbnail.mixcloud.com/demo.jpg' },
                  },
                },
              }],
            },
          },
        },
      }),
    } as unknown as Response;
  }) as typeof fetch;

  player._resolveCrossSourceToYouTube = async (items: MirrorInput[], requestedBy: string | null, source: string) => [
    player._buildTrack({
      title: items[0]!.title ?? 'Demo Mix',
      url: 'https://www.youtube.com/watch?v=mixdemo1234',
      duration: items[0]!.durationInSec ?? 3600,
      requestedBy,
      source,
      artist: items[0]!.artist ?? null,
    }),
  ];

  try {
    const tracks = await player.previewTracks('https://www.mixcloud.com/demo/playlists/showcase/', {
      requestedBy: 'user-1',
      limit: 1,
    });
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0]!.title, 'Demo Mix');
  } finally {
    global.fetch = originalFetch;
  }
});

test('jiosaavn song urls resolve via metadata api', async () => {
  const player = createPlayer();
  const originalFetch = global.fetch;

  global.fetch = (async (input) => {
    const url = String(input);
    if (!url.startsWith('https://www.jiosaavn.com/api.php')) {
      throw new Error(`Unexpected fetch: ${url}`);
    }
    return {
      ok: true,
      json: async () => ({
        abc123: {
          id: 'abc123',
          title: 'Kun Faya Kun',
          perma_url: 'https://www.jiosaavn.com/song/kun-faya-kun/abc123',
          image: 'https://c.saavncdn.com/000/demo-150x150.jpg',
          more_info: {
            duration: '469',
            artistMap: {
              primary_artists: [{ name: 'A.R. Rahman' }],
            },
          },
        },
      }),
    } as unknown as Response;
  }) as typeof fetch;

  player._resolveCrossSourceToYouTube = async (items: MirrorInput[], requestedBy: string | null, source: string) => [
    player._buildTrack({
      title: items[0]!.title ?? 'Kun Faya Kun',
      url: 'https://www.youtube.com/watch?v=jiosaavn123',
      duration: items[0]!.durationInSec ?? 469,
      requestedBy,
      source,
      artist: items[0]!.artist ?? null,
    }),
  ];

  try {
    const tracks = await player.previewTracks('https://www.jiosaavn.com/song/kun-faya-kun/abc123', {
      requestedBy: 'user-1',
    });
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0]!.title, 'Kun Faya Kun');
  } finally {
    global.fetch = originalFetch;
  }
});
