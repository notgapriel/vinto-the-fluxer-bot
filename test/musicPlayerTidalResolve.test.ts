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
    deezerArl: 'dummy-arl-cookie',
    enableTidalImport: true,
    ...overrides,
  });
}

test('tidal track resolver prefers deezer mirror before youtube fallback', async () => {
  const player = createPlayer();

  player._tidalApiRequest = async () => ({
    id: 'td123',
    title: 'Teardrop',
    duration: 330,
    url: 'https://tidal.com/browse/track/td123',
    album: { cover: 'ab-cd-ef-gh' },
    artists: [{ name: 'Massive Attack' }],
  });

  player._searchDeezerTracks = async () => [
    player._buildTrack({
      title: 'Teardrop',
      url: 'https://www.deezer.com/track/999',
      duration: 330,
      requestedBy: 'user-1',
      source: 'deezer-search-direct',
      artist: 'Massive Attack',
      deezerTrackId: '999',
    }),
  ];

  const tracks = await player._resolveTidalTrack('https://tidal.com/browse/track/td123', 'user-1');
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]!.deezerTrackId, '999');
  assert.match(tracks[0]!.source ?? '', /^tidal-/);
});

test('tidal playlist resolver falls back to youtube mirroring when deezer mirror is unavailable', async () => {
  const player = createPlayer({ deezerArl: null });

  player._tidalApiRequest = async (pathname: string) => {
    if (pathname === '/playlists/demo-playlist') {
      return { title: 'Demo Playlist' };
    }
    if (pathname === '/playlists/demo-playlist/tracks') {
      return {
        items: [{
          item: {
            id: 'tdpl1',
            title: 'Midnight City',
            duration: 244,
            url: 'https://tidal.com/browse/track/tdpl1',
            album: { cover: 'ab-cd-ef-gh' },
            artists: [{ name: 'M83' }],
          },
        }],
      };
    }
    throw new Error(`Unexpected Tidal endpoint: ${pathname}`);
  };

  player._resolveCrossSourceToYouTube = async (items: MirrorInput[], requestedBy: string | null, source: string) => {
    const first = items[0]!;
    assert.equal(source, 'tidal');
    assert.equal(requestedBy, 'user-1');
    assert.equal(first.title, 'Midnight City');
    assert.equal(first.artist, 'M83');
    assert.equal(first.durationInSec, 244);

    return [
      player._buildTrack({
        title: 'Midnight City',
        url: 'https://www.youtube.com/watch?v=dX3k_QDnzHE',
        duration: 244,
        requestedBy,
        source: 'tidal-youtube-mirror',
        artist: 'M83',
      }),
    ];
  };

  const tracks = await player._resolveTidalCollection('https://tidal.com/browse/playlist/demo-playlist', 'user-1', 1);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]!.source, 'tidal-youtube-mirror');
});

test('tidal youtube mirroring prefers ISRC search when available', async () => {
  const player = createPlayer({ deezerArl: null });
  const queries: string[] = [];

  player._searchYouTubeTracks = async (query: string, _limit: number, requestedBy: string | null) => {
    queries.push(query);
    return [
      player._buildTrack({
        title: 'Teardrop',
        url: 'https://www.youtube.com/watch?v=teardrop12345',
        duration: 330,
        requestedBy,
        source: 'youtube-search',
        artist: 'Massive Attack',
      }),
    ];
  };

  const metadataTrack = player._buildTrack({
    title: 'Teardrop',
    url: 'https://tidal.com/browse/track/td123',
    duration: 330,
    requestedBy: 'user-1',
    source: 'tidal',
    artist: 'Massive Attack',
    isrc: 'GBBKS9800055',
  });

  const tracks = await (player as MusicPlayer & {
    _resolveTidalMirror: (track: ReturnType<MusicPlayer['_buildTrack']>, requestedBy: string | null) => Promise<ReturnType<MusicPlayer['_buildTrack']>[]>;
  })._resolveTidalMirror(metadataTrack, 'user-1');
  assert.equal(tracks.length, 1);
  assert.deepEqual(queries, ['"GBBKS9800055"']);
});

test('tidal mix urls resolve via previewTracks guess path', async () => {
  const player = createPlayer();
  let captured: { id: string; requestedBy: string | null; limit: number | null | undefined } | null = null;

  player._resolveTidalMix = async (id: string, requestedBy: string | null, limit?: number | null) => {
    captured = { id, requestedBy, limit };
    return [
      player._buildTrack({
        title: 'Demo Mix Track',
        url: 'https://www.youtube.com/watch?v=demo1234567',
        duration: 200,
        requestedBy,
        source: 'tidal-youtube-mirror',
        artist: 'Demo Artist',
      }),
    ];
  };

  const tracks = await player.previewTracks('https://tidal.com/browse/mix/00000000-0000-0000-0000-000000000000', {
    requestedBy: 'user-1',
    limit: 5,
  });

  assert.deepEqual(captured, {
    id: '00000000-0000-0000-0000-000000000000',
    requestedBy: 'user-1',
    limit: 5,
  });
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0]!.title, 'Demo Mix Track');
});
