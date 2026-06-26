import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin } from '../middleware/auth.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler } from '../utils/errors.js'
import { ok } from '../utils/response.js'

const teamActionSchema = z.object({
  teamId: z.string().trim().min(1),
  reason: z.string().trim().max(500).optional().default('')
})

export const createSuperAdminRouter = ({ superAdmin, audit }) => {
  const router = Router()
  router.use(requireAdmin)
  
  // Platform overview
  router.get('/stats', asyncHandler(async (req, res) => {
    const stats = superAdmin.getPlatformStats()
    const recentActivity = superAdmin.getRecentActivity(20)
    ok(res, { stats, recentActivity })
  }))
  
  // List all users
  router.get('/users', asyncHandler(async (req, res) => {
    const users = superAdmin.listUsers()
    ok(res, { users, total: users.length })
  }))
  
  // List all teams
  router.get('/teams', asyncHandler(async (req, res) => {
    const teams = superAdmin.listTeams()
    ok(res, { teams, total: teams.length })
  }))
  
  // Get team details
  router.get('/teams/:teamId', asyncHandler(async (req, res) => {
    const team = superAdmin.getTeamDetails(req.params.teamId)
    if (!team) {
      return ok(res, { error: 'Team not found' }, 404)
    }
    ok(res, { team })
  }))
  
  // Suspend team
  router.post('/teams/suspend', validate(teamActionSchema), asyncHandler(async (req, res) => {
    const { teamId, reason } = req.body
    const result = superAdmin.suspendTeam(teamId, reason)
    
    audit.write({
      teamId,
      userId: req.apiKey.userId,
      action: 'superadmin.team_suspended',
      resource: 'team',
      resourceId: teamId,
      details: { reason, by: req.apiKey.name }
    })
    
    ok(res, result)
  }))
  
  // Activate team
  router.post('/teams/activate', validate(teamActionSchema.omit({ reason: true })), asyncHandler(async (req, res) => {
    const { teamId } = req.body
    const result = superAdmin.activateTeam(teamId)
    
    audit.write({
      teamId,
      userId: req.apiKey.userId,
      action: 'superadmin.team_activated',
      resource: 'team',
      resourceId: teamId,
      details: { by: req.apiKey.name }
    })
    
    ok(res, result)
  }))
  
  // Recent platform activity
  router.get('/activity', asyncHandler(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200)
    const activity = superAdmin.getRecentActivity(limit)
    ok(res, { activity, total: activity.length })
  }))
  
  return router
}
