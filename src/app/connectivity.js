import { sleep } from '../utils/retry.js';

export async function verifyApiConnectivity({ config, rest, logger }) {
  let lastError = null;

  for (let attempt = 1; attempt <= config.apiCheckRetries; attempt += 1) {
    try {
      const me = await rest.getCurrentUser();
      logger.info('REST API check succeeded', {
        apiBase: config.apiBase,
        user: me?.username ?? 'unknown',
      });
      return me;
    } catch (err) {
      lastError = err;
      const detail = err instanceof Error ? err.message : String(err);
      logger.warn('REST API check failed', {
        attempt,
        totalAttempts: config.apiCheckRetries,
        error: detail,
      });

      if (attempt < config.apiCheckRetries) {
        await sleep(config.apiCheckDelayMs * attempt);
      }
    }
  }

  const finalDetail = lastError instanceof Error ? lastError.message : String(lastError);
  const message = `REST API check failed after ${config.apiCheckRetries} attempt(s): ${finalDetail}`;

  if (config.strictStartupCheck) {
    throw new Error(message);
  }

  logger.warn(`${message}. Continuing startup due to non-strict mode.`);
  return null;
}

export async function resolveGatewayUrl({ config, rest, logger }) {
  if (!config.autoGatewayUrl) {
    return config.gatewayUrl;
  }

  try {
    const data = await rest.getGatewayBot();
    if (typeof data?.url === 'string' && data.url.startsWith('ws')) {
      logger.info('Gateway URL resolved from API', { url: data.url });
      return data.url;
    }
  } catch (err) {
    logger.warn('Failed to resolve gateway URL from API, using configured fallback', {
      error: err instanceof Error ? err.message : String(err),
      fallback: config.gatewayUrl,
    });
  }

  return config.gatewayUrl;
}
