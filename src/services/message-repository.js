/**
 * Developed by Mohammad Rameez Imdad (Rameez Scripts)
 * WhatsApp: https://wa.me/923224083545 (For Custom Projects)
 * YouTube: https://www.youtube.com/@rameezimdad (Subscribe for more!)
 */

import { randomUUID } from 'node:crypto'
import { BufferJSON } from 'baileys'

export class MessageRepository {
  constructor(db) {
    this.insert = db.prepare(`
      INSERT INTO messages
        (id, recipient, type, payload_json, status, api_key_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
    `)
    this.sent = db.prepare(`
      UPDATE messages SET wa_message_id = ?, message_json = ?, status = 'sent', updated_at = ?
      WHERE id = ?
    `)
    this.failed = db.prepare(`
      UPDATE messages SET status = 'failed', error = ?, updated_at = ? WHERE id = ?
    `)
    this.delivery = db.prepare(`
      UPDATE messages SET status = ?, updated_at = ?
      WHERE wa_message_id = ? AND status != 'failed'
    `)
    this.findMessage = db.prepare('SELECT message_json FROM messages WHERE wa_message_id = ?')
  }

  create({ recipient, type, payload, apiKeyId }) {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.insert.run(id, recipient, type, JSON.stringify(payload), apiKeyId === 'bootstrap' ? null : apiKeyId, now, now)
    return { id, status: 'queued', createdAt: now }
  }

  markSent(id, waMessage) {
    const now = new Date().toISOString()
    this.sent.run(
      waMessage.key.id,
      JSON.stringify(waMessage, BufferJSON.replacer),
      now,
      id
    )
    return { id, waMessageId: waMessage.key.id, status: 'sent', sentAt: now }
  }

  markFailed(id, error) {
    this.failed.run(String(error).slice(0, 1000), new Date().toISOString(), id)
  }

  updateDelivery(waMessageId, status) {
    return this.delivery.run(status, new Date().toISOString(), waMessageId).changes > 0
  }

  getContent(waMessageId) {
    const row = this.findMessage.get(waMessageId)
    if (!row?.message_json) return undefined
    return JSON.parse(row.message_json, BufferJSON.reviver)?.message
  }
}
