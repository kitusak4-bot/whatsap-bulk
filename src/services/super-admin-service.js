import { AppError } from '../utils/errors.js'

export class SuperAdminService {
  constructor(db) {
    this.db = db
    
    // List all users
    this.stmtListUsers = db.prepare(`
      SELECT u.id, u.email, u.name, u.created_at, u.last_login_at,
             COUNT(DISTINCT t.id) AS team_count
      FROM users u
      LEFT JOIN team_members tm ON tm.user_id = u.id
      LEFT JOIN teams t ON t.id = tm.team_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `)
    
    // List all teams
    this.stmtListTeams = db.prepare(`
      SELECT t.id, t.name, t.owner_id, t.created_at,
             u.name AS owner_name, u.email AS owner_email,
             COUNT(DISTINCT tm.user_id) AS member_count,
             COUNT(DISTINCT ak.id) AS api_key_count
      FROM teams t
      JOIN users u ON u.id = t.owner_id
      LEFT JOIN team_members tm ON tm.team_id = t.id
      LEFT JOIN api_keys ak ON ak.team_id = t.id AND ak.revoked_at IS NULL
      GROUP BY t.id
      ORDER BY t.created_at DESC
    `)
    
    // Get team details with members
    this.stmtGetTeam = db.prepare(`
      SELECT t.id, t.name, t.owner_id, t.created_at,
             u.name AS owner_name, u.email AS owner_email
      FROM teams t
      JOIN users u ON u.id = t.owner_id
      WHERE t.id = ?
    `)
    
    this.stmtGetTeamMembers = db.prepare(`
      SELECT tm.team_id, tm.user_id, tm.role, tm.joined_at,
             u.name, u.email, u.last_login_at
      FROM team_members tm
      JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ?
      ORDER BY tm.joined_at ASC
    `)
    
    // Get team API keys
    this.stmtGetTeamKeys = db.prepare(`
      SELECT id, name, key_prefix, role, created_at, last_used_at, expires_at, revoked_at
      FROM api_keys
      WHERE team_id = ?
      ORDER BY created_at DESC
    `)
    
    // Get team usage
    this.stmtGetTeamUsage = db.prepare(`
      SELECT COALESCE(SUM(messages_sent), 0) AS total_messages
      FROM usage_records
      WHERE team_id = ?
    `)
    
    // Get team subscription
    this.stmtGetTeamSubscription = db.prepare(`
      SELECT s.id, s.plan_id, s.status, s.current_period_start, s.current_period_end,
             p.name AS plan_name, p.monthly_limit
      FROM subscriptions s
      LEFT JOIN plans p ON p.id = s.plan_id
      WHERE s.team_id = ?
    `)
    
    // Platform statistics
    this.stmtPlatformStats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM teams) AS total_teams,
        (SELECT COUNT(*) FROM api_keys WHERE revoked_at IS NULL) AS active_api_keys,
        (SELECT COUNT(*) FROM messages) AS total_messages,
        (SELECT COUNT(*) FROM messages WHERE status = 'sent') AS messages_sent,
        (SELECT COUNT(*) FROM messages WHERE status = 'failed') AS messages_failed,
        (SELECT COUNT(*) FROM messages WHERE created_at >= date('now', 'start of month')) AS messages_this_month
    `)
    
    // Get recent activity
    this.stmtRecentActivity = db.prepare(`
      SELECT al.id, al.team_id, al.user_id, al.action, al.resource, al.details_json, al.created_at,
             u.name AS user_name, u.email AS user_email,
             t.name AS team_name
      FROM audit_logs al
      LEFT JOIN users u ON u.id = al.user_id
      LEFT JOIN teams t ON t.id = al.team_id
      ORDER BY al.created_at DESC
      LIMIT ?
    `)
    
    // Suspend/activate team (via config flag)
    this.stmtSetTeamConfig = db.prepare(`
      INSERT OR REPLACE INTO team_config (team_id, key, value, updated_at)
      VALUES (?, ?, ?, ?)
    `)
    
    this.stmtGetTeamConfig = db.prepare(`
      SELECT key, value FROM team_config WHERE team_id = ? AND key = ?
    `)
  }
  
  listUsers() {
    return this.stmtListUsers.all()
  }
  
  listTeams() {
    return this.stmtListTeams.all()
  }
  
  getTeamDetails(teamId) {
    const team = this.stmtGetTeam.get(teamId)
    if (!team) return null
    
    const members = this.stmtGetTeamMembers.all(teamId)
    const keys = this.stmtGetTeamKeys.all(teamId)
    const usage = this.stmtGetTeamUsage.get(teamId)
    const subscription = this.stmtGetTeamSubscription.get(teamId)
    
    return {
      ...team,
      members,
      apiKeys: keys,
      usage: usage?.total_messages || 0,
      subscription: subscription || null
    }
  }
  
  getPlatformStats() {
    return this.stmtPlatformStats.get()
  }
  
  getRecentActivity(limit = 50) {
    return this.stmtRecentActivity.all(Math.min(limit, 200))
  }
  
  suspendTeam(teamId, reason = '') {
    const now = new Date().toISOString()
    this.stmtSetTeamConfig.run(teamId, 'suspended', 'true', now)
    return { teamId, suspended: true, reason, suspendedAt: now }
  }
  
  activateTeam(teamId) {
    const now = new Date().toISOString()
    this.stmtSetTeamConfig.run(teamId, 'suspended', 'false', now)
    return { teamId, suspended: false, activatedAt: now }
  }
  
  isTeamSuspended(teamId) {
    const row = this.stmtGetTeamConfig.get(teamId, 'suspended')
    return row?.value === 'true'
  }
}
