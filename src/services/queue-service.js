import { randomUUID } from 'node:crypto'

export class QueueService {
  constructor({ db, logger }) {
    this.db = db
    this.logger = logger
    this._handlers = new Map()
    this._polling = false
    this._timer = null
    this._processing = new Set()

    this.stmtEnqueue = db.prepare(`
      INSERT INTO job_queue (id, type, payload, priority, status, attempts, max_attempts, scheduled_at, created_at)
      VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?)
    `)
    this.stmtDequeue = db.prepare(`
      SELECT * FROM job_queue
      WHERE status = 'pending' AND scheduled_at <= ? AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY priority ASC, created_at ASC LIMIT 1
    `)
    this.stmtClaim = db.prepare(`
      UPDATE job_queue SET status = 'running', started_at = ? WHERE id = ? AND status = 'pending'
    `)
    this.stmtComplete = db.prepare(`
      UPDATE job_queue SET status = 'completed', completed_at = ?, result = ? WHERE id = ?
    `)
    this.stmtFail = db.prepare(`
      UPDATE job_queue SET status = 'failed', error = ?, attempts = attempts + 1, next_retry_at = ? WHERE id = ?
    `)
    this.stmtRetry = db.prepare(`
      UPDATE job_queue SET status = 'pending', next_retry_at = ? WHERE id = ? AND status = 'failed'
    `)
    this.stmtPendingRetries = db.prepare(`
      SELECT * FROM job_queue WHERE status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= ? ORDER BY next_retry_at ASC LIMIT 50
    `)
    this.stmtPendingCount = db.prepare("SELECT COUNT(*) AS n FROM job_queue WHERE status = 'pending'")
    this.stmtFailedCount = db.prepare("SELECT COUNT(*) AS n FROM job_queue WHERE status = 'failed'")
    this.stmtStats = db.prepare(`
      SELECT type, status, COUNT(*) AS n FROM job_queue GROUP BY type, status
    `)
    this.stmtList = db.prepare(`
      SELECT * FROM job_queue ORDER BY created_at DESC LIMIT ?
    `)
    this.stmtGet = db.prepare('SELECT * FROM job_queue WHERE id = ?')
    this.stmtCleanup = db.prepare(`
      DELETE FROM job_queue WHERE status IN ('completed', 'failed') AND created_at < ?
    `)
  }

  add(type, payload, { priority = 0, maxAttempts = 3, scheduledAt } = {}) {
    const id = randomUUID()
    const now = new Date().toISOString()
    const schedule = scheduledAt || now
    this.stmtEnqueue.run(id, type, JSON.stringify(payload), priority, maxAttempts, schedule, now)
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
    this.logger.info({ intervalMs, concurrency }, 'Queue polling started')
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  }

  async _tick() {
    if (this._processing.size >= this._concurrency) return
    const slots = this._concurrency - this._processing.size
    for (let i = 0; i < slots; i++) {
      const job = this._dequeue()
      if (!job) break
      this._processJob(job)
    }
  }

  _dequeue() {
    const now = new Date().toISOString()
    const job = this.stmtDequeue.get(now, now)
    if (!job) return null
    this.stmtClaim.run(now, job.id)
    return job
  }

  async _processJob(job) {
    const handler = this._handlers.get(job.type)
    if (!handler) {
      this.stmtFail.run('No handler registered', null, job.id)
      return
    }
    this._processing.add(job.id)
    try {
      const payload = JSON.parse(job.payload)
      const result = await handler(payload, job)
      this.stmtComplete.run(new Date().toISOString(), JSON.stringify(result), job.id)
    } catch (error) {
      const maxAttempts = job.max_attempts || 3
      const attempts = job.attempts + 1
      if (attempts < maxAttempts) {
        const delay = Math.min(5000 * Math.pow(2, attempts), 3600000)
        const nextRetry = new Date(Date.now() + delay).toISOString()
        this.stmtFail.run(error.message?.slice(0, 1000), nextRetry, job.id)
      } else {
        this.stmtFail.run(error.message?.slice(0, 1000), null, job.id)
      }
    } finally {
      this._processing.delete(job.id)
    }
  }

  async retryFailed() {
    const now = new Date().toISOString()
    const failed = this.stmtPendingRetries.all(now)
    for (const job of failed) {
      this.stmtRetry.run(now, job.id)
    }
    return failed.length
  }

  getStats() {
    return {
      processing: this._processing.size,
      pending: this.stmtPendingCount.get().n,
      failed: this.stmtFailedCount.get().n,
      byType: this.stmtStats.all()
    }
  }

  list(limit = 50) {
    return this.stmtList.all(Math.min(limit, 200)).map(this._format)
  }

  get(id) {
    const row = this.stmtGet.get(id)
    return row ? this._format(row) : null
  }

  cleanup(retentionDays = 7) {
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString()
    const result = this.stmtCleanup.run(cutoff)
    return result.changes
  }

  _format(row) {
    return {
      id: row.id,
      type: row.type,
      payload: JSON.parse(row.payload || '{}'),
      priority: row.priority,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      error: row.error,
      result: row.result ? JSON.parse(row.result) : null,
      nextRetryAt: row.next_retry_at,
      scheduledAt: row.scheduled_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      createdAt: row.created_at
    }
  }
}
