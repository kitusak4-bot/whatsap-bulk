import { randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import { AppError } from '../utils/errors.js'

const safeEqual = (left, right) => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export class UserService {
  constructor(db) {
    this.db = db
    this.findByEmail = db.prepare('SELECT * FROM users WHERE email = ?')
    this.findById = db.prepare('SELECT * FROM users WHERE id = ?')
    this.insert = db.prepare(`
      INSERT INTO users (id, email, name, password_hash, created_at, last_login_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    this.touchLogin = db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    this.insertApiKeyUser = db.prepare(`
      UPDATE api_keys SET user_id = ?, team_id = ? WHERE id = ?
    `)
  }

  hash(password, salt) {
    return scryptSync(password, salt, 64).toString('hex')
  }

  create({ email, name, password }) {
    const existing = this.findByEmail.get(email.toLowerCase().trim())
    if (existing) throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists')

    const id = randomUUID()
    const salt = randomUUID()
    const now = new Date().toISOString()
    this.insert.run(id, email.toLowerCase().trim(), name.trim(), this.hash(password, salt) + ':' + salt, now, null)
    return { id, email: email.toLowerCase().trim(), name: name.trim(), createdAt: now }
  }

  authenticate(email, password) {
    const row = this.findByEmail.get(email.toLowerCase().trim())
    if (!row) throw new AppError(401, 'AUTH_FAILED', 'Invalid email or password')

    const parts = row.password_hash.split(':')
    const hash = parts[0]
    const salt = parts[1] || ''
    if (!safeEqual(hash, this.hash(password, salt))) {
      throw new AppError(401, 'AUTH_FAILED', 'Invalid email or password')
    }

    this.touchLogin.run(new Date().toISOString(), row.id)
    return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at, lastLoginAt: row.last_login_at }
  }

  get(id) {
    const row = this.findById.get(id)
    if (!row) return null
    return { id: row.id, email: row.email, name: row.name, createdAt: row.created_at, lastLoginAt: row.last_login_at }
  }
}
