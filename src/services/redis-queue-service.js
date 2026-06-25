import Redis from 'ioredis'

const PREFIX = 'baileys:queue:'
const PENDING_KEY = `${PREFIX}pending`
const PROCESSING_KEY = `${PREFIX}processing`
const RETRY_KEY = `${PREFIX}retry`

export class RedisQueueService {
  constructor({ redisUrl, logger }) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: times => Math.min(times * 200, 5000)
    })
    this.logger = logger
    this._handlers = new Map()
    this._polling = false
    this._timer = null
    this._processing = new Set()
    this._concurrency = 5
  }

  async add(type, payload, { priority = 0, maxAttempts = 3, scheduledAt } = {}) {
    const id = `job:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    const job = JSON.stringify({ id, type, payload, priority, maxAttempts, attempts: 0, status: 'pending', scheduledAt: scheduledAt || new Date().toISOString(), createdAt: new Date().toISOString() })
    await Promise.all([
      this.redis.hset(`${PREFIX}jobs`, id, job),
      this.redis.zadd(PENDING_KEY, priority, id)
    ])
    return id
  }

  async process(type, handler) {
    this._handlers.set(type, handler)
  }

  startPolling(intervalMs = 1000, concurrency = 5) {
    if (this._timer) return
    this._concurrency = concurrency
    this._timer = setInterval(() => this._tick(), intervalMs)
    this._timer.unref()
    this.logger.info({ intervalMs, concurrency }, 'Redis queue polling started')
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
    this.redis.disconnect()
  }

  async _tick() {
    while (this._processing.size < this._concurrency) {
      const id = await this.redis.zpopmin(PENDING_KEY)
      if (!id || !id[0]) break
      const jobRaw = await this.redis.hget(`${PREFIX}jobs`, id[0])
      if (!jobRaw) continue
      const job = JSON.parse(jobRaw)
      this._processing.add(job.id)
      this._processJob(job)
    }
  }

  async _processJob(job) {
    const handler = this._handlers.get(job.type)
    if (!handler) {
      job.status = 'failed'
      job.error = 'No handler registered'
      await this.redis.hset(`${PREFIX}jobs`, job.id, JSON.stringify(job))
      this._processing.delete(job.id)
      return
    }
    try {
      const result = await handler(job.payload, job)
      job.status = 'completed'
      job.result = result
      job.completedAt = new Date().toISOString()
      await this.redis.hset(`${PREFIX}jobs`, job.id, JSON.stringify(job))
    } catch (error) {
      job.attempts++
      if (job.attempts < job.maxAttempts) {
        const delay = Math.min(5000 * Math.pow(2, job.attempts), 3600000)
        job.status = 'pending'
        job.error = error.message
        const retryAt = Date.now() + delay
        await Promise.all([
          this.redis.hset(`${PREFIX}jobs`, job.id, JSON.stringify(job)),
          this.redis.zadd(RETRY_KEY, retryAt, job.id)
        ])
      } else {
        job.status = 'failed'
        job.error = error.message
        await this.redis.hset(`${PREFIX}jobs`, job.id, JSON.stringify(job))
      }
    } finally {
      this._processing.delete(job.id)
    }
  }

  async getStats() {
    const [pending, failed, processing] = await Promise.all([
      this.redis.zcard(PENDING_KEY),
      this.redis.hget(`${PREFIX}jobs`, 'stats').then(r => r ? JSON.parse(r).failed || 0 : 0).catch(() => 0),
      this._processing.size
    ])
    return { pending, failed, processing, byType: [] }
  }

  async list(limit = 50) {
    const raw = await this.redis.hvals(`${PREFIX}jobs`)
    return raw.slice(0, limit).map(r => JSON.parse(r))
  }

  async cleanup() {
    // Redis TTL handles cleanup
  }
}
