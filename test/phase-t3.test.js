import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import pino from 'pino'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/db/database.js'
import { ApiKeyService } from '../src/services/api-key-service.js'
import { LogService } from '../src/services/log-service.js'
import { UserService } from '../src/services/user-service.js'
import { TeamService } from '../src/services/team-service.js'
import { AuditService } from '../src/services/audit-service.js'

const bootstrap = 'bootstrap-key-that-is-longer-than-thirty-two-characters'
const cfg = {
  trustProxy: 0,
  corsOrigins: ['https://allowed.example'],
  apiRateLimitWindowMs: 60000,
  apiRateLimitMax: 100,
  adminRateLimitMax: 100,
  maxMediaBytes: 1024 * 1024,
  allowRemoteMedia: false,
  remoteMediaTimeoutMs: 1000,
  allowRegistration: true,
  maxTeamMembers: 50
}

class FakeWhatsApp {
  getStatus() { return { status: 'connected', connected: true } }
  async waitForQr() { return null }
  async send(msg) { return { id: 'local-id', waMessageId: 'wa-id', status: 'sent', recipient: msg.to, type: msg.type } }
  async logout() { return { status: 'connecting', connected: false } }
}

describe('Phase T3 — Core Business Features', () => {
  let db, app, apiKeys, users, teams, audit, whatsapp

  before(() => {
    db = createDatabase(':memory:')
    const logger = pino({ enabled: false })
    const logs = new LogService(db, logger)
    apiKeys = new ApiKeyService(db, 'pepper-longer-than-thirty-two-characters', bootstrap, logs)
    users = new UserService(db)
    teams = new TeamService(db)
    audit = new AuditService(db)
    whatsapp = new FakeWhatsApp()
    app = createApp({ cfg, logger, logs, apiKeys, whatsapp, users, teams, audit })
  })

  after(() => db.close())

  // ---- Database / Schema ----
  it('has Phase T3 database tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    assert.ok(tables.includes('users'))
    assert.ok(tables.includes('teams'))
    assert.ok(tables.includes('team_members'))
    assert.ok(tables.includes('audit_logs'))
  })

  it('has user_id and team_id columns on api_keys', () => {
    const cols = db.prepare('PRAGMA table_info(api_keys)').all().map(r => r.name)
    assert.ok(cols.includes('user_id'))
    assert.ok(cols.includes('team_id'))
  })

  // ---- User Service ----
  it('creates a user account', () => {
    const user = users.create({ email: 'alice@test.com', name: 'Alice', password: 'secret12345' })
    assert.ok(user.id)
    assert.equal(user.email, 'alice@test.com')
    assert.equal(user.name, 'Alice')
  })

  it('rejects duplicate email', () => {
    assert.throws(() => users.create({ email: 'alice@test.com', name: 'Alice 2', password: 'secret12345' }), {
      code: 'EMAIL_EXISTS'
    })
  })

  it('authenticates user with correct password', () => {
    const user = users.authenticate('alice@test.com', 'secret12345')
    assert.ok(user.id)
    assert.equal(user.email, 'alice@test.com')
  })

  it('rejects wrong password', () => {
    assert.throws(() => users.authenticate('alice@test.com', 'wrongpassword'), {
      code: 'AUTH_FAILED'
    })
  })

  it('returns null for unknown user', () => {
    assert.equal(users.get('nonexistent-id'), null)
  })

  // ---- Team Service ----
  it('creates a team with owner', () => {
    const user = users.create({ email: 'bob@test.com', name: 'Bob', password: 'secret12345' })
    const team = teams.create({ name: "Bob's Team", ownerId: user.id })
    assert.ok(team.id)
    assert.equal(team.name, "Bob's Team")

    const members = teams.listMembers(team.id)
    assert.equal(members.length, 1)
    assert.equal(members[0].role, 'owner')
  })

  it('invites a member to a team', () => {
    const owner = users.create({ email: 'owner@test.com', name: 'Owner', password: 'secret12345' })
    const member_user = users.create({ email: 'member@test.com', name: 'Member', password: 'secret12345' })
    const team = teams.create({ name: 'Owner Team', ownerId: owner.id })

    const invite = teams.invite({ teamId: team.id, inviterId: owner.id, email: 'member@test.com', role: 'member' })
    assert.equal(invite.role, 'member')

    const members = teams.listMembers(team.id)
    assert.equal(members.length, 2)
  })

  it('changes member role', () => {
    const owner = users.create({ email: 'roleowner@test.com', name: 'Role Owner', password: 'secret12345' })
    const member_user = users.create({ email: 'rolemember@test.com', name: 'Role Member', password: 'secret12345' })
    const team = teams.create({ name: 'Role Team', ownerId: owner.id })
    teams.invite({ teamId: team.id, inviterId: owner.id, email: 'rolemember@test.com', role: 'member' })

    const result = teams.changeRole({ teamId: team.id, actorId: owner.id, targetUserId: member_user.id, newRole: 'admin' })
    assert.equal(result.newRole, 'admin')
  })

  it('removes a member', () => {
    const owner = users.create({ email: 'removeowner@test.com', name: 'Remove Owner', password: 'secret12345' })
    const member_user = users.create({ email: 'removemember@test.com', name: 'Remove Member', password: 'secret12345' })
    const team = teams.create({ name: 'Remove Team', ownerId: owner.id })
    teams.invite({ teamId: team.id, inviterId: owner.id, email: 'removemember@test.com', role: 'member' })

    const result = teams.removeMember({ teamId: team.id, actorId: owner.id, targetUserId: member_user.id })
    assert.ok(result.removed)
    assert.equal(teams.listMembers(team.id).length, 1)
  })

  // ---- Audit Service ----
  it('writes and retrieves audit log entries', () => {
    // Use null teamId/userId (FK deletes set null)
    const entry = audit.write({
      teamId: null,
      userId: null,
      apiKeyId: null,
      action: 'test.action',
      resource: 'test',
      resourceId: 'test-resource',
      details: { foo: 'bar' }
    })
    assert.ok(entry.id)

    // Disable FK enforcement for direct listByTeam query with fake ID
    db.pragma('foreign_keys = OFF')
    const entry2 = audit.write({
      teamId: 'test-team',
      userId: 'test-user',
      action: 'test.action2',
      resource: 'test',
      resourceId: 'test-resource2'
    })
    db.pragma('foreign_keys = ON')

    assert.ok(entry2.id)
    const entries = audit.listByTeam('test-team')
    assert.ok(entries.length >= 1)
  })

  // ---- API: Registration ----
  it('registers a new user via API', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'newuser@test.com', password: 'password12345', name: 'New User' })
      .expect(201)

    assert.ok(res.body.data.user)
    assert.ok(res.body.data.team)
    assert.match(res.body.data.apiKey, /^wapi_/)
    assert.ok(res.body.data.apiKeyId)
  })

  it('rejects duplicate registration email', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'newuser@test.com', password: 'password12345', name: 'Dup User' })
      .expect(409)
  })

  it('rejects registration with weak password', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ email: 'weak@test.com', password: 'short', name: 'Weak User' })
      .expect(400)
  })

  // ---- API: Login ----
  it('logs in and returns teams and API keys', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'newuser@test.com', password: 'password12345' })
      .expect(200)

    assert.ok(res.body.data.user)
    assert.ok(Array.isArray(res.body.data.teams))
    assert.equal(res.body.data.teams.length, 1)
    assert.ok(res.body.data.teams[0].keys.length >= 1)
  })

  it('rejects login with wrong password', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'newuser@test.com', password: 'wrongpassword' })
      .expect(401)
  })

  // ---- API: Auth config ----
  it('serves auth config publicly', async () => {
    const res = await request(app)
      .get('/api/auth/config')
      .expect(200)
    assert.ok(res.body.success)
    assert.ok('allowRegistration' in res.body.data)
  })

  // ---- API: Auth /me ----
  it('returns auth info via /me with API key', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('x-api-key', bootstrap)
      .expect(200)

    assert.ok(res.body.data.authenticated)
  })

  it('requires auth for /me without API key', async () => {
    await request(app)
      .get('/api/auth/me')
      .expect(401)
  })

  // ---- API: Team routes ----
  it('requires API key for team routes', async () => {
    await request(app)
      .get('/api/team')
      .expect(401)
  })

  // ---- Existing endpoints still work ----
  it('health check still works', async () => {
    await request(app).get('/healthz').expect(200)
  })

  it('dashboard still serves', async () => {
    await request(app).get('/dashboard').expect(200)
  })

  it('existing API routes still require auth', async () => {
    await request(app).get('/api/status').expect(401)
  })

  it('bootstrap key still authenticates', async () => {
    await request(app).get('/api/status').set('x-api-key', bootstrap).expect(200)
  })

  it('bootstrap key can access team routes with tenant info', async () => {
    // Bootstrap key has no user/team, so team routes should return 403
    await request(app)
      .get('/api/team')
      .set('x-api-key', bootstrap)
      .expect(403)
  })
})

