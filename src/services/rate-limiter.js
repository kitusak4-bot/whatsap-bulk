export class RateLimiter {
  constructor(db) {
    this.db = db
    this.stmtGetLimit = db.prepare('SELECT value FROM team_config WHERE team_id = ? AND key = ?')
    this.stmtSetLimit = db.prepare('INSERT OR REPLACE INTO team_config (team_id, key, value, updated_at) VALUES (?, ?, ?, ?)')
    this.stmtGetCurrent = db.prepare('SELECT * FROM rate_limit_windows WHERE team_id = ? AND window_key = ?')
    this.stmtUpsertWindow = db.prepare(`
      INSERT INTO rate_limit_windows (team_id, window_key, count, expires_at, created_at)
      VALUES (?, ?, 1, ?, ?)
      ON CONFLICT(team_id, window_key) DO UPDATE SET count = count + 1
    `)
    this.stmtDeleteExpired = db.prepare('DELETE FROM rate_limit_windows WHERE expires_at < ?')
  }

  getLimit(teamId, tier = 'default') {
    const row = this.stmtGetLimit.get(teamId, `rate_limit_${tier}`)
    if (row) return JSON.parse(row.value)
    return { maxRequests: 60, windowMs: 60000 }
  }

  setLimit(teamId, tier, maxRequests, windowMs) {
    const now = new Date().toISOString()
    this.stmtSetLimit.run(teamId, `rate_limit_${tier}`, JSON.stringify({ maxRequests, windowMs }), now)
  }

  async check(teamId, tier = 'default') {
    this._cleanup()
    const limit = this.getLimit(teamId, tier)
    const windowKey = `${tier}_${this._windowKey(limit.windowMs)}`

    const existing = this.stmtGetCurrent.get(teamId, windowKey)
    const count = existing ? existing.count : 0

    if (count >= limit.maxRequests) {
      const retryAfter = existing ? Math.ceil((new Date(existing.expires_at).getTime() - Date.now()) / 1000) : limit.windowMs / 1000
      return { allowed: false, remaining: 0, retryAfter: Math.max(1, retryAfter), limit: limit.maxRequests }
    }

    if (!existing) {
      const now = new Date().toISOString()
      const expiresAt = new Date(Date.now() + limit.windowMs).toISOString()
      this.stmtUpsertWindow.run(teamId, windowKey, expiresAt, now)
    }

    const remaining = limit.maxRequests - count - 1
    return { allowed: true, remaining, limit: limit.maxRequests, retryAfter: 0 }
  }

  _windowKey(windowMs) {
    return String(Math.floor(Date.now() / windowMs))
  }

  _cleanup() {
    try { this.stmtDeleteExpired.run(new Date().toISOString()) } catch {}
  }
}
