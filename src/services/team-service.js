import { randomUUID } from 'node:crypto'
import { AppError } from '../utils/errors.js'

const ROLES = ['owner', 'admin', 'member', 'viewer']

export class TeamService {
  constructor(db) {
    this.db = db
    this.stmtInsertTeam = db.prepare(`
      INSERT INTO teams (id, name, owner_id, created_at)
      VALUES (?, ?, ?, ?)
    `)
    this.stmtInsertMember = db.prepare(`
      INSERT INTO team_members (team_id, user_id, role, invited_by, joined_at)
      VALUES (?, ?, ?, ?, ?)
    `)
    this.stmtFindTeam = db.prepare('SELECT * FROM teams WHERE id = ?')
    this.stmtFindMember = db.prepare('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?')
    this.stmtListMembers = db.prepare(`
      SELECT tm.role, tm.joined_at, u.id AS user_id, u.email, u.name, u.created_at AS user_created_at
      FROM team_members tm JOIN users u ON u.id = tm.user_id
      WHERE tm.team_id = ? ORDER BY tm.joined_at ASC
    `)
    this.stmtListUserTeams = db.prepare(`
      SELECT t.id, t.name, t.owner_id, t.created_at, tm.role
      FROM teams t JOIN team_members tm ON tm.team_id = t.id
      WHERE tm.user_id = ? ORDER BY t.created_at DESC
    `)
    this.stmtUpdateRole = db.prepare('UPDATE team_members SET role = ? WHERE team_id = ? AND user_id = ?')
    this.stmtRemoveMember = db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ? AND role != ?')
    this.stmtCountAdmins = db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id = ? AND role IN ('owner', 'admin')")
    this.stmtApiKeysForTeam = db.prepare('SELECT id, name, role FROM api_keys WHERE team_id = ? AND user_id = ? AND revoked_at IS NULL')
  }

  create({ name, ownerId }) {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.stmtInsertTeam.run(id, name.trim(), ownerId, now)
    this.stmtInsertMember.run(id, ownerId, 'owner', null, now)
    return { id, name: name.trim(), ownerId, createdAt: now }
  }

  get(teamId) {
    return this.stmtFindTeam.get(teamId) || null
  }

  getMember(teamId, userId) {
    return this.stmtFindMember.get(teamId, userId) || null
  }

  listMembers(teamId) {
    return this.stmtListMembers.all(teamId)
  }

  listUserTeams(userId) {
    return this.stmtListUserTeams.all(userId)
  }

  apiKeysForTeam(teamId, userId) {
    return this.stmtApiKeysForTeam.all(teamId, userId)
  }

  invite({ teamId, inviterId, email, name, role = 'member' }) {
    const team = this.stmtFindTeam.get(teamId)
    if (!team) throw new AppError(404, 'TEAM_NOT_FOUND', 'Team not found')

    const inviter = this.stmtFindMember.get(teamId, inviterId)
    if (!inviter || (inviter.role !== 'owner' && inviter.role !== 'admin')) {
      throw new AppError(403, 'ROLE_REQUIRED', 'Only owners and admins can invite members')
    }

    if (!ROLES.includes(role)) throw new AppError(400, 'INVALID_ROLE', 'Role must be owner, admin, member, or viewer')

    const user = this.db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim())
    if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'No user found with this email. They must register first.')

    const existing = this.stmtFindMember.get(teamId, user.id)
    if (existing) throw new AppError(409, 'ALREADY_MEMBER', 'This user is already a team member')

    const now = new Date().toISOString()
    this.stmtInsertMember.run(teamId, user.id, role, inviterId, now)
    return { teamId, userId: user.id, role, joinedAt: now }
  }

  changeRole({ teamId, actorId, targetUserId, newRole }) {
    if (!ROLES.includes(newRole)) throw new AppError(400, 'INVALID_ROLE', 'Role must be owner, admin, member, or viewer')

    const actor = this.stmtFindMember.get(teamId, actorId)
    if (!actor || (actor.role !== 'owner' && actor.role !== 'admin')) {
      throw new AppError(403, 'ROLE_REQUIRED', 'Only owners and admins can change roles')
    }

    const target = this.stmtFindMember.get(teamId, targetUserId)
    if (!target) throw new AppError(404, 'NOT_MEMBER', 'User is not a team member')

    if (target.role === 'owner') throw new AppError(403, 'CANNOT_MODIFY_OWNER', 'Cannot change the owner\'s role')
    if (actor.role === 'admin' && newRole === 'owner') throw new AppError(403, 'OWNER_ONLY', 'Only the owner can assign owner role')

    this.stmtUpdateRole.run(newRole, teamId, targetUserId)
    return { teamId, userId: targetUserId, oldRole: target.role, newRole }
  }

  removeMember({ teamId, actorId, targetUserId }) {
    const actor = this.stmtFindMember.get(teamId, actorId)
    if (!actor || (actor.role !== 'owner' && actor.role !== 'admin')) {
      throw new AppError(403, 'ROLE_REQUIRED', 'Only owners and admins can remove members')
    }

    const target = this.stmtFindMember.get(teamId, targetUserId)
    if (!target) throw new AppError(404, 'NOT_MEMBER', 'User is not a team member')
    if (target.role === 'owner') throw new AppError(403, 'CANNOT_REMOVE_OWNER', 'Cannot remove the team owner')

    if (actor.role === 'admin' && target.role === 'admin') {
      const count = this.stmtCountAdmins.get(teamId).n
      if (count <= 2) throw new AppError(403, 'LAST_ADMIN', 'Cannot remove the last admin. Promote another member first.')
    }

    this.stmtRemoveMember.run(teamId, targetUserId, 'owner')
    return { teamId, userId: targetUserId, removed: true }
  }
}
