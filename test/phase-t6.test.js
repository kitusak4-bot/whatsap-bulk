import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import fs from 'node:fs'
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
import { WebhookService } from '../src/services/webhook-service.js'
import { SchedulerService } from '../src/services/scheduler-service.js'
import { ContactService } from '../src/services/contact-service.js'
import { ABTestService } from '../src/services/ab-test-service.js'
import { WhiteLabelService } from '../src/services/white-label-service.js'
import { QueueService } from '../src/services/queue-service.js'
import { RateLimiter } from '../src/services/rate-limiter.js'
import { ReportingService } from '../src/services/reporting-service.js'
import { BackupService } from '../src/services/backup-service.js'

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
  stripeTrialDays: 14,
  schedulerPollIntervalMs: 5000,
  webhookRetryIntervalMs: 300000,
  queuePollIntervalMs: 1000,
  queueConcurrency: 5,
  queueRetryMaxAttempts: 3,
  databasePath: ':memory:',
  backupDir: '/tmp/baileys-backups-test',
  backupRetentionDays: 30
}

class FakeWhatsApp {
  getStatus() { return { status: 'connected', connected: true } }
  async waitForQr() { return null }
  async send(msg) { return { id: 'local-id', waMessageId: 'wa-id-' + Date.now(), status: 'sent', recipient: msg.to, type: msg.type } }
  async logout() { return { status: 'connecting', connected: false } }
}

describe('Phase T6 — Enterprise Scale', () => {
  let db, app, apiKeys, users, teams, audit, whatsapp, webhooks, scheduler, contacts, abTests, branding, queue, rateLimiter, reports, backup, testKey

  before(async () => {
    db = createDatabase(':memory:')
    const logger = pino({ enabled: false })
    const logs = new LogService(db, logger)
    apiKeys = new ApiKeyService(db, 'pepper-longer-than-thirty-two-characters', bootstrap, logs)
    users = new UserService(db)
    teams = new TeamService(db)
    audit = new AuditService(db)
    const billing = new BillingService({ db, cfg, logger })
    webhooks = new WebhookService({ db, cfg, logger })
    whatsapp = new FakeWhatsApp()
    scheduler = new SchedulerService({ db, whatsapp, webhooks, logger })
    contacts = new ContactService(db)
    abTests = new ABTestService({ db, whatsapp, webhooks, logger })
    branding = new WhiteLabelService(db)
    queue = new QueueService({ db, logger })
    rateLimiter = new RateLimiter(db)
    reports = new ReportingService(db)
    backup = new BackupService({ db, cfg, logger })
    app = createApp({ cfg, logger, logs, apiKeys, whatsapp, users, teams, audit, billing, webhooks, scheduler, contacts, abTests, branding, queue, rateLimiter, reports, backup })

    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'enterprise@test.com', password: 'password12345', name: 'Enterprise Tester' })
      .expect(201)
    testKey = registerRes.body.data.apiKey
  })

  after(() => {
    scheduler.stop()
    queue.stop()
    db.close()
  })

  // ---- Database ----
  it('has Phase T6 database tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    assert.ok(tables.includes('job_queue'))
    assert.ok(tables.includes('team_config'))
    assert.ok(tables.includes('rate_limit_windows'))
  })

  // ---- Queue ----
  it('enqueues and processes jobs', async () => {
    const processed = []
    await queue.process('test-job', async (payload) => {
      processed.push(payload)
      return { ok: true }
    })

    const id = queue.add('test-job', { hello: 'world' })
    assert.ok(id)
    queue.startPolling(100, 5)

    // Wait for processing
    await new Promise(r => setTimeout(r, 500))
    assert.equal(processed.length, 1)
    assert.equal(processed[0].hello, 'world')
  })

  it('tracks queue stats', () => {
    const stats = queue.getStats()
    assert.ok(typeof stats.pending === 'number')
    assert.ok(typeof stats.failed === 'number')
  })

  it('persists jobs to database (restart recovery)', () => {
    const jobs = queue.list(10)
    assert.ok(jobs.length >= 1)
    const job = jobs.find(j => j.type === 'test-job')
    assert.ok(job)
    assert.equal(job.status, 'completed')
    assert.deepEqual(job.result, { ok: true })
  })

  // ---- Rate Limiting ----
  it('allows requests within limit', async () => {
    const result = await rateLimiter.check('test-team')
    assert.equal(result.allowed, true)
    assert.ok(result.remaining >= 0)
  })

  it('configures custom rate limits', () => {
    rateLimiter.setLimit('test-team', 'premium', 1000, 60000)
    const limit = rateLimiter.getLimit('test-team', 'premium')
    assert.equal(limit.maxRequests, 1000)
    assert.equal(limit.windowMs, 60000)
  })

  // ---- Reporting ----
  it('returns usage summary', async () => {
    const res = await request(app)
      .get('/api/reports/usage')
      .set('x-api-key', testKey)
      .expect(200)
    assert.ok(typeof res.body.data.totalMessages === 'number')
    assert.ok(typeof res.body.data.activeWebhooks === 'number')
  })

  it('returns message stats', async () => {
    const res = await request(app)
      .get('/api/reports/messages')
      .set('x-api-key', testKey)
      .expect(200)
    assert.ok(res.body.data.stats)
    assert.ok(res.body.data.daily)
  })

  // ---- Audit Export ----
  it('exports audit logs as JSON', async () => {
    const res = await request(app)
      .get('/api/reports/export/audit')
      .set('x-api-key', testKey)
      .expect(200)
    assert.ok(Array.isArray(res.body.data))
  })

  it('exports audit logs as CSV', async () => {
    const res = await request(app)
      .get('/api/reports/export/audit?format=csv')
      .set('x-api-key', testKey)
      .expect(200)
    assert.ok(res.text.includes('id,action,resource'))
    assert.ok(res.headers['content-type'].startsWith('text/csv'))
  })

  // ---- Backup & Restore ----
  it('creates a backup', async () => {
    const res = await request(app)
      .post('/api/backup')
      .set('x-api-key', testKey)
      .expect(200)
    assert.ok(res.body.data.path)
    assert.ok(res.body.data.sizeBytes > 0)
    assert.ok(fs.existsSync(res.body.data.path))
  })

  it('returns backup info', async () => {
    const res = await request(app)
      .get('/api/backup/info')
      .set('x-api-key', testKey)
      .expect(200)
    assert.ok(res.body.data.databasePath)
    assert.ok(typeof res.body.data.sizeBytes === 'number')
    assert.ok(res.body.data.backupCount >= 1)
  })

  it('lists backups', async () => {
    const res = await request(app)
      .get('/api/backup/list')
      .set('x-api-key', testKey)
      .expect(200)
    assert.ok(res.body.data.length >= 1)
  })

  // ---- Queue stats endpoint ----
  it('returns queue stats', async () => {
    const res = await request(app)
      .get('/api/queue/stats')
      .set('x-api-key', testKey)
      .expect(200)
    assert.ok(typeof res.body.data.pending === 'number')
  })
})
