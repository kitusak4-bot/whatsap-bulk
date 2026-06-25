import * as Sentry from '@sentry/node'

let enabled = false

export const initSentry = (cfg, logger) => {
  const dsn = process.env.SENTRY_DSN
  if (!dsn) {
    logger.info('Sentry DSN not configured — skipping initialization')
    return
  }

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || cfg.env || 'production',
    release: `baileys-api@${process.env.npm_package_version || '1.0.0'}`,
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
    beforeSend(event) {
      event.tags = { ...event.tags, service: 'baileys-api' }
      return event
    }
  })

  enabled = true
  logger.info('Sentry error tracking initialized')
}

export const getSentry = () => (enabled ? Sentry : null)
export const isSentryEnabled = () => enabled
