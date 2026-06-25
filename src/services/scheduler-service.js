import { randomUUID } from 'node:crypto'

export class SchedulerService {
  constructor({ db, whatsapp, webhooks, logger }) {
    this.db = db
    this.whatsapp = whatsapp
    this.webhooks = webhooks
    this.logger = logger
    this._timer = null
    this._running = false

    this.stmtInsert = db.prepare(`
      INSERT INTO scheduled_messages (id, team_id, api_key_id, recipient, message_type, payload_json, scheduled_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `)
    this.stmtUpdate = db.prepare(`
      UPDATE scheduled_messages SET status=?, sent_at=?, error=? WHERE id=?
    `)
    this.stmtFind = db.prepare('SELECT * FROM scheduled_messages WHERE id=? AND team_id=?')
    this.stmtDelete = db.prepare('DELETE FROM scheduled_messages WHERE id=? AND team_id=?')
    this.stmtListByTeam = db.prepare('SELECT * FROM scheduled_messages WHERE team_id=? ORDER BY scheduled_at ASC')
    this.stmtPendingDue = db.prepare("SELECT * FROM scheduled_messages WHERE status='pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 50")
    this.stmtCancel = db.prepare("UPDATE scheduled_messages SET status='canceled' WHERE id=? AND team_id=?")
  }

  list(teamId) {
    return this.stmtListByTeam.all(teamId).map(this._format)
  }

  get(teamId, id) {
    const row = this.stmtFind.get(id, teamId)
    return row ? this._format(row) : null
  }

  create(teamId, apiKeyId, { recipient, messageType, payload, scheduledAt }) {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.stmtInsert.run(id, teamId, apiKeyId, recipient, messageType, JSON.stringify(payload), scheduledAt, now)
    return this.get(teamId, id)
  }

  cancel(teamId, id) {
    const existing = this.stmtFind.get(id, teamId)
    if (!existing) return false
    if (existing.status !== 'pending') return false
    this.stmtCancel.run(id, teamId)
    return true
  }

  remove(teamId, id) {
    const existing = this.stmtFind.get(id, teamId)
    if (!existing) return false
    this.stmtDelete.run(id, teamId)
    return true
  }

  startPolling(intervalMs = 5000) {
    if (this._timer) return
    this._timer = setInterval(() => this._processDue(), intervalMs)
    this._timer.unref()
    this.logger.info('Scheduler polling started')
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer)
      this._timer = null
    }
  }

  async _processDue() {
    if (this._running) return
    this._running = true
    try {
      const now = new Date().toISOString()
      const due = this.stmtPendingDue.all(now)
      for (const msg of due) {
        try {
          const payload = JSON.parse(msg.payload_json)
          const result = await this.whatsapp.send({
            to: msg.recipient,
            type: msg.message_type,
            content: payload,
            payload,
            apiKeyId: msg.api_key_id
          })
          this.stmtUpdate.run('sent', new Date().toISOString(), null, msg.id)
          this.webhooks.dispatch(msg.team_id, 'message.sent', {
            scheduledMessageId: msg.id,
            recipient: msg.recipient,
            type: msg.message_type,
            waMessageId: result.waMessageId
          }).catch(() => {})
        } catch (error) {
          this.stmtUpdate.run('failed', null, error.message?.slice(0, 500), msg.id)
          this.webhooks.dispatch(msg.team_id, 'message.failed', {
            scheduledMessageId: msg.id,
            recipient: msg.recipient,
            error: error.message
          }).catch(() => {})
        }
      }
    } catch (error) {
      this.logger.error({ err: error }, 'Scheduler processing error')
    } finally {
      this._running = false
    }
  }

  _format(row) {
    return {
      id: row.id,
      teamId: row.team_id,
      apiKeyId: row.api_key_id,
      recipient: row.recipient,
      messageType: row.message_type,
      payload: JSON.parse(row.payload_json || '{}'),
      scheduledAt: row.scheduled_at,
      status: row.status,
      sentAt: row.sent_at,
      error: row.error,
      createdAt: row.created_at
    }
  }
}
