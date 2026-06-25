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

describe('Phase T2 - Premium UX', () => {
  it('serves the SPA dashboard successfully', async () => {
    const res = await request(app).get('/dashboard')
    assert.equal(res.status, 200)
    assert.match(res.text, /WhatsApp Send API/)
  })

  it('includes Settings page in the SPA', async () => {
    const res = await request(app).get('/dashboard')
    assert.match(res.text, /data-page="settings"/)
    assert.match(res.text, /id="page-settings"/)
  })

  it('includes Settings sidebar menu item', async () => {
    const res = await request(app).get('/dashboard')
    assert.match(res.text, /Settings/)
  })

  it('includes onboarding overlay', async () => {
    const res = await request(app).get('/dashboard')
    assert.match(res.text, /id="onboardOverlay"/)
    assert.match(res.text, /Welcome to WhatsApp API Dashboard/)
  })

  it('includes tooltip data attributes', async () => {
    const res = await request(app).get('/dashboard')
    assert.match(res.text, /data-tip/)
  })

  it('includes enhanced analytics mini stats', async () => {
    const res = await request(app).get('/dashboard')
    assert.match(res.text, /analytics-mini/)
    assert.match(res.text, /id="statTotal"/)
    assert.match(res.text, /id="statRate"/)
  })

  it('includes theme toggle in Settings', async () => {
    const res = await request(app).get('/dashboard')
    assert.match(res.text, /data-theme="light"/)
    assert.match(res.text, /data-theme="dark"/)
  })

  it('includes anti-ban config display in Settings', async () => {
    const res = await request(app).get('/dashboard')
    assert.match(res.text, /id="setAbGap"/)
    assert.match(res.text, /id="setAbDaily"/)
  })

  it('has mobile responsive breakpoints', async () => {
    const res = await request(app).get('/dashboard')
    assert.match(res.text, /@media \(max-width:400px\)/)
    assert.match(res.text, /@media \(max-width:720px\)/)
  })

  it('includes onboarding connect button', async () => {
    const res = await request(app).get('/dashboard')
    assert.match(res.text, /id="onboardConnectBtn"/)
    assert.match(res.text, /onboardDismiss/)
  })
})

db.close()
