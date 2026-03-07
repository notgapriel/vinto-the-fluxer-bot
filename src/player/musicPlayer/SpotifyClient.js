export class SpotifyClient {
  constructor(host) {
    this.host = host;
  }

  resolveTrack(url, requestedBy) {
    return this.host._resolveSpotifyTrack(url, requestedBy);
  }

  resolveCollection(url, requestedBy) {
    return this.host._resolveSpotifyCollection(url, requestedBy);
  }

  resolveArtist(url, requestedBy) {
    return this.host._resolveSpotifyArtist(url, requestedBy);
  }

  resolveByGuess(url, requestedBy) {
    return this.host._resolveSpotifyByGuess(url, requestedBy);
  }
}
