import test from 'node:test';
import assert from 'node:assert/strict';

import { MusicPlayer } from '../src/player/MusicPlayer.js';

test('watch URL with list parameter is resolved as YouTube playlist', async () => {
  const player = new MusicPlayer({}, {
    logger: null,
    enableYtPlayback: true,
    enableYtSearch: true,
  });

  const inputUrl = 'https://www.youtube.com/watch?v=X5kmM98iklo&list=PL19SqEq2HQT3KLFZ-YfvA3m3t-mR5XlC7';
  const expectedPlaylistUrl = 'https://www.youtube.com/playlist?list=PL19SqEq2HQT3KLFZ-YfvA3m3t-mR5XlC7';
  const expectedFallbackWatchUrl = 'https://www.youtube.com/watch?v=X5kmM98iklo';

  const originalResolvePlaylist = player._resolveYouTubePlaylistTracks.bind(player);
  const originalResolveVideo = player._resolveSingleYouTubeTrack.bind(player);

  let playlistCalledWith = null;
  let fallbackWatchUrl = null;
  let singleVideoCalled = false;

  player._resolveYouTubePlaylistTracks = async (url, requestedBy, options = {}) => {
    playlistCalledWith = url;
    fallbackWatchUrl = options.fallbackWatchUrl ?? null;
    return [{
      id: 't1',
      title: 'Playlist Track',
      url: 'https://www.youtube.com/watch?v=track1',
      duration: '3:00',
      requestedBy,
      source: 'youtube-playlist',
      queuedAt: Date.now(),
      seekStartSec: 0,
    }];
  };
  player._resolveSingleYouTubeTrack = async () => {
    singleVideoCalled = true;
    return [];
  };

  try {
    const tracks = await player.previewTracks(inputUrl, { requestedBy: 'user-1' });
    assert.equal(singleVideoCalled, false);
    assert.equal(playlistCalledWith, expectedPlaylistUrl);
    assert.equal(fallbackWatchUrl, expectedFallbackWatchUrl);
    assert.equal(tracks.length, 1);
    assert.equal(tracks[0].title, 'Playlist Track');
  } finally {
    player._resolveYouTubePlaylistTracks = originalResolvePlaylist;
    player._resolveSingleYouTubeTrack = originalResolveVideo;
  }
});
