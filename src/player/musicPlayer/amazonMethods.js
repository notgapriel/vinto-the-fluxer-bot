import { ValidationError } from '../../core/errors.js';
import {
  extractAmazonMusicEntity,
  normalizeThumbnailUrl,
  sanitizeUrlToSearchQuery,
} from './trackUtils.js';

const AMAZON_PAGE_TIMEOUT_MS = 10_000;

function pickAmazonOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return 'https://music.amazon.com';
  }
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
  const patterns = [
    new RegExp(
      `<meta[^>]+${attribute}=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`,
      'i'
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+${attribute}=["']${name}["'][^>]*>`,
      'i'
    ),
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function stripAmazonSuffix(value) {
  return String(value ?? '')
    .replace(/\s*(?:on\s+)?Amazon\s+Music(?:[:\-|].*)?$/i, '')
    .replace(/\s*-\s*Amazon(?:\.[A-Za-z.]+)?$/i, '')
    .trim();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseIsoDurationToSeconds(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const numeric = Number.parseInt(raw, 10);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;

  const match = raw.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (!match) return null;
  const hours = Number.parseInt(match[1] ?? '0', 10) || 0;
  const minutes = Number.parseInt(match[2] ?? '0', 10) || 0;
  const seconds = Number.parseInt(match[3] ?? '0', 10) || 0;
  const total = (hours * 3600) + (minutes * 60) + seconds;
  return total > 0 ? total : null;
}

function pickArtist(value) {
  if (Array.isArray(value)) {
    const names = value
      .map((entry) => pickArtist(entry))
      .filter(Boolean);
    return names.join(', ') || null;
  }

  if (!value || typeof value !== 'object') {
    const raw = String(value ?? '').trim();
    return raw || null;
  }

  const candidates = [
    value.name,
    value.title,
    value.artist,
    value.byArtist?.name,
    value.author?.name,
    value.creator?.name,
  ];

  for (const candidate of candidates) {
    const raw = String(candidate ?? '').trim();
    if (raw) return raw;
  }

  return null;
}

function normalizeAmazonStructuredTrack(entry, fallbackUrl, fallbackImage) {
  const item = entry?.item && typeof entry.item === 'object' ? entry.item : entry;
  if (!item || typeof item !== 'object') return null;

  const title = String(item.name ?? item.title ?? '').trim();
  if (!title) return null;

  const artist = pickArtist(item.byArtist ?? item.artist ?? item.author ?? item.creator);
  const durationInSec = parseIsoDurationToSeconds(item.duration ?? item.durationInSeconds);
  const url = String(item.url ?? fallbackUrl ?? '').trim() || fallbackUrl;
  const image = normalizeThumbnailUrl(
    item.image?.url
      ?? item.image
      ?? item.thumbnailUrl
      ?? fallbackImage
  );

  return {
    title,
    artist,
    durationInSec,
    url: url || fallbackUrl,
    thumbnailUrl: image,
  };
}

function collectAmazonStructuredTracks(node, fallbackUrl, fallbackImage, sink) {
  if (!node) return;

  if (Array.isArray(node)) {
    for (const entry of node) collectAmazonStructuredTracks(entry, fallbackUrl, fallbackImage, sink);
    return;
  }

  if (typeof node !== 'object') return;

  const type = String(node['@type'] ?? '').trim().toLowerCase();
  if (type === 'musicrecording') {
    const track = normalizeAmazonStructuredTrack(node, fallbackUrl, fallbackImage);
    if (track) sink.push(track);
  }

  if (type === 'musicalbum' || type === 'musicplaylist' || type === 'itemlist') {
    collectAmazonStructuredTracks(node.track, fallbackUrl, fallbackImage, sink);
    collectAmazonStructuredTracks(node.tracks, fallbackUrl, fallbackImage, sink);
    collectAmazonStructuredTracks(node.itemListElement, fallbackUrl, fallbackImage, sink);
  }

  if (node.item) {
    collectAmazonStructuredTracks(node.item, fallbackUrl, fallbackImage, sink);
  }
}

function dedupeTracks(tracks) {
  const seen = new Set();
  const result = [];
  for (const track of tracks) {
    const key = `${String(track?.artist ?? '').toLowerCase()}::${String(track?.title ?? '').toLowerCase()}`;
    if (!track?.title || seen.has(key)) continue;
    seen.add(key);
    result.push(track);
  }
  return result;
}

function isLikelySameAlbum(left, right) {
  const a = String(left ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  const b = String(right ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ');
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function inferFallbackTrack(url, metadata) {
  const title = stripAmazonSuffix(metadata?.title ?? '');
  const description = decodeHtmlEntities(metadata?.description ?? '');

  let artist = null;
  const byMatch = title.match(/^(.*?)\s+by\s+(.+)$/i);
  if (byMatch?.[1] && byMatch?.[2]) {
    return {
      title: byMatch[1].trim(),
      artist: byMatch[2].trim(),
      url,
      thumbnailUrl: metadata?.thumbnailUrl ?? null,
    };
  }

  const descByMatch = description.match(/by\s+([^|,]+)/i);
  if (descByMatch?.[1]) {
    artist = descByMatch[1].trim();
  }

  return {
    title: title || null,
    artist,
    url,
    thumbnailUrl: metadata?.thumbnailUrl ?? null,
  };
}

export const amazonMethods = {
  async _getAmazonLookupConfig(url) {
    const origin = pickAmazonOrigin(url);
    this._amazonLookupConfigCache ??= new Map();
    if (this._amazonLookupConfigCache.has(origin)) {
      return this._amazonLookupConfigCache.get(origin);
    }

    const endpoint = new URL('/config.json', origin);
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(AMAZON_PAGE_TIMEOUT_MS),
    }).catch(() => null);

    if (!response?.ok) {
      throw new Error(`Amazon config lookup failed (${response?.status ?? 'network'})`);
    }

    const payload = await response.json?.().catch(() => null);
    if (!payload?.marketplaceId || !payload?.deviceType || !payload?.deviceId || !payload?.siteRegion || !payload?.csrf?.token) {
      throw new Error('Amazon config lookup did not include required fields.');
    }

    const config = {
      origin,
      siteRegion: String(payload.siteRegion).trim(),
      marketplaceId: String(payload.marketplaceId).trim(),
      musicTerritory: String(payload.musicTerritory ?? '').trim() || null,
      deviceType: String(payload.deviceType).trim(),
      deviceId: String(payload.deviceId).trim(),
      customerId: String(payload.customerId ?? '').trim() || '',
      csrf: {
        token: String(payload.csrf.token).trim(),
        rnd: String(payload.csrf.rnd ?? '').trim(),
        ts: String(payload.csrf.ts ?? '').trim(),
      },
    };

    this._amazonLookupConfigCache.set(origin, config);
    return config;
  },

  async _amazonLegacyLookup(url, asins, requestedContent = 'FULL_CATALOG') {
    const config = await this._getAmazonLookupConfig(url);
    const safeAsins = toArray(asins).map((asin) => String(asin ?? '').trim()).filter(Boolean);
    if (!safeAsins.length) {
      throw new ValidationError('Could not extract a valid Amazon Music ASIN.');
    }

    const endpoint = new URL(`/${encodeURIComponent(config.siteRegion)}/api/muse/legacy/lookup`, config.origin);
    const body = {
      asins: safeAsins,
      requestedContent,
      marketplaceId: config.marketplaceId,
      deviceType: config.deviceType,
      deviceId: config.deviceId,
      customerId: config.customerId,
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'csrf-token': config.csrf.token,
        ...(config.csrf.rnd ? { 'csrf-rnd': config.csrf.rnd } : {}),
        ...(config.csrf.ts ? { 'csrf-ts': config.csrf.ts } : {}),
        origin: config.origin,
        referer: `${config.origin}/`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AMAZON_PAGE_TIMEOUT_MS),
    }).catch(() => null);

    if (!response?.ok) {
      throw new Error(`Amazon lookup failed (${response?.status ?? 'network'})`);
    }

    return response.json?.().catch(() => null);
  },

  _buildAmazonLookupTrack(track, url, requestedBy, source = 'amazonmusic') {
    return this._buildTrack({
      title: String(track?.title ?? '').trim() || 'Amazon Music track',
      url,
      duration: Number.parseInt(String(track?.duration ?? ''), 10) || 'Unknown',
      thumbnailUrl: track?.album?.image ?? track?.image ?? null,
      requestedBy,
      source,
      artist: String(track?.primaryArtistName ?? track?.artist?.name ?? '').trim() || null,
    });
  },

  _buildAmazonLookupAlbum(album, url, requestedBy, source = 'amazonmusic-album') {
    return this._buildAmazonMetadataTrack({
      title: String(album?.title ?? '').trim() || null,
      artist: String(album?.primaryArtistName ?? album?.artist?.name ?? '').trim() || null,
      thumbnailUrl: album?.image ?? null,
      durationInSec: Number.parseInt(String(album?.duration ?? ''), 10) || null,
      url,
    }, requestedBy, source);
  },

  async _searchDeezerAlbumMirrorTracks(artist, album, limit, requestedBy) {
    const safeArtist = String(artist ?? '').trim();
    const safeAlbum = String(album ?? '').trim();
    const safeLimit = Math.max(1, Math.min(this.maxPlaylistTracks, Number.parseInt(String(limit), 10) || this.maxPlaylistTracks));
    if (!safeArtist || !safeAlbum || !this.enableDeezerImport) return [];

    const query = `artist:"${safeArtist.replace(/"/g, '')}" album:"${safeAlbum.replace(/"/g, '')}"`;
    const payload = await this._deezerApiRequest(`/search?q=${encodeURIComponent(query)}`).catch(() => null);
    const items = Array.isArray(payload?.data) ? payload.data : [];
    const tracks = [];
    const seen = new Set();

    for (const item of items) {
      if (tracks.length >= safeLimit) break;
      if (!isLikelySameAlbum(safeAlbum, item?.album?.title)) continue;
      const track = this._buildDeezerTrackFromMetadata(item, requestedBy, 'deezer-search-direct');
      if (!track?.deezerTrackId) continue;
      const key = String(track.deezerTrackId);
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(track);
    }

    return tracks;
  },

  async _fetchAmazonPageMetadata(url) {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(AMAZON_PAGE_TIMEOUT_MS),
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

    const tracks = [];
    const jsonLdPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = jsonLdPattern.exec(html)) !== null) {
      const payload = parseJson(match[1]);
      if (payload) {
        collectAmazonStructuredTracks(payload, url, image, tracks);
      }
    }

    return {
      title: title || null,
      description: description || null,
      thumbnailUrl: image,
      tracks: dedupeTracks(tracks),
    };
  },

  _buildAmazonMetadataTrack(meta, requestedBy, source = 'amazonmusic') {
    return this._buildTrack({
      title: String(meta?.title ?? meta?.name ?? '').trim() || 'Amazon Music track',
      url: String(meta?.url ?? 'https://music.amazon.com').trim() || 'https://music.amazon.com',
      duration: meta?.durationInSec ?? meta?.duration ?? 'Unknown',
      thumbnailUrl: meta?.thumbnailUrl ?? null,
      requestedBy,
      source,
      artist: String(meta?.artist ?? '').trim() || null,
    });
  },

  async _resolveAmazonFallbackSearch(url, requestedBy) {
    const pageMetadata = await this._fetchAmazonPageMetadata(url).catch(() => null);
    const fallbackTrack = inferFallbackTrack(url, pageMetadata);
    const query = this._pickMirrorSearchQuery(fallbackTrack) || sanitizeUrlToSearchQuery(url);
    if (!query) {
      throw new ValidationError('Could not resolve Amazon Music URL to a playable track.');
    }

    if (!this.enableYtSearch) {
      throw new ValidationError('Amazon Music mirroring requires YouTube search, which is currently disabled.');
    }
    if (!this.enableYtPlayback) {
      throw new ValidationError('Amazon Music mirroring requires YouTube playback, which is currently disabled.');
    }

    const results = await this._searchYouTubeTracks(query, 1, requestedBy).catch(() => []);
    if (!results.length) {
      throw new ValidationError('Could not resolve Amazon Music URL to a playable track.');
    }

    return [this._cloneTrack(results[0], {
      source: 'amazonmusic-fallback',
      requestedBy,
    })];
  },

  async _resolveAmazonMirror(metadataTrack, requestedBy) {
    const query = this._pickMirrorSearchQuery(metadataTrack);
    if (!query) {
      throw new ValidationError('Could not build Amazon Music mirror search query.');
    }

    if (this.deezerArl && this.enableDeezerImport) {
      const deezerMatches = await this._searchDeezerTracks(query, 3, requestedBy).catch(() => []);
      const deezerBest = this._pickBestSpotifyMirror(metadataTrack, deezerMatches);
      if (deezerBest) {
        return [this._cloneTrack(deezerBest, {
          source: `amazonmusic-${deezerBest.source ?? 'deezer-search'}`,
          requestedBy,
        })];
      }
    }

    return this._resolveCrossSourceToYouTube([{
      title: metadataTrack.title,
      artist: metadataTrack.artist,
      durationInSec: metadataTrack.duration,
    }], requestedBy, 'amazonmusic');
  },

  async _resolveAmazonTrack(url, requestedBy) {
    const entity = extractAmazonMusicEntity(url);
    const trackAsin = entity?.trackId || (entity?.type === 'track' ? entity.id : null);
    if (trackAsin) {
      const payload = await this._amazonLegacyLookup(url, [trackAsin], 'FULL_CATALOG').catch(() => null);
      const lookupTrack = payload?.trackList?.[0] ?? null;
      if (lookupTrack?.asin) {
        const metadataTrack = this._buildAmazonLookupTrack(lookupTrack, url, requestedBy, 'amazonmusic');
        return this._resolveAmazonMirror(metadataTrack, requestedBy);
      }
    }

    const pageMetadata = await this._fetchAmazonPageMetadata(url).catch(() => null);
    const metadataTrack = pageMetadata?.tracks?.[0]
      ? this._buildAmazonMetadataTrack(pageMetadata.tracks[0], requestedBy, 'amazonmusic')
      : this._buildAmazonMetadataTrack(inferFallbackTrack(url, pageMetadata), requestedBy, 'amazonmusic');

    if (metadataTrack?.title && metadataTrack.title !== 'Amazon Music track') {
      return this._resolveAmazonMirror(metadataTrack, requestedBy);
    }

    return this._resolveAmazonFallbackSearch(url, requestedBy);
  },

  async _resolveAmazonCollection(url, requestedBy) {
    const entity = extractAmazonMusicEntity(url);
    if (entity?.type === 'album' && entity?.id) {
      const payload = await this._amazonLegacyLookup(url, [entity.id], 'FULL_CATALOG').catch(() => null);
      const lookupAlbum = payload?.albumList?.[0] ?? null;
      if (lookupAlbum?.asin) {
        const deezerAlbumTracks = await this._searchDeezerAlbumMirrorTracks(
          lookupAlbum.primaryArtistName ?? lookupAlbum.artist?.name,
          lookupAlbum.title,
          this.maxPlaylistTracks,
          requestedBy
        ).catch(() => []);
        if (deezerAlbumTracks.length) {
          return deezerAlbumTracks.map((track) => this._cloneTrack(track, {
            source: `amazonmusic-${track.source ?? 'deezer-search'}`,
            requestedBy,
          }));
        }

        const albumMetadataTrack = this._buildAmazonLookupAlbum(lookupAlbum, url, requestedBy, 'amazonmusic-album');
        const mirroredAlbumTrack = await this._resolveAmazonMirror(albumMetadataTrack, requestedBy).catch(() => []);
        if (mirroredAlbumTrack.length) return mirroredAlbumTrack;
      }
    }

    const pageMetadata = await this._fetchAmazonPageMetadata(url).catch(() => null);
    const sourceTracks = toArray(pageMetadata?.tracks).slice(0, this.maxPlaylistTracks);

    const tracks = [];
    for (const item of sourceTracks) {
      const metadataTrack = this._buildAmazonMetadataTrack(item, requestedBy, `amazonmusic-${entity?.type ?? 'collection'}`);
      try {
        const mirrored = await this._resolveAmazonMirror(metadataTrack, requestedBy);
        tracks.push(...mirrored.slice(0, 1));
      } catch (err) {
        this.logger?.warn?.('Failed to mirror Amazon Music track', {
          amazonUrl: url,
          title: item?.title ?? null,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (tracks.length >= this.maxPlaylistTracks) break;
    }

    if (tracks.length) return tracks;

    return this._resolveAmazonFallbackSearch(url, requestedBy);
  },

  async _resolveAmazonByGuess(url, requestedBy) {
    const entity = extractAmazonMusicEntity(url);
    if (!entity) {
      return this._resolveAmazonFallbackSearch(url, requestedBy);
    }

    if (entity.trackId || entity.type === 'track') {
      return this._resolveAmazonTrack(url, requestedBy);
    }

    if (entity.type === 'album' || entity.type === 'playlist' || entity.type === 'artist') {
      return this._resolveAmazonCollection(url, requestedBy);
    }

    return this._resolveAmazonTrack(url, requestedBy);
  },
};
