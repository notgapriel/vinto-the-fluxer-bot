const ADMINISTRATOR = 1n << 3n;
const VIEW_CHANNEL = 1n << 10n;
const SEND_MESSAGES = 1n << 11n;
const EMBED_LINKS = 1n << 14n;
const CONNECT = 1n << 20n;
const SPEAK = 1n << 21n;

function toBigInt(value) {
  if (value == null) return null;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) return BigInt(trimmed);
  }

  return null;
}

function roleIdsFromMember(member) {
  if (Array.isArray(member?.roles)) return member.roles.map((id) => String(id));
  if (Array.isArray(member?.role_ids)) return member.role_ids.map((id) => String(id));
  return [];
}

function getOverwrites(channel) {
  if (Array.isArray(channel?.permission_overwrites)) return channel.permission_overwrites;
  if (Array.isArray(channel?.permissionOverwrites)) return channel.permissionOverwrites;
  return [];
}

function findOverwrite(overwrites, id) {
  const key = String(id);
  return overwrites.find((entry) => String(entry?.id ?? '') === key) ?? null;
}

export class PermissionService {
  constructor(options = {}) {
    this.rest = options.rest;
    this.botUserId = options.botUserId ? String(options.botUserId) : null;
    this.logger = options.logger;
    this.cacheTtlMs = options.cacheTtlMs ?? 30_000;

    this.guildMemberCache = new Map();
    this.guildCache = new Map();
    this.channelPermCache = new Map();
  }

  setBotUserId(botUserId) {
    this.botUserId = botUserId ? String(botUserId) : null;
  }

  async canBotSendMessages(guildId, channelId) {
    const perms = await this.getBotChannelPermissions(guildId, channelId);
    if (!perms.known) return null;
    return perms.canViewChannel && perms.canSendMessages;
  }

  async canBotJoinAndSpeak(guildId, channelId) {
    const perms = await this.getBotChannelPermissions(guildId, channelId);
    if (!perms.known) return null;
    return perms.canViewChannel && perms.canConnect && perms.canSpeak;
  }

  async getBotChannelPermissions(guildId, channelId) {
    const safeGuildId = String(guildId ?? '').trim();
    const safeChannelId = String(channelId ?? '').trim();
    if (!safeGuildId || !safeChannelId || !this.botUserId) {
      return this._unknown();
    }

    const cacheKey = `${safeGuildId}:${safeChannelId}`;
    const cached = this._getCached(this.channelPermCache, cacheKey);
    if (cached) return cached;

    try {
      const [member, guild, channel] = await Promise.all([
        this._getGuildMember(safeGuildId, this.botUserId),
        this._getGuild(safeGuildId),
        this.rest.getChannel(safeChannelId),
      ]);

      const basePerms = this._computeBaseRolePerms(member, guild);
      if (basePerms == null) {
        return this._cacheAndReturnUnknown(cacheKey);
      }

      const effectivePerms = this._applyChannelOverwrites(basePerms, member, guild, channel);
      const result = this._fromBits(effectivePerms);
      this._setCached(this.channelPermCache, cacheKey, result);
      return result;
    } catch (err) {
      this.logger?.debug?.('Permission resolution failed', {
        guildId: safeGuildId,
        channelId: safeChannelId,
        error: err instanceof Error ? err.message : String(err),
      });
      return this._cacheAndReturnUnknown(cacheKey);
    }
  }

  _computeBaseRolePerms(member, guild) {
    const roles = Array.isArray(guild?.roles) ? guild.roles : [];
    if (!roles.length) return null;

    const map = new Map();
    for (const role of roles) {
      const id = String(role?.id ?? '');
      if (!id) continue;
      map.set(id, role);
    }

    const roleIds = roleIdsFromMember(member);
    if (!roleIds.length) return null;

    let perms = 0n;
    let matched = false;
    for (const roleId of roleIds) {
      const role = map.get(String(roleId));
      if (!role) continue;
      const bits = toBigInt(role.permissions ?? role.permission);
      if (bits == null) continue;
      perms |= bits;
      matched = true;
    }

    return matched ? perms : null;
  }

  _applyChannelOverwrites(basePerms, member, guild, channel) {
    if ((basePerms & ADMINISTRATOR) !== 0n) {
      return basePerms;
    }

    let perms = basePerms;
    const overwrites = getOverwrites(channel);

    const everyone = findOverwrite(overwrites, guild?.id ?? guild?.guild_id);
    if (everyone) {
      perms = this._applyOverwrite(perms, everyone);
    }

    const roleIds = roleIdsFromMember(member);
    let roleDeny = 0n;
    let roleAllow = 0n;
    for (const roleId of roleIds) {
      const ow = findOverwrite(overwrites, roleId);
      if (!ow) continue;
      roleDeny |= toBigInt(ow.deny) ?? 0n;
      roleAllow |= toBigInt(ow.allow) ?? 0n;
    }
    perms &= ~roleDeny;
    perms |= roleAllow;

    const memberOw = findOverwrite(overwrites, this.botUserId);
    if (memberOw) {
      perms = this._applyOverwrite(perms, memberOw);
    }

    return perms;
  }

  _applyOverwrite(perms, overwrite) {
    const deny = toBigInt(overwrite?.deny) ?? 0n;
    const allow = toBigInt(overwrite?.allow) ?? 0n;
    let next = perms;
    next &= ~deny;
    next |= allow;
    return next;
  }

  _fromBits(bits) {
    const canViewChannel = (bits & VIEW_CHANNEL) !== 0n;
    return {
      known: true,
      bits,
      canViewChannel,
      canSendMessages: canViewChannel && (bits & SEND_MESSAGES) !== 0n,
      canEmbedLinks: canViewChannel && (bits & EMBED_LINKS) !== 0n,
      canConnect: canViewChannel && (bits & CONNECT) !== 0n,
      canSpeak: canViewChannel && (bits & SPEAK) !== 0n,
    };
  }

  _unknown() {
    return {
      known: false,
      bits: null,
      canViewChannel: false,
      canSendMessages: false,
      canEmbedLinks: false,
      canConnect: false,
      canSpeak: false,
    };
  }

  _cacheAndReturnUnknown(cacheKey) {
    const value = this._unknown();
    this._setCached(this.channelPermCache, cacheKey, value);
    return value;
  }

  async _getGuildMember(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const cached = this._getCached(this.guildMemberCache, key);
    if (cached) return cached;
    const value = await this.rest.getGuildMember(guildId, userId);
    this._setCached(this.guildMemberCache, key, value);
    return value;
  }

  async _getGuild(guildId) {
    const key = String(guildId);
    const cached = this._getCached(this.guildCache, key);
    if (cached) return cached;
    const value = await this.rest.getGuild(guildId);
    this._setCached(this.guildCache, key, value);
    return value;
  }

  _getCached(map, key) {
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      map.delete(key);
      return null;
    }
    return entry.value;
  }

  _setCached(map, key, value) {
    map.set(key, {
      value,
      expiresAt: Date.now() + this.cacheTtlMs,
    });
  }
}
