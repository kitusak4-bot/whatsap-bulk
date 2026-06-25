import { PostHog } from 'posthog-node'

let client = null
let enabled = false

export const initAnalytics = (cfg, logger) => {
  const apiKey = process.env.POSTHOG_API_KEY
  const host = process.env.POSTHOG_HOST || 'https://app.posthog.com'

  if (!apiKey) {
    logger.info('PostHog API key not configured — skipping analytics')
    return
  }

  client = new PostHog(apiKey, {
    host,
    flushAt: 20,
    flushInterval: 10000
  })

  enabled = true
  logger.info({ host }, 'PostHog analytics initialized')
}

export const trackEvent = (distinctId, event, properties = {}) => {
  if (!enabled || !client) return
  try {
    client.capture({
      distinctId,
      event,
      properties
    })
  } catch (err) {
    // analytics failures are non-critical
    console.error('Analytics capture error:', err.message)
  }
}

export const identifyUser = (distinctId, traits = {}) => {
  if (!enabled || !client) return
  try {
    client.identify({
      distinctId,
      traits
    })
  } catch (err) {
    console.error('Analytics identify error:', err.message)
  }
}

export const flushAnalytics = async () => {
  if (!enabled || !client) return
  try {
    await client.flush()
  } catch (err) {
    console.error('Analytics flush error:', err.message)
  }
}

export const shutdownAnalytics = async () => {
  if (!enabled || !client) return
  try {
    await client.shutdown()
  } catch (err) {
    console.error('Analytics shutdown error:', err.message)
  }
}

export const isAnalyticsEnabled = () => enabled
