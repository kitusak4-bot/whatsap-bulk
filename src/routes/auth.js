import { Router } from 'express'
import { z } from 'zod'
import { validate } from '../middleware/validate.js'
import { asyncHandler } from '../utils/errors.js'
import { ok } from '../utils/response.js'

const registerSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(100),
  teamName: z.string().trim().min(1).max(100).optional()
})

const loginSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(128)
})

export const createPublicAuthRouter = ({ users, teams, apiKeys, audit }) => {
  const router = Router()

  router.get('/config', (req, res) => {
    ok(res, { allowRegistration: true })
  })

  router.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
    const { email, password, name, teamName } = req.body

    const user = users.create({ email, name, password })

    const team = teams.create({
      name: teamName || `${name}'s Team`,
      ownerId: user.id
    })

    const apiKey = apiKeys.create({
      name: `${name} — default key`,
      role: 'admin'
    })

    apiKeys.db.prepare('UPDATE api_keys SET user_id = ?, team_id = ? WHERE id = ?').run(user.id, team.id, apiKey.id)

    audit.write({
      teamId: team.id,
      userId: user.id,
      action: 'team.created',
      resource: 'team',
      resourceId: team.id,
      details: { email, teamName: team.name }
    })

    audit.write({
      teamId: team.id,
      userId: user.id,
      action: 'apikey.created',
      resource: 'api_key',
      resourceId: apiKey.id,
      details: { keyPrefix: apiKey.prefix }
    })

    ok(res, {
      user: { id: user.id, email: user.email, name: user.name },
      team: { id: team.id, name: team.name },
      apiKey: apiKey.apiKey,
      apiKeyId: apiKey.id
    }, 201)
  }))

  router.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
    const { email, password } = req.body
    const user = users.authenticate(email, password)

    const userTeams = teams.listUserTeams(user.id)
    const keys = userTeams.map(t => {
      const teamKeys = teams.apiKeysForTeam(t.id, user.id)
      return {
        team: { id: t.id, name: t.name, role: t.role },
        keys: teamKeys.map(k => ({ id: k.id, name: k.name, role: k.role }))
      }
    })

    ok(res, { user, teams: keys })
  }))

  return router
}

export const createProtectedAuthRouter = ({ users, teams }) => {
  const router = Router()

  router.get('/me', asyncHandler(async (req, res) => {
    if (!req.apiKey) {
      return ok(res, { authenticated: false, method: 'api_key' })
    }
    ok(res, {
      authenticated: true,
      method: 'api_key',
      key: {
        id: req.apiKey.id,
        name: req.apiKey.name,
        role: req.apiKey.role,
        prefix: req.apiKey.prefix
      },
      user: req.apiKey.userId ? users.get(req.apiKey.userId) : null,
      team: req.apiKey.teamId ? teams.get(req.apiKey.teamId) : null
    })
  }))

  return router
}
