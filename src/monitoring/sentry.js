export async function initializeSentry(config, logger) {
  if (!config?.sentryDsn) {
    return null;
  }

  try {
    const sentryModule = await import('@sentry/node');
    const Sentry = sentryModule.default ?? sentryModule;

    Sentry.init({
      dsn: config.sentryDsn,
      environment: config.sentryEnvironment ?? 'production',
      tracesSampleRate: 0,
    });

    logger?.info?.('Sentry initialized', {
      environment: config.sentryEnvironment ?? 'production',
    });

    return {
      captureException(error, context = {}) {
        try {
          Sentry.withScope((scope) => {
            for (const [key, value] of Object.entries(context ?? {})) {
              scope.setExtra(key, value);
            }
            Sentry.captureException(error);
          });
        } catch {
          // ignore sentry capture errors
        }
      },
      async flush(timeoutMs = 1_500) {
        try {
          await Sentry.flush(timeoutMs);
        } catch {
          // ignore flush errors
        }
      },
    };
  } catch (err) {
    logger?.warn?.('Sentry DSN set but @sentry/node is not installed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
