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
import { WebhookService } from '../src/services/webhook-service.js'
import { SchedulerService } from '../src/services/scheduler-service.js'
import { ContactService } from '../src/services/contact-service.js'
import { ABTestService } from '../src/services/ab-test-service.js'
import { WhiteLabelService } from '../src/services/white-label-service.js'

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
  webhookRetryIntervalMs: 300000
}

class FakeWhatsApp {
  getStatus() { return { status: 'connected', connected: true } }
  async waitForQr() { return null }
  async send(msg) { return { id: 'local-id', waMessageId: 'wa-id-' + Date.now(), status: 'sent', recipient: msg.to, type: msg.type } }
  async logout() { return { status: 'connecting', connected: false } }
}

describe('Phase T5 — Growth Features', () => {
  let db, app, billing, apiKeys, users, teams, audit, whatsapp, webhooks, scheduler, contacts, abTests, branding, testKey

  before(async () => {
    db = createDatabase(':memory:')
    const logger = pino({ enabled: false })
    const logs = new LogService(db, logger)
    apiKeys = new ApiKeyService(db, 'pepper-longer-than-thirty-two-characters', bootstrap, logs)
    users = new UserService(db)
    teams = new TeamService(db)
    audit = new AuditService(db)
    billing = new BillingService({ db, cfg, logger })
    webhooks = new WebhookService({ db, cfg, logger })
    whatsapp = new FakeWhatsApp()
    scheduler = new SchedulerService({ db, whatsapp, webhooks, logger })
    contacts = new ContactService(db)
    abTests = new ABTestService({ db, whatsapp, webhooks, logger })
    branding = new WhiteLabelService(db)
    app = createApp({ cfg, logger, logs, apiKeys, whatsapp, users, teams, audit, billing, webhooks, scheduler, contacts, abTests, branding })

    // Register a test user + team + API key
    const registerRes = await request(app)
      .post('/api/auth/register')
      .send({ email: 'growth@test.com', password: 'password12345', name: 'Growth Tester' })
      .expect(201)
    testKey = registerRes.body.data.apiKey
  })

  after(() => {
    scheduler.stop()
    db.close()
  })

  // ---- Database ----
  it('has Phase T5 database tables', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name)
    assert.ok(tables.includes('webhooks'))
    assert.ok(tables.includes('webhook_deliveries'))
    assert.ok(tables.includes('scheduled_messages'))
    assert.ok(tables.includes('contacts'))
    assert.ok(tables.includes('contact_groups'))
    assert.ok(tables.includes('contact_group_members'))
    assert.ok(tables.includes('ab_tests'))
    assert.ok(tables.includes('ab_test_results'))
    assert.ok(tables.includes('team_branding'))
  })

  // ---- Webhooks ----
  it('creates a webhook', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set('x-api-key', testKey)
      .send({ name: 'Test Webhook', url: 'https://example.com/webhook', events: ['message.sent', 'message.failed'] })
      .expect(201)
    assert.ok(res.body.data.id)
    assert.equal(res.body.data.name, 'Test Webhook')
    assert.equal(res.body.data.events.length, 2)
    assert.ok(res.body.data.secret)
  })

  it('lists webhooks', async () => {
    const res = await request(app)
      .get('/api/webhooks')
      .set('x-api-key', testKey)
      .expect(200)
    assert.equal(res.body.data.length, 1)
  })

  it('updates a webhook', async () => {
    const list = await request(app).get('/api/webhooks').set('x-api-key', testKey)
    const id = list.body.data[0].id
    const res = await request(app)
      .put(`/api/webhooks/${id}`)
      .set('x-api-key', testKey)
      .send({ name: 'Updated Webhook', enabled: false })
      .expect(200)
    assert.equal(res.body.data.name, 'Updated Webhook')
    assert.equal(res.body.data.enabled, false)
  })

  it('requires auth for webhooks', async () => {
    await request(app).get('/api/webhooks').expect(401)
  })

  it('deletes a webhook', async () => {
    const list = await request(app).get('/api/webhooks').set('x-api-key', testKey)
    const id = list.body.data[0].id
    const res = await request(app)
      .delete(`/api/webhooks/${id}`)
      .set('x-api-key', testKey)
      .expect(200)
    assert.equal(res.body.data.deleted, true)
  })

  // ---- Scheduling ----
  it('schedules a message', async () => {
    const future = new Date(Date.now() + 3600000).toISOString()
    const res = await request(app)
      .post('/api/schedule')
      .set('x-api-key', testKey)
      .send({ recipient: '923001234567', messageType: 'text', payload: { text: 'Scheduled' }, scheduledAt: future })
      .expect(201)
    assert.ok(res.body.data.id)
    assert.equal(res.body.data.status, 'pending')
  })

  it('rejects past date scheduling', async () => {
    const past = new Date(Date.now() - 3600000).toISOString()
    await request(app)
      .post('/api/schedule')
      .set('x-api-key', testKey)
      .send({ recipient: '923001234567', messageType: 'text', payload: { text: 'Past' }, scheduledAt: past })
      .expect(400)
  })

  it('lists scheduled messages', async () => {
    const res = await request(app)
      .get('/api/schedule')
      .set('x-api-key', testKey)
      .expect(200)
    assert.equal(res.body.data.length, 1)
  })

  it('cancels a scheduled message', async () => {
    const list = await request(app).get('/api/schedule').set('x-api-key', testKey)
    const id = list.body.data[0].id
    const res = await request(app)
      .post(`/api/schedule/${id}/cancel`)
      .set('x-api-key', testKey)
      .expect(200)
    assert.equal(res.body.data.canceled, true)
  })

  // ---- Contacts ----
  it('creates a contact', async () => {
    const res = await request(app)
      .post('/api/contacts')
      .set('x-api-key', testKey)
      .send({ name: 'John Doe', number: '923001234567', tags: ['customer', 'vip'] })
      .expect(201)
    assert.ok(res.body.data.id)
    assert.equal(res.body.data.name, 'John Doe')
    assert.deepEqual(res.body.data.tags, ['customer', 'vip'])
  })

  it('lists contacts', async () => {
    const res = await request(app)
      .get('/api/contacts')
      .set('x-api-key', testKey)
      .expect(200)
    assert.equal(res.body.data.length, 1)
  })

  it('searches contacts', async () => {
    const res = await request(app)
      .get('/api/contacts?query=John')
      .set('x-api-key', testKey)
      .expect(200)
    assert.equal(res.body.data.length, 1)
  })

  it('updates a contact', async () => {
    const list = await request(app).get('/api/contacts').set('x-api-key', testKey)
    const id = list.body.data[0].id
    const res = await request(app)
      .put(`/api/contacts/${id}`)
      .set('x-api-key', testKey)
      .send({ name: 'Jane Doe' })
      .expect(200)
    assert.equal(res.body.data.name, 'Jane Doe')
  })

  it('creates and manages contact groups', async () => {
    // Create group
    const groupRes = await request(app)
      .post('/api/contacts/groups')
      .set('x-api-key', testKey)
      .send({ name: 'VIP Customers', description: 'High-value customers' })
      .expect(201)
    assert.ok(groupRes.body.data.id)
    const groupId = groupRes.body.data.id

    // Get contact
    const list = await request(app).get('/api/contacts').set('x-api-key', testKey)
    const contactId = list.body.data[0].id

    // Add to group
    await request(app)
      .post(`/api/contacts/groups/${groupId}/members`)
      .set('x-api-key', testKey)
      .send({ contactIds: [contactId] })
      .expect(200)

    // List members
    const members = await request(app)
      .get(`/api/contacts/groups/${groupId}/members`)
      .set('x-api-key', testKey)
      .expect(200)
    assert.equal(members.body.data.length, 1)

    // List groups
    const groups = await request(app)
      .get('/api/contacts/groups/list')
      .set('x-api-key', testKey)
      .expect(200)
    assert.equal(groups.body.data.length, 1)
    assert.equal(groups.body.data[0].member_count, 1)
  })

  // ---- A/B Testing ----
  it('creates an A/B test', async () => {
    const res = await request(app)
      .post('/api/ab-tests')
      .set('x-api-key', testKey)
      .send({
        name: 'Welcome Offer Test',
        description: 'Test two welcome messages',
        variants: [
          { name: 'Discount 10%', type: 'text', content: { text: 'Get 10% off!' } },
          { name: 'Discount 20%', type: 'text', content: { text: 'Get 20% off!' } }
        ]
      })
      .expect(201)
    assert.ok(res.body.data.id)
    assert.equal(res.body.data.status, 'draft')
    assert.equal(res.body.data.variants.length, 2)
  })

  it('starts an A/B test', async () => {
    const list = await request(app).get('/api/ab-tests').set('x-api-key', testKey)
    const id = list.body.data[0].id
    const res = await request(app)
      .post(`/api/ab-tests/${id}/start`)
      .set('x-api-key', testKey)
      .expect(200)
    assert.equal(res.body.data.status, 'running')
  })

  it('sends an A/B test variant', async () => {
    const list = await request(app).get('/api/ab-tests').set('x-api-key', testKey)
    const id = list.body.data[0].id
    const res = await request(app)
      .post(`/api/ab-tests/${id}/send`)
      .set('x-api-key', testKey)
      .send({ variantIndex: 0, recipient: '923001234567' })
      .expect(201)
    assert.ok(res.body.data.resultId)
  })

  it('gets A/B test results', async () => {
    const list = await request(app).get('/api/ab-tests').set('x-api-key', testKey)
    const id = list.body.data[0].id
    const res = await request(app)
      .get(`/api/ab-tests/${id}/results`)
      .set('x-api-key', testKey)
      .expect(200)
    assert.ok(res.body.data.stats)
    assert.ok(Array.isArray(res.body.data.results))
    assert.equal(res.body.data.results.length, 1)
  })

  // ---- White-label Branding ----
  it('gets default branding (null)', async () => {
    const res = await request(app)
      .get('/api/branding')
      .set('x-api-key', testKey)
      .expect(200)
    assert.equal(res.body.data.brandName, null)
  })

  it('updates branding', async () => {
    const res = await request(app)
      .put('/api/branding')
      .set('x-api-key', testKey)
      .send({ brandName: 'My Company', primaryColor: '#4F46E5', logoUrl: 'https://example.com/logo.png', supportEmail: 'support@mycompany.com' })
      .expect(200)
    assert.equal(res.body.data.brandName, 'My Company')
    assert.equal(res.body.data.primaryColor, '#4F46E5')
  })

  it('persists branding', async () => {
    const res = await request(app)
      .get('/api/branding')
      .set('x-api-key', testKey)
      .expect(200)
    assert.equal(res.body.data.brandName, 'My Company')
  })

  // ---- SDK ----
  it('SDK client exists and exports BaileysClient', async () => {
    const { BaileysClient } = await import('../clients/node/index.js')
    assert.ok(typeof BaileysClient === 'function')
    const client = new BaileysClient({ apiKey: testKey, baseUrl: 'http://localhost:3000' })
    assert.ok(client.sendMessage)
    assert.ok(client.createWebhook)
    assert.ok(client.scheduleMessage)
    assert.ok(client.createContact)
    assert.ok(client.createABTest)
    assert.ok(client.getBranding)
    assert.ok(client.getBillingPlans)
  })
})
