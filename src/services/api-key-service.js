/**
 * Developed by Mohammad Rameez Imdad (Rameez Scripts)
 * WhatsApp: https://wa.me/923224083545 (For Custom Projects)
 * YouTube: https://www.youtube.com/@rameezimdad (Subscribe for more!)
 */

import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { AppError } from '../utils/errors.js'

const ROTATION_INTERVAL_MS = 90 * 86400000 // 90 days

const ALL_SCOPES = ['messages:send', 'messages:read', 'webhooks:manage', 'webhooks:read', 'contacts:manage', 'contacts:read', 'schedule:manage', 'schedule:read', 'abtests:manage', 'abtests:read', 'billing:read', 'billing:manage', 'team:read', 'team:manage', 'reports:read', 'admin:manage']

const PREFIX_RE = /^wapi_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/

const safeEqual = (left, right) => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export class ApiKeyService {
  constructor(db, pepper, bootstrapKey, logs) {
    this.db = db
    this.pepper = pepper
    this.bootstrapKey = bootstrapKey
    this.logs = logs
    this.findByPrefix = db.prepare(`
      SELECT id, name, key_prefix, key_hash, salt, role, created_at, last_used_at, expires_at, revoked_at, scopes
      FROM api_keys WHERE key_prefix = ?
    `)
    this.insert = db.prepare(`
      INSERT INTO api_keys (id, name, key_prefix, key_hash, salt, role, created_at, expires_at, scopes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.touch = db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?')
    this.revokeStmt = db.prepare(`
      UPDATE api_keys SET revoked_at = ?
      WHERE (id = ? OR key_prefix = ?) AND revoked_at IS NULL
    `)
    this.listStmt = db.prepare(`
      SELECT id, name, key_prefix AS prefix, role, created_at, last_used_at, expires_at, revoked_at, scopes
      FROM api_keys ORDER BY created_at DESC
    `)
    this.rotateStmt = db.prepare(`
      UPDATE api_keys SET key_hash = ?, salt = ?, expires_at = ? WHERE id = ?
    `)
    this.extendStmt = db.prepare(`
      UPDATE api_keys SET expires_at = ? WHERE id = ?
    `)
  }

  hash(secret, salt) {
    return createHmac('sha256', this.pepper).update(`${salt}:${secret}`).digest('hex')
  }

  create({ name, role, expiresAt = null, scopes = null }) {
    const id = randomUUID()
    const prefix = randomBytes(8).toString('hex')
    const secret = randomBytes(32).toString('base64url')
    const salt = randomBytes(16).toString('hex')
    const key = `wapi_${prefix}_${secret}`
    const createdAt = new Date().toISOString()
    const expiry = expiresAt ? new Date(expiresAt).toISOString() : null
    const keyScopes = scopes || (role === 'admin' ? ALL_SCOPES : ['messages:send'])

    this.insert.run(id, name, prefix, this.hash(secret, salt), salt, role, createdAt, expiry, JSON.stringify(keyScopes))
    this.logs.write('info', 'auth', 'api key generated', { id, name, role, prefix, scopes: keyScopes, expiresAt: expiry })
    return { id, name, role, prefix, scopes: keyScopes, apiKey: key, createdAt, expiresAt: expiry }
  }

  authenticate(key) {
    if (!key) throw new AppError(401, 'AUTH_REQUIRED', 'A valid API key is required')
    if (safeEqual(key, this.bootstrapKey)) {
      return { id: 'bootstrap', name: 'Environment bootstrap key', role: 'admin', prefix: 'bootstrap', scopes: ALL_SCOPES }
    }

    const match = PREFIX_RE.exec(key)
    if (!match) throw new AppError(401, 'AUTH_INVALID', 'Invalid API key')

    const [, prefix, secret] = match
    const row = this.findByPrefix.get(prefix)
    if (!row || row.revoked_at || (row.expires_at && Date.parse(row.expires_at) <= Date.now())) {
      throw new AppError(401, 'AUTH_INVALID', 'Invalid API key')
    }

    const hash = this.hash(secret, row.salt)
    if (!safeEqual(hash, row.key_hash)) throw new AppError(401, 'AUTH_INVALID', 'Invalid API key')

    this.checkRotation(row)

    this.touch.run(new Date().toISOString(), row.id)
    return {
      id: row.id,
      name: row.name,
      role: row.role,
      prefix: row.key_prefix,
      scopes: row.scopes ? JSON.parse(row.scopes) : (row.role === 'admin' ? ALL_SCOPES : ['messages:send']),
      expiresAt: row.expires_at
    }
  }

  checkRotation(row) {
    if (!row.created_at) return
    const age = Date.now() - Date.parse(row.created_at)
    if (age > ROTATION_INTERVAL_MS) {
      this.logs.write('warn', 'auth', 'api key nearing rotation', { id: row.id, ageDays: Math.round(age / 86400000) })
    }
  }

  rotate(id) {
    const row = this.db.prepare('SELECT * FROM api_keys WHERE id = ? AND revoked_at IS NULL').get(id)
    if (!row) throw new AppError(404, 'KEY_NOT_FOUND', 'Active API key not found')

    const newSecret = randomBytes(32).toString('base64url')
    const newSalt = randomBytes(16).toString('hex')
    const newExpiry = new Date(Date.now() + ROTATION_INTERVAL_MS).toISOString()
    const newHash = this.hash(newSecret, newSalt)

    this.rotateStmt.run(newHash, newSalt, newExpiry, id)
    const newKey = `wapi_${row.key_prefix}_${newSecret}`
    this.logs.write('info', 'auth', 'api key rotated', { id })
    return { id, key: newKey, expiresAt: newExpiry }
  }

  extendExpiry(id, days = 90) {
    const row = this.db.prepare('SELECT * FROM api_keys WHERE id = ? AND revoked_at IS NULL').get(id)
    if (!row) throw new AppError(404, 'KEY_NOT_FOUND', 'Active API key not found')

    const newExpiry = new Date(Date.now() + days * 86400000).toISOString()
    this.extendStmt.run(newExpiry, id)
    this.logs.write('info', 'auth', 'api key expiry extended', { id, days })
    return { id, expiresAt: newExpiry }
  }

  hasScope(apiKey, scope) {
    if (apiKey.role === 'admin') return true
    return Array.isArray(apiKey.scopes) && apiKey.scopes.includes(scope)
  }

  revoke(idOrPrefix) {
    if (idOrPrefix === 'bootstrap') {
      throw new AppError(400, 'BOOTSTRAP_KEY_ENV', 'Rotate ADMIN_API_KEY in the environment to revoke it')
    }

    const result = this.revokeStmt.run(new Date().toISOString(), idOrPrefix, idOrPrefix)
    if (!result.changes) throw new AppError(404, 'KEY_NOT_FOUND', 'Active API key not found')
    this.logs.write('info', 'auth', 'api key revoked', { idOrPrefix })
    return { revoked: true, idOrPrefix }
  }

  list() {
    return this.listStmt.all()
  }
}
