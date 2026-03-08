import { ValidationError } from '../../core/errors.js';
import {
  extractAppleMusicEntity,
  normalizeThumbnailUrl,
  sanitizeUrlToSearchQuery,
} from './trackUtils.js';

const ITUNES_LOOKUP_BASE = 'https://itunes.apple.com/lookup';
const APPLE_PAGE_TIMEOUT_MS = 10_000;

function toAppleDurationSeconds(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed / 1000);
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function matchMetaTag(html, attribute, name) {
  const pattern = new RegExp(
    `<meta[^>]+${attribute}=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
    'i'
  );
  return html.match(pattern)?.[1] ?? null;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export const appleMethods = {
  async _appleLookup(query = {}) {
    const endpoint = new URL(ITUNES_LOOKUP_BASE);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value == null || value === '') continue;
      endpoint.searchParams.set(key, String(value));
    }

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(APPLE_PAGE_TIMEOUT_MS),
    }).catch(() => null);

    if (!response?.ok) {
      throw new Error(`Apple lookup failed (${response?.status ?? 'network'})`);
    }

    const payload = await response.json().catch(() => null);
    return toArray(payload?.results);
  },

  async _fetchApplePageMetadata(url) {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(APPLE_PAGE_TIMEOUT_MS),
    }).catch(() => null);

    if (!response?.ok) return null;

    const html = await response.text().catch(() => '');
    if (!html) return null;

    const title = decodeHtmlEntities(
      matchMetaTag(html, 'property', 'og:title')
      ?? matchMetaTag(html, 'name', 'twitter:title')
      ?? ''
    );
    const description = decodeHtmlEntities(
      matchMetaTag(html, 'property', 'og:description')
      ?? matchMetaTag(html, 'name', 'description')
      ?? ''
    );
    const image = normalizeThumbnailUrl(
      matchMetaTag(html, 'property', 'og:image')
      ?? matchMetaTag(html, 'name', 'twitter:image')
    );

    return {
      title: title || null,
      description: description || null,
      thumbnailUrl: image,
    };
  },

  _buildAppleMetadataTrack(meta, requestedBy, source = 'applemusic') {
    const trackName = String(meta?.trackName ?? meta?.name ?? '').trim() || 'Apple Music track';
    const artistName = String(meta?.artistName ?? '').trim() || null;
    const trackViewUrl = String(meta?.trackViewUrl ?? meta?.collectionViewUrl ?? meta?.artistViewUrl ?? '').trim();
    const durationSec = toAppleDurationSeconds(meta?.trackTimeMillis ?? meta?.collectionTimeMillis);

    return this._buildTrack({
      title: trackName,
      url: trackViewUrl || 'https://music.apple.com',
      duration: durationSec ?? 'Unknown',
      thumbnailUrl: meta?.artworkUrl100 ?? meta?.artworkUrl60 ?? null,
      requestedBy,
      source,
      artist: artistName,
    });
  },

  _buildAppleFallbackTrack(url, metadata, requestedBy, source = 'applemusic-fallback') {
    const title = String(metadata?.title ?? '').trim();
    const description = String(metadata?.description ?? '').trim();
    let artist = null;
    if (description.includes(' · ')) {
      const parts = description.split(' · ').map((part) => part.trim()).filter(Boolean);
      artist = parts[1] ?? null;
    }

    return {
      title: title || null,
      artist,
      url,
      thumbnailUrl: metadata?.thumbnailUrl ?? null,
      requestedBy,
      source,
    };
  },

  async _resolveAppleFallbackSearch(url, requestedBy) {
    const pageMetadata = await this._fetchApplePageMetadata(url).catch(() => null);
    const fallbackTrack = this._buildAppleFallbackTrack(url, pageMetadata, requestedBy);
    const query = this._pickMirrorSearchQuery(fallbackTrack) || sanitizeUrlToSearchQuery(url);
    if (!query) {
      throw new ValidationError('Could not resolve Apple Music URL to a playable track.');
    }

    if (!this.enableYtSearch) {
      throw new ValidationError('Apple Music mirroring requires YouTube search, which is currently disabled.');
    }
    if (!this.enableYtPlayback) {
      throw new ValidationError('Apple Music mirroring requires YouTube playback, which is currently disabled.');
    }

    const results = await this._searchYouTubeTracks(query, 1, requestedBy).catch(() => []);
    if (!results.length) {
      throw new ValidationError('Could not resolve Apple Music URL to a playable track.');
    }

    return [this._cloneTrack(results[0], {
      source: 'applemusic-fallback',
      requestedBy,
    })];
  },

  async _resolveAppleMirror(metadataTrack, requestedBy) {
    const query = this._pickMirrorSearchQuery(metadataTrack);
    if (!query) {
      throw new ValidationError('Could not build Apple Music mirror search query.');
    }

    if (this.deezerArl && this.enableDeezerImport) {
      const deezerMatches = await this._searchDeezerTracks(query, 3, requestedBy).catch(() => []);
      const deezerBest = this._pickBestSpotifyMirror(metadataTrack, deezerMatches);
      if (deezerBest) {
        return [this._cloneTrack(deezerBest, {
          source: `applemusic-${deezerBest.source ?? 'deezer-search'}`,
          requestedBy,
        })];
      }
    }

    return this._resolveCrossSourceToYouTube([{
      title: metadataTrack.title,
      artist: metadataTrack.artist,
      durationInSec: typeof metadataTrack.duration === 'number'
        ? metadataTrack.duration
        : toAppleDurationSeconds(metadataTrack.duration),
    }], requestedBy, 'applemusic');
  },

  async _resolveAppleTrack(url, requestedBy) {
    const entity = extractAppleMusicEntity(url);
    if (!entity) {
      throw new ValidationError('Could not extract Apple Music track id from URL.');
    }

    const trackId = entity.trackId || ((entity.type === 'song' && /^\d+$/.test(entity.id)) ? entity.id : null);
    if (trackId) {
      const results = await this._appleLookup({
        id: trackId,
        entity: 'song',
        country: entity.countryCode || 'US',
      }).catch(() => []);
      const match = results.find((item) => String(item?.wrapperType ?? '').toLowerCase() === 'track');
      if (match) {
        const metadataTrack = this._buildAppleMetadataTrack(match, requestedBy, 'applemusic');
        return this._resolveAppleMirror(metadataTrack, requestedBy);
      }
    }

    return this._resolveAppleFallbackSearch(url, requestedBy);
  },

  async _resolveAppleCollection(url, requestedBy) {
    const entity = extractAppleMusicEntity(url);
    if (!entity) {
      throw new ValidationError('Could not extract Apple Music collection id from URL.');
    }

    if (entity.type === 'playlist') {
      throw new ValidationError('Apple Music playlists are not supported yet. Use a track or album link.');
    }

    const lookupId = entity.trackId || entity.id;
    if (!/^\d+$/.test(String(lookupId ?? ''))) {
      throw new ValidationError('Could not extract numeric Apple Music collection id from URL.');
    }

    const entityType = entity.type === 'artist' ? 'song' : 'song';
    const results = await this._appleLookup({
      id: lookupId,
      entity: entityType,
      country: entity.countryCode || 'US',
      limit: this.maxPlaylistTracks,
    }).catch(() => []);

    const tracks = [];
    for (const item of results) {
      if (String(item?.wrapperType ?? '').toLowerCase() !== 'track') continue;
      const metadataTrack = this._buildAppleMetadataTrack(item, requestedBy, `applemusic-${entity.type}`);
      try {
        const mirrored = await this._resolveAppleMirror(metadataTrack, requestedBy);
        tracks.push(...mirrored.slice(0, 1));
      } catch (err) {
        this.logger?.warn?.('Failed to mirror Apple Music track', {
          appleTrackId: item?.trackId ?? null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (tracks.length >= this.maxPlaylistTracks) break;
    }

    if (tracks.length) return tracks;
    throw new ValidationError('Could not resolve Apple Music collection to playable tracks.');
  },

  async _resolveAppleByGuess(url, requestedBy) {
    const entity = extractAppleMusicEntity(url);
    if (!entity) {
      return this._resolveAppleFallbackSearch(url, requestedBy);
    }

    if (entity.trackId || entity.type === 'song') {
      return this._resolveAppleTrack(url, requestedBy);
    }

    if (entity.type === 'album' || entity.type === 'artist') {
      return this._resolveAppleCollection(url, requestedBy);
    }

    return this._resolveAppleFallbackSearch(url, requestedBy);
  },
};
