export class ReportingService {
  constructor(db) {
    this.db = db
  }

  getMessageStats(teamId, days = 30) {
    const since = new Date(Date.now() - days * 86400000).toISOString()
    return this.db.prepare(`
      SELECT m.status, COUNT(*) AS n FROM messages m
      JOIN api_keys ak ON ak.id = m.api_key_id
      WHERE ak.team_id = ? AND m.created_at >= ?
      GROUP BY m.status
    `).all(teamId, since)
  }

  getDailyVolume(teamId, days = 30) {
    const since = new Date(Date.now() - days * 86400000).toISOString()
    return this.db.prepare(`
      SELECT DATE(m.created_at) AS date, COUNT(*) AS count FROM messages m
      JOIN api_keys ak ON ak.id = m.api_key_id
      WHERE ak.team_id = ? AND m.created_at >= ?
      GROUP BY DATE(m.created_at) ORDER BY date ASC
    `).all(teamId, since)
  }

  getUsageSummary(teamId) {
    const messageCount = this.db.prepare('SELECT COUNT(*) AS n FROM messages m JOIN api_keys ak ON ak.id = m.api_key_id WHERE ak.team_id = ?').get(teamId)
    const scheduledCount = this.db.prepare("SELECT COUNT(*) AS n FROM scheduled_messages WHERE team_id = ? AND status = 'pending'").get(teamId)
    const webhookCount = this.db.prepare('SELECT COUNT(*) AS n FROM webhooks WHERE team_id = ? AND enabled = 1').get(teamId)
    const contactCount = this.db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE team_id = ?').get(teamId)
    const groupCount = this.db.prepare('SELECT COUNT(*) AS n FROM contact_groups WHERE team_id = ?').get(teamId)
    const abTestCount = this.db.prepare("SELECT COUNT(*) AS n FROM ab_tests WHERE team_id = ? AND status = 'running'").get(teamId)
    const recentActivity = this.db.prepare(`
      SELECT m.created_at, 'message' AS type FROM messages m
      JOIN api_keys ak ON ak.id = m.api_key_id
      WHERE ak.team_id = ? ORDER BY m.created_at DESC LIMIT 1
    `).get(teamId)

    return {
      totalMessages: messageCount?.n || 0,
      pendingScheduled: scheduledCount?.n || 0,
      activeWebhooks: webhookCount?.n || 0,
      totalContacts: contactCount?.n || 0,
      contactGroups: groupCount?.n || 0,
      runningABTests: abTestCount?.n || 0,
      lastActivity: recentActivity?.created_at || null
    }
  }

  getAuditSummary(teamId, days = 30) {
    const since = new Date(Date.now() - days * 86400000).toISOString()
    return this.db.prepare(`
      SELECT action, COUNT(*) AS n FROM audit_logs
      WHERE team_id = ? AND created_at >= ?
      GROUP BY action ORDER BY n DESC
    `).all(teamId, since)
  }
}
