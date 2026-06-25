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
import { BillingService } from '../src/services/billing-service.js'

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
  maxTeamMembers: 50,
  stripeSecretKey: null,
  stripeWebhookSecret: null,
  stripeTrialDays: 14
}

class FakeWhatsApp {
  getStatus() { return { status: 'connected', connected: true } }
  async waitForQr() { return null }
  async send(msg) { return { id: 'local-id', waMessageId: 'wa-id', status: 'sent', recipient: msg.to, type: msg.type } }
  async logout() { return { status: 'connecting', connected: false } }
}

describe('Phase T4 — Monetization', () => {
  let db, app, billing, apiKeys, users, teams, audit, whatsapp, testKey

  before(async () => {
    db = createDatabase(':memory:')
    const logger = pino({ enabled: false })
    const logs = new LogService(db, logger)
    apiKeys = new ApiKeyService(db, 'pepper-longer-than-thirty-two-characters', bootstrap, logs)
    users = new UserService(db)
    teams = new TeamService(db)
    audit = new AuditService(db)
    billing = new BillingService({ db, cfg, logger })
    whatsapp = new FakeWhatsApp()
    app = createApp({ cfg, logger, logs, apiKeys, whatsapp, users, teams, audit, billing })

    // Register a test user + team + API key
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'billing@test.com', password: 'password12345', name: 'Billing Tester' })
      .expect(201)
    testKey = registerRes.body.data.apiKey
  })

  after(() => db.close())

  // ---- Database ----
  it('has billing database tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    assert.ok(tables.includes('plans'))
    assert.ok(tables.includes('subscriptions'))
    assert.ok(tables.includes('usage_records'))
  })

  it('has seeded default plans', () => {
    const plans = db.prepare('SELECT * FROM plans ORDER BY sort_order').all()
    assert.equal(plans.length, 4)
    assert.equal(plans[0].id, 'free')
    assert.equal(plans[1].id, 'starter')
    assert.equal(plans[2].id, 'pro')
    assert.equal(plans[3].id, 'enterprise')
  })

  // ---- Billing Service ----
  it('lists plans via service', () => {
    const plans = billing.listPlans()
    assert.equal(plans.length, 4)
    assert.equal(plans[0].priceCents, 0) // free
    assert.ok(plans[1].priceCents > 0)  // starter
  })

  it('auto-creates free subscription on first access', () => {
    // We need the team ID from registration
    const team = db.prepare("SELECT id FROM teams WHERE name LIKE 'Billing Tester%'").get()
    assert.ok(team)
    const sub = billing.getSubscription(team.id)
    assert.equal(sub.plan_id, 'free')
    assert.equal(sub.status, 'active')
  })

  it('tracks and retrieves usage', () => {
    const team = db.prepare("SELECT id FROM teams WHERE name LIKE 'Billing Tester%'").get()
    billing.trackUsage(team.id, 5)
    billing.trackUsage(team.id, 3)
    const usage = billing.getUsage(team.id)
    assert.equal(usage.messagesSent, 8)
  })

  it('checks quota — under limit', async () => {
    const team = db.prepare("SELECT id FROM teams WHERE name LIKE 'Billing Tester%'").get()
    const quota = await billing.checkQuota(team.id)
    assert.ok(quota.allowed)
    assert.equal(quota.plan.id, 'free')
    assert.equal(quota.plan.monthlyLimit, 50)
    assert.equal(quota.remaining, 42)
  })

  it('checks quota — exceeded limit', async () => {
    const team = db.prepare("SELECT id FROM teams WHERE name LIKE 'Billing Tester%'").get()
    billing.trackUsage(team.id, 100)
    const quota = await billing.checkQuota(team.id)
    assert.equal(quota.allowed, false)
    assert.ok(quota.exceeded)
    assert.equal(quota.remaining, 0)
  })

  it('changes plan (upgrade)', () => {
    const team = db.prepare("SELECT id FROM teams WHERE name LIKE 'Billing Tester%'").get()
    const result = billing.changePlan(team.id, 'pro')
    assert.equal(result.planId, 'pro')
    assert.equal(result.status, 'active')

    const sub = billing.getSubscription(team.id)
    assert.equal(sub.plan_id, 'pro')
  })

  it('changes plan (downgrade back to free)', () => {
    const team = db.prepare("SELECT id FROM teams WHERE name LIKE 'Billing Tester%'").get()
    const result = billing.changePlan(team.id, 'free')
    assert.equal(result.planId, 'free')

    const sub = billing.getSubscription(team.id)
    assert.equal(sub.plan_id, 'free')
  })

  it('cancels subscription', () => {
    const team = db.prepare("SELECT id FROM teams WHERE name LIKE 'Billing Tester%'").get()
    const result = billing.cancelSubscription(team.id)
    assert.equal(result.status, 'canceled')

    const sub = billing.getSubscription(team.id)
    assert.equal(sub.status, 'canceled')
  })

  // ---- API: Plans ----
  it('GET /api/billing/plans returns plans', async () => {
    const res = await request(app)
      .get('/api/billing/plans')
      .set('x-api-key', testKey)
      .expect(200)

    assert.equal(res.body.data.plans.length, 4)
  })

  it('GET /api/billing/plans requires auth', async () => {
    await request(app).get('/api/billing/plans').expect(401)
  })

  // ---- API: Subscription ----
  it('GET /api/billing/subscription returns subscription info', async () => {
    const res = await request(app)
      .get('/api/billing/subscription')
      .set('x-api-key', testKey)
      .expect(200)

    assert.ok(res.body.data.subscription)
    assert.ok(res.body.data.plan)
    assert.ok(res.body.data.usage)
    assert.ok(res.body.data.quota)
  })

  // ---- API: Usage ----
  it('GET /api/billing/usage returns usage with quota', async () => {
    const res = await request(app)
      .get('/api/billing/usage')
      .set('x-api-key', testKey)
      .expect(200)

    assert.ok(res.body.data.usage)
    assert.ok(res.body.data.quota)
  })

  // ---- API: Checkout (mock mode) ----
  it('POST /api/billing/checkout works in mock mode', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set('x-api-key', testKey)
      .send({ planId: 'pro' })
      .expect(200)

    assert.ok(res.body.data.mock)
    assert.ok(res.body.data.sessionId)
  })

  it('POST /api/billing/checkout with free plan returns free=true', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set('x-api-key', testKey)
      .send({ planId: 'free' })
      .expect(200)

    assert.ok(res.body.data.free)
  })

  it('POST /api/billing/checkout with invalid plan returns error', async () => {
    const res = await request(app)
      .post('/api/billing/checkout')
      .set('x-api-key', testKey)
      .send({ planId: 'nonexistent' })
      .expect(404)
  })

  // ---- API: Change plan (upgrade/downgrade) ----
  it('POST /api/billing/change-plan upgrades to pro', async () => {
    const res = await request(app)
      .post('/api/billing/change-plan')
      .set('x-api-key', testKey)
      .send({ planId: 'pro' })
      .expect(200)

    assert.equal(res.body.data.planId, 'pro')

    // Verify subscription updated
    const subRes = await request(app)
      .get('/api/billing/subscription')
      .set('x-api-key', testKey)
    assert.equal(subRes.body.data.subscription.planId, 'pro')
  })

  it('POST /api/billing/change-plan downgrades to starter', async () => {
    const res = await request(app)
      .post('/api/billing/change-plan')
      .set('x-api-key', testKey)
      .send({ planId: 'starter' })
      .expect(200)

    assert.equal(res.body.data.planId, 'starter')
  })

  // ---- API: Cancel ----
  it('POST /api/billing/cancel marks subscription canceled', async () => {
    const res = await request(app)
      .post('/api/billing/cancel')
      .set('x-api-key', testKey)
      .expect(200)

    assert.equal(res.body.data.status, 'canceled')
  })

  // ---- API: Portal ----
  it('POST /api/billing/portal returns URL (mock)', async () => {
    const res = await request(app)
      .post('/api/billing/portal')
      .set('x-api-key', testKey)
      .expect(200)

    assert.ok(res.body.data.url)
    assert.ok(res.body.data.mock)
  })

  // ---- Quota enforcement ----
  it('blocks sends when quota exceeded', async () => {
    // Set usage way over free limit
    const team = db.prepare("SELECT id FROM teams WHERE name LIKE 'Billing Tester%'").get()
    billing.changePlan(team.id, 'free')
    billing.trackUsage(team.id, 1000) // free limit is 50

    const res = await request(app)
      .post('/api/send-message')
      .set('x-api-key', testKey)
      .send({ to: '923001234567', message: 'Test' })
      .expect(429)

    assert.equal(res.body.code, 'QUOTA_EXCEEDED')
  })

  it('allows sends when under quota', async () => {
    const team = db.prepare("SELECT id FROM teams WHERE name LIKE 'Billing Tester%'").get()
    billing.changePlan(team.id, 'enterprise') // 50000 limit

    const res = await request(app)
      .post('/api/send-message')
      .set('x-api-key', testKey)
      .send({ to: '923001234567', message: 'Under quota test' })
      .expect(201)

    assert.equal(res.body.data.status, 'sent')
  })
})

