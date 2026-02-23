const COLORS = {
  brand: 0xff2d78,
  info: 0xff2d78,
  success: 0xff2d78,
  warning: 0xff2d78,
  error: 0xff2d78,
};
const BOT_BRAND = 'Vinto';

function isoNow() {
  return new Date().toISOString();
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

export function buildEmbed({
  title,
  description,
  color = COLORS.brand,
  fields,
  footer,
}) {
  const embed = {
    color,
    timestamp: isoNow(),
  };

  if (title) embed.title = truncate(String(title), 256);
  if (description) embed.description = truncate(String(description), 4096);

  if (Array.isArray(fields) && fields.length) {
    embed.fields = fields.slice(0, 25).map((field) => ({
      name: truncate(String(field.name ?? '-'), 256),
      value: truncate(String(field.value ?? '-'), 1024),
      inline: Boolean(field.inline),
    }));
  }

  const footerText = footer ? `${BOT_BRAND} | ${String(footer)}` : BOT_BRAND;
  embed.footer = { text: truncate(String(footerText), 2048) };

  return embed;
}

function createMessagePayload(text, embed, useEmbeds) {
  if (!useEmbeds || !embed) {
    return { content: text };
  }

  return {
    content: text || undefined,
    embeds: [embed],
    allowed_mentions: {
      parse: [],
      users: [],
      roles: [],
      replied_user: false,
    },
  };
}

export function makeResponder(rest, options = {}) {
  const useEmbeds = options.enableEmbeds !== false;

  return {
    async info(channelId, text, details = null) {
      const payload = createMessagePayload(
        useEmbeds ? null : text,
        buildEmbed({
          title: 'Info',
          description: text,
          color: COLORS.info,
          fields: details,
        }),
        useEmbeds
      );
      return rest.sendMessage(channelId, payload);
    },

    async success(channelId, text, details = null) {
      const payload = createMessagePayload(
        useEmbeds ? null : text,
        buildEmbed({
          title: 'Success',
          description: text,
          color: COLORS.success,
          fields: details,
        }),
        useEmbeds
      );
      return rest.sendMessage(channelId, payload);
    },

    async warning(channelId, text, details = null) {
      const payload = createMessagePayload(
        useEmbeds ? null : text,
        buildEmbed({
          title: 'Warning',
          description: text,
          color: COLORS.warning,
          fields: details,
        }),
        useEmbeds
      );
      return rest.sendMessage(channelId, payload);
    },

    async error(channelId, text, details = null) {
      const payload = createMessagePayload(
        useEmbeds ? null : text,
        buildEmbed({
          title: 'Error',
          description: text,
          color: COLORS.error,
          fields: details,
        }),
        useEmbeds
      );
      return rest.sendMessage(channelId, payload);
    },

    async plain(channelId, text) {
      return rest.sendMessage(channelId, { content: text });
    },
  };
}

export { COLORS };
