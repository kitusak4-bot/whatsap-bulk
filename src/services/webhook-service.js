import { randomUUID, createHmac } from 'node:crypto'

export class WebhookService {
  constructor({ db, cfg, logger }) {
    this.db = db
    this.cfg = cfg
    this.logger = logger
    this.stmtInsert = db.prepare(`
      INSERT INTO webhooks (id, team_id, name, url, events, secret, enabled, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.stmtUpdate = db.prepare(`
      UPDATE webhooks SET name=?, url=?, events=?, secret=?, enabled=?, updated_at=? WHERE id=? AND team_id=?
    `)
    this.stmtDelete = db.prepare('DELETE FROM webhooks WHERE id=? AND team_id=?')
    this.stmtFind = db.prepare('SELECT * FROM webhooks WHERE id=? AND team_id=?')
    this.stmtListByTeam = db.prepare('SELECT * FROM webhooks WHERE team_id=? ORDER BY created_at DESC')
    this.stmtListForEvent = db.prepare('SELECT * FROM webhooks WHERE team_id=? AND enabled=1 AND events LIKE ?')
    this.stmtInsertDelivery = db.prepare(`
      INSERT INTO webhook_deliveries (id, webhook_id, team_id, event, payload, status, response_code, response_body, attempts, next_retry_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.stmtUpdateDelivery = db.prepare(`
      UPDATE webhook_deliveries SET status=?, response_code=?, response_body=?, attempts=?, next_retry_at=? WHERE id=?
    `)
    this.stmtListDeliveries = db.prepare('SELECT * FROM webhook_deliveries WHERE webhook_id=? ORDER BY created_at DESC LIMIT ?')
    this.stmtPendingRetries = db.prepare("SELECT * FROM webhook_deliveries WHERE status='pending' AND next_retry_at <= ? ORDER BY next_retry_at ASC LIMIT 50")
    this.signPayload = this.signPayload.bind(this)
  }

  signPayload(payload, secret) {
    return createHmac('sha256', secret).update(JSON.stringify(payload)).digest('hex')
  }

  list(teamId) {
    return this.stmtListByTeam.all(teamId).map(this._format)
  }

  get(teamId, id) {
    const row = this.stmtFind.get(id, teamId)
    return row ? this._format(row) : null
  }

  create(teamId, { name, url, events, secret }) {
    const id = randomUUID()
    const now = new Date().toISOString()
    const webhookSecret = secret || randomUUID()
    this.stmtInsert.run(id, teamId, name, url, JSON.stringify(events), webhookSecret, 1, now, now)
    return this.get(teamId, id)
  }

  update(teamId, id, { name, url, events, secret, enabled }) {
    const now = new Date().toISOString()
    const existing = this.stmtFind.get(id, teamId)
    if (!existing) return null
    this.stmtUpdate.run(
      name ?? existing.name,
      url ?? existing.url,
      events ? JSON.stringify(events) : existing.events,
      secret ?? existing.secret,
      enabled !== undefined ? (enabled ? 1 : 0) : existing.enabled,
      now, id, teamId
    )
    return this.get(teamId, id)
  }

  remove(teamId, id) {
    const existing = this.stmtFind.get(id, teamId)
    if (!existing) return false
    this.stmtDelete.run(id, teamId)
    return true
  }

  async dispatch(teamId, event, payload, { queue = null } = {}) {
    const webhooks = this.stmtListForEvent.all(teamId, `%"${event}"%`)
    if (!webhooks.length) return []

    const results = []
    for (const wh of webhooks) {
      const deliveryId = randomUUID()
      const now = new Date().toISOString()
      const body = JSON.stringify({ event, teamId, payload, sentAt: now })
      const signature = this.signPayload(body, wh.secret)
      const delivery = { id: deliveryId, webhookId: wh.id, teamId, event, status: 'pending', attempts: 0 }

      this.stmtInsertDelivery.run(deliveryId, wh.id, teamId, event, body, 'pending', null, null, 0, null, now)

      let success = false
      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        const response = await fetch(wh.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-webhook-signature': signature,
            'x-webhook-event': event,
            'x-webhook-delivery-id': deliveryId,
            'user-agent': 'BaileysAPI-Webhook/1.0'
          },
          body,
          signal: controller.signal
        })
        clearTimeout(timeout)
        const responseBody = await response.text().catch(() => '')
        success = response.ok
        this.stmtUpdateDelivery.run(
          success ? 'delivered' : 'failed',
          response.status,
          responseBody.slice(0, 1000),
          delivery.attempts + 1,
          null,
          deliveryId
        )
        delivery.status = success ? 'delivered' : 'failed'
        delivery.responseCode = response.status
      } catch (error) {
        delivery.status = 'pending'
        delivery.error = error.message
      }

      if (!success) {
        const nextDelay = Math.min(10000 * Math.pow(2, delivery.attempts), 86400000)
        const nextRetry = new Date(Date.now() + nextDelay).toISOString()
        this.stmtUpdateDelivery.run('pending', null, delivery.error?.slice(0, 1000) || null, delivery.attempts + 1, nextRetry, deliveryId)

        // Enqueue retry job if queue service available
        if (queue && typeof queue.add === 'function') {
          queue.add('webhook_retry', { deliveryId, webhookId: wh.id, teamId, event, body, secret: wh.secret }, {
            priority: 1,
            maxAttempts: 5,
            scheduledAt: nextRetry
          })
        }
      }
      results.push(delivery)
    }
    return results
  }

  async dispatchWithQueue(teamId, event, payload, queue) {
    return this.dispatch(teamId, event, payload, { queue })
  }

  getDeliveries(teamId, webhookId, limit = 25) {
    const wh = this.stmtFind.get(webhookId, teamId)
    if (!wh) return null
    return this.stmtListDeliveries.all(webhookId, limit).map(d => ({
      id: d.id,
      event: d.event,
      status: d.status,
      responseCode: d.response_code,
      responseBody: d.response_body,
      attempts: d.attempts,
      nextRetryAt: d.next_retry_at,
      createdAt: d.created_at
    }))
  }

  async retryPending({ queue = null } = {}) {
    const now = new Date().toISOString()
    const pending = this.stmtPendingRetries.all(now)
    let retried = 0
    for (const d of pending) {
      const wh = this.db.prepare('SELECT * FROM webhooks WHERE id=?').get(d.webhook_id)
      if (!wh || !wh.enabled) continue

      // Exponential backoff: each retry doubles up to 24h max
      const delayMs = Math.min(10000 * Math.pow(2, d.attempts), 86400000)
      const nextRetry = new Date(Date.now() + delayMs).toISOString()

      try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 10000)
        const response = await fetch(wh.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-webhook-signature': this.signPayload(d.payload, wh.secret),
            'x-webhook-event': d.event,
            'x-webhook-delivery-id': d.id,
            'user-agent': 'BaileysAPI-Webhook/1.0'
          },
          body: d.payload,
          signal: controller.signal
        })
        clearTimeout(timeout)
        const responseBody = await response.text().catch(() => '')
        if (response.ok) {
          this.stmtUpdateDelivery.run('delivered', response.status, responseBody.slice(0, 1000), d.attempts + 1, null, d.id)
        } else {
          const shouldRetry = d.attempts < 5
          this.stmtUpdateDelivery.run(shouldRetry ? 'pending' : 'failed', response.status, responseBody.slice(0, 1000), d.attempts + 1, shouldRetry ? nextRetry : null, d.id)
          if (shouldRetry && queue && typeof queue.add === 'function') {
            queue.add('webhook_retry', { deliveryId: d.id, webhookId: d.webhook_id, teamId: wh.team_id, event: d.event, body: d.payload, secret: wh.secret }, { priority: 1, maxAttempts: 5, scheduledAt: nextRetry })
          }
        }
      } catch (error) {
        const shouldRetry = d.attempts < 5
        this.stmtUpdateDelivery.run(shouldRetry ? 'pending' : 'failed', null, error.message?.slice(0, 1000), d.attempts + 1, shouldRetry ? nextRetry : null, d.id)
      }
      retried++
    }
    return retried
  }

  _format(row) {
    return {
      id: row.id,
      teamId: row.team_id,
      name: row.name,
      url: row.url,
      events: JSON.parse(row.events || '[]'),
      secret: row.secret,
      enabled: Boolean(row.enabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
