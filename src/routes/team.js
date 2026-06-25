import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { enrichApiKey, requireTeamMember, resolveTeamRole, requireTeamRole } from '../middleware/tenant.js'
import { asyncHandler } from '../utils/errors.js'
import { ok } from '../utils/response.js'

const inviteSchema = z.object({
  email: z.string().email().max(200),
  role: z.enum(['admin', 'member', 'viewer']).default('member')
})

const roleSchema = z.object({
  userId: z.string().trim().min(1),
  role: z.enum(['admin', 'member', 'viewer'])
})

const removeSchema = z.object({
  userId: z.string().trim().min(1)
})

export const createTeamRouter = ({ teams, apiKeys, audit }) => {
  const router = Router()
  router.use(requireTeamMember)

  router.get('/', asyncHandler(async (req, res) => {
    const team = teams.get(req.apiKey.teamId)
    if (!team) return ok(res, { team: null })
    const members = teams.listMembers(req.apiKey.teamId)
    ok(res, { team, members })
  }))

  router.get('/members', asyncHandler(async (req, res) => {
    const members = teams.listMembers(req.apiKey.teamId)
    ok(res, { members })
  }))

  router.post('/invite', validate(inviteSchema), asyncHandler(async (req, res) => {
    const member = teams.getMember(req.apiKey.teamId, req.apiKey.userId)
    if (!member || (member.role !== 'owner' && member.role !== 'admin')) {
      return ok(res, { error: 'Only owners and admins can invite members' }, 403)
    }

    const result = teams.invite({
      teamId: req.apiKey.teamId,
      inviterId: req.apiKey.userId,
      email: req.body.email,
      role: req.body.role
    })

    audit.write({
      teamId: req.apiKey.teamId,
      userId: req.apiKey.userId,
      action: 'member.invited',
      resource: 'team_member',
      resourceId: result.userId,
      details: { email: req.body.email, role: req.body.role }
    })

    ok(res, result, 201)
  }))

  router.post('/role', validate(roleSchema), asyncHandler(async (req, res) => {
    const result = teams.changeRole({
      teamId: req.apiKey.teamId,
      actorId: req.apiKey.userId,
      targetUserId: req.body.userId,
      newRole: req.body.role
    })

    audit.write({
      teamId: req.apiKey.teamId,
      userId: req.apiKey.userId,
      action: 'member.role_changed',
      resource: 'team_member',
      resourceId: req.body.userId,
      details: { oldRole: result.oldRole, newRole: result.newRole }
    })

    ok(res, result)
  }))

  router.post('/remove', validate(removeSchema), asyncHandler(async (req, res) => {
    const result = teams.removeMember({
      teamId: req.apiKey.teamId,
      actorId: req.apiKey.userId,
      targetUserId: req.body.userId
    })

    audit.write({
      teamId: req.apiKey.teamId,
      userId: req.apiKey.userId,
      action: 'member.removed',
      resource: 'team_member',
      resourceId: req.body.userId,
      details: {}
    })

    ok(res, result)
  }))

  router.get('/keys', asyncHandler(async (req, res) => {
    const keys = apiKeys.list().filter(k => k.team_id === req.apiKey.teamId)
    ok(res, { keys })
  }))

  router.get('/audit', asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500)
    const entries = audit.listByTeam(req.apiKey.teamId, limit)
    const total = audit.count(req.apiKey.teamId)
    ok(res, { entries, total })
  }))

  return router
}
