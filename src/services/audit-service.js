import { randomUUID } from 'node:crypto'

export class AuditService {
  constructor(db) {
    this.db = db
    this.stmtInsert = db.prepare(`
      INSERT INTO audit_logs (id, team_id, user_id, api_key_id, action, resource, resource_id, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.stmtListByTeam = db.prepare(`
      SELECT al.*, u.name AS user_name, u.email AS user_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.team_id = ?
      ORDER BY al.created_at DESC LIMIT ?
    `)
    this.stmtListByUser = db.prepare(`
      SELECT al.*, u.name AS user_name, u.email AS user_email
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      WHERE al.user_id = ?
      ORDER BY al.created_at DESC LIMIT ?
    `)
    this.stmtCount = db.prepare('SELECT COUNT(*) AS n FROM audit_logs WHERE team_id = ?')
  }

  write({ teamId, userId, apiKeyId, action, resource, resourceId, details = {} }) {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.stmtInsert.run(id, teamId || null, userId || null, apiKeyId || null, action, resource, resourceId || null, JSON.stringify(details), now)
    return { id, createdAt: now }
  }

  listByTeam(teamId, limit = 100) {
    return this.stmtListByTeam.all(teamId, Math.min(limit, 500))
  }

  listByUser(userId, limit = 100) {
    return this.stmtListByUser.all(userId, Math.min(limit, 500))
  }

  count(teamId) {
    return this.stmtCount.get(teamId)?.n || 0
  }
}
