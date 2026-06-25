import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'
import pino from 'pino'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { createDatabase } from '../src/db/database.js'
import { ApiKeyService } from '../src/services/api-key-service.js'
import { LogService } from '../src/services/log-service.js'

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
  port: 3000,
  publicDomain: null,
  publicIp: null,
  env: 'test',
  isProduction: false
}

class FakeWhatsApp {
  getStatus() { return { status: 'connected', connected: true } }
  async waitForQr() { return null }
  async send(msg) { return { id: 'local-id', waMessageId: 'wa-id', status: 'sent', recipient: msg.to, type: msg.type } }
  async logout() { return { status: 'connecting', connected: false } }
}

const db = createDatabase(':memory:')
const logger = pino({ enabled: false })
const logs = new LogService(db, logger)
const apiKeys = new ApiKeyService(db, 'pepper-longer-than-thirty-two-characters', bootstrap, logs)
const whatsapp = new FakeWhatsApp()
const app = createApp({ cfg, logger, logs, apiKeys, whatsapp })

after(() => db.close())

describe('Phase T1 - Foundation', () => {
  it('serves landing page at /', async () => {
    const res = await request(app).get('/')
    assert.equal(res.status, 200)
    assert.match(res.text, /Baileys WhatsApp API/)
    assert.match(res.text, /Get Started|Send messages programmatically/)
  })

  it('serves dashboard at /dashboard', async () => {
    const res = await request(app).get('/dashboard')
    assert.equal(res.status, 200)
    assert.match(res.text, /WhatsApp Send API/)
  })

  it('serves OpenAPI spec at /api/docs.json', async () => {
    const res = await request(app).get('/api/docs.json')
    assert.equal(res.status, 200)
    assert.equal(res.body.openapi, '3.1.0')
    assert.equal(res.body.info.title, 'Baileys WhatsApp Send API')
    assert.ok(res.body.paths['/api/send-message'])
  })

  it('serves Swagger UI at /api/docs/', async () => {
    const res = await request(app).get('/api/docs/')
    assert.equal(res.status, 200)
    assert.match(res.text, /swagger/i)
  })

  it('redirects /api/docs to /api/docs/', async () => {
    const res = await request(app).get('/api/docs')
    assert.equal(res.status, 301)
    assert.match(res.headers.location, /\/api\/docs\//)
  })
})
