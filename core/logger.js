/**
 * core/logger.js — lightweight timestamped console wrapper
 *
 * Optional: set DISABLE_CORE_LOGGER=true in env to suppress all output.
 * Not required by any existing code — safe to import anywhere without side effects.
 */

const enabled = process.env.DISABLE_CORE_LOGGER !== 'true'
const pad = n => String(n).padStart(2, '0')
const timestamp = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, '0')}Z`
}

const coreLogger = {
  log: (...args) => { if (enabled) console.log(`[${timestamp()}] [LOG]`, ...args) },
  info: (...args) => { if (enabled) console.info(`[${timestamp()}] [INFO]`, ...args) },
  warn: (...args) => { if (enabled) console.warn(`[${timestamp()}] [WARN]`, ...args) },
  error: (...args) => { if (enabled) console.error(`[${timestamp()}] [ERROR]`, ...args) },
  debug: (...args) => { if (enabled) console.debug(`[${timestamp()}] [DEBUG]`, ...args) },
}

export default coreLogger
