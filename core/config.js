/**
 * core/config.js — safe environment variable access with defaults
 *
 * Use anywhere you need env values without the full Zod-validated config.
 * Every value falls back to a safe default so imports never crash.
 * Does NOT replace or alter src/config.js — that file stays the single
 * authoritative config for the main API server.
 */

const env = process.env

export const coreConfig = {
  get PORT() { return parseInt(env.PORT, 10) || 3000 },
  get HOST() { return env.HOST || '127.0.0.1' },
  get NODE_ENV() { return env.NODE_ENV || 'development' },
  get isDev() { return this.NODE_ENV === 'development' },
  get isProd() { return this.NODE_ENV === 'production' },
  get LOG_LEVEL() { return env.LOG_LEVEL || 'info' },

  /* Campaign paths (relative to project root) */
  get CAMPAIGN_DIR() { return env.CAMPAIGN_DIR || './campaigns' },
  get MAX_REPORTS_TO_LIST() { return parseInt(env.MAX_REPORTS_TO_LIST, 10) || 20 },
}
