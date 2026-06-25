import { AppError } from '../utils/errors.js'

export const enrichApiKey = (apiKeys) => (req, res, next) => {
  if (!req.apiKey) return next()
  const keyId = req.apiKey.id
  if (keyId === 'bootstrap') return next()

  try {
    const row = apiKeys.db.prepare('SELECT id, user_id, team_id FROM api_keys WHERE key_prefix = ?').get(req.apiKey.prefix)
    if (row) {
      req.apiKey.userId = row.user_id || null
      req.apiKey.teamId = row.team_id || null
    }
  } catch {
    // non-critical enrichment; proceed without
  }
  next()
}

export const requireTeamMember = (req, res, next) => {
  if (!req.apiKey?.teamId) {
    return next(new AppError(403, 'TEAM_REQUIRED', 'This operation requires a team API key'))
  }
  if (!req.apiKey?.userId) {
    return next(new AppError(403, 'USER_REQUIRED', 'This operation requires a user-linked API key'))
  }
  next()
}

export const requireTeamRole = (...roles) => {
  return (req, res, next) => {
    if (!req.teamRole) {
      return next(new AppError(403, 'TEAM_ROLE_REQUIRED', 'Team role not resolved'))
    }
    if (!roles.includes(req.teamRole)) {
      return next(new AppError(403, 'ROLE_INSUFFICIENT', `Requires one of: ${roles.join(', ')}`))
    }
    next()
  }
}

export const resolveTeamRole = teamService => async (req, res, next) => {
  if (!req.apiKey?.teamId || !req.apiKey?.userId) return next()
  try {
    const member = teamService.getMember(req.apiKey.teamId, req.apiKey.userId)
    req.teamRole = member?.role || null
  } catch {
    req.teamRole = null
  }
  next()
}
