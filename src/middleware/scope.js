import { AppError } from '../utils/errors.js'

export const requireScope = (...scopes) => {
  return (req, res, next) => {
    if (!req.apiKey) throw new AppError(401, 'AUTH_REQUIRED', 'Authentication required')
    if (req.apiKey.role === 'admin') return next()
    const hasScope = scopes.some(s => req.apiKey.scopes?.includes(s))
    if (!hasScope) throw new AppError(403, 'SCOPE_DENIED', `Required scope: ${scopes.join(' or ')}`)
    next()
  }
}
