/**
 * Developed by Mohammad Rameez Imdad (Rameez Scripts)
 * WhatsApp: https://wa.me/923224083545 (For Custom Projects)
 * YouTube: https://www.youtube.com/@rameezimdad (Subscribe for more!)
 */

import { randomUUID } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import helmet from 'helmet'
import pinoHttp from 'pino-http'
import swaggerUi from 'swagger-ui-express'
import { apiKeyAuth } from './middleware/auth.js'
import { enrichApiKey, resolveTeamRole } from './middleware/tenant.js'
import { errorHandler, notFound } from './middleware/error-handler.js'
import { createAdminRouter } from './routes/admin.js'
import { createPublicAuthRouter, createProtectedAuthRouter } from './routes/auth.js'
import { createTeamRouter } from './routes/team.js'
import { createBillingRouter } from './routes/billing.js'
import { createWebhookRouter } from './routes/webhooks.js'
import { createSchedulingRouter } from './routes/scheduling.js'
import { createContactRouter } from './routes/contacts.js'
import { createABTestRouter } from './routes/ab-testing.js'
import { createBrandingRouter } from './routes/branding.js'
import { createReportingRouter } from './routes/reporting.js'
import { createSuperAdminRouter } from './routes/super-admin.js'
import { enforceQuota } from './middleware/quota.js'
import { createMessagingRouter } from './routes/messaging.js'
import { createWhatsAppRouter } from './routes/whatsapp.js'
import { getOpenApiSpec } from './services/api-docs.js'
import { trackEvent } from './services/analytics.js'
import { isSentryEnabled, getSentry } from './services/sentry.js'
import { asyncHandler } from './utils/errors.js'
import { fail, ok } from './utils/response.js'
import { getPublicIp } from './utils/server-info.js'

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public')

// dashboard polling endpoints get their own generous limiter
const MONITOR_PATHS = new Set(['/status', '/qr', '/me', '/server-info'])
const isMonitor = req => req.method === 'GET' && MONITOR_PATHS.has(req.path)

const limiter = ({ windowMs, limit, keyGenerator, skip }) => rateLimit({
  windowMs,
  limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ...(keyGenerator ? { keyGenerator } : {}),
  ...(skip ? { skip } : {}),
  handler: (req, res) => {
    res.set('retry-after', String(Math.ceil(windowMs / 1000)))
    fail(res, 429, 'RATE_LIMITED', 'Too many requests; retry later')
  }
})

export const createApp = ({ cfg, logger, logs, apiKeys, whatsapp, users, teams, audit, billing, webhooks, scheduler, contacts, abTests, branding, queue, rateLimiter, reports, backup, superAdmin }) => {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', cfg.trustProxy)

  app.use((req, res, next) => {
    req.id = req.get('x-request-id')?.slice(0, 100) || randomUUID()
    req.startAt = process.hrtime.bigint()
    res.set('x-request-id', req.id)
    next()
  })

  if (isSentryEnabled()) {
    app.use(getSentry().Handlers.requestHandler())
  }

  // Serve landing page at root - redirect to login
  app.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'login.html'))
  })

  // Serve login page
  app.get('/login', (req, res) => {
    res.sendFile(path.join(publicDir, 'login.html'))
  })

  // Serve the SPA dashboard at /dashboard
  app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'))
  })

  // OpenAPI spec as JSON
  app.get('/api/docs.json', (req, res) => {
    res.json(getOpenApiSpec(cfg))
  })

  // Swagger UI
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(getOpenApiSpec(cfg), {
    customSiteTitle: 'Baileys WhatsApp API - Docs',
    customfavIcon: '/favicon.ico',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true
    }
  }))

  app.use(pinoHttp({
    logger,
    genReqId: req => req.id,
    customLogLevel: (req, res, error) => error || res.statusCode >= 500
      ? 'error'
      : res.statusCode >= 400 ? 'warn' : 'info'
  }))
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }))
  app.use((req, res, next) => {
    // API-key auth is the real guard, so CORS is wide-open by default (CORS_ORIGINS=*):
    // works from any website, app, localhost or file:// page. Server-side callers
    // (Apps Script UrlFetchApp, curl, backends) send no Origin and bypass CORS entirely.
    const origin = req.get('origin')
    const allowAll = cfg.corsOrigins.includes('*')
    let sameOrigin = false
    try { sameOrigin = Boolean(origin) && new URL(origin).host === req.get('host') } catch { /* malformed origin */ }
    cors({
      credentials: false,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      // reflect whatever headers the client asks for so any app works; fall back to the known set
      allowedHeaders: req.get('access-control-request-headers')?.split(',').map(value => value.trim()) || ['content-type', 'x-api-key', 'authorization', 'x-request-id'],
      origin: (value, callback) => {
        if (!value || allowAll || sameOrigin || cfg.corsOrigins.includes(value)) return callback(null, true)
        callback(new Error('CORS_ORIGIN_DENIED'))
      }
    })(req, res, next)
  })
  app.use(express.json({ limit: '1mb', strict: true }))
  app.use(express.urlencoded({ extended: false, limit: '100kb' }))

  app.use((req, res, next) => {
    res.set('cache-control', 'no-store')
    res.on('finish', () => {
      logs.write(res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', 'http', 'request completed', {
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(Number(process.hrtime.bigint() - req.startAt) / 1e6)
      }, { requestId: req.id, apiKeyId: req.apiKey?.id })
    })
    next()
  })

  app.use(express.static(publicDir, {
    etag: true,
    maxAge: cfg.isProduction ? '1h' : 0,
    index: 'index.html'
  }))
  app.get('/healthz', (req, res) => ok(res, { status: 'ok', whatsapp: whatsapp.getStatus().status }))

  // Public auth routes (no API key required) — register and login only
  app.use('/api/auth', createPublicAuthRouter({ users, teams, apiKeys, audit }))

  app.use('/api', limiter({
    windowMs: cfg.apiRateLimitWindowMs,
    limit: cfg.apiRateLimitMax * 10,
    skip: req => !isMonitor(req)
  }))
  app.use('/api', limiter({
    windowMs: cfg.apiRateLimitWindowMs,
    limit: cfg.apiRateLimitMax * 3,
    skip: isMonitor
  }))
  app.use('/api', apiKeyAuth(apiKeys))

  // Tenant enrichment — adds user_id, team_id, teamRole to req.apiKey
  app.use('/api', enrichApiKey(apiKeys), resolveTeamRole(teams))

  app.use('/api', limiter({
    windowMs: cfg.apiRateLimitWindowMs,
    limit: cfg.apiRateLimitMax,
    keyGenerator: req => req.apiKey.id,
    skip: isMonitor
  }))
  app.use('/api/admin', limiter({
    windowMs: cfg.apiRateLimitWindowMs,
    limit: cfg.adminRateLimitMax,
    keyGenerator: req => req.apiKey.id
  }))

  // Analytics tracking (non-blocking, fires after response)
  app.use('/api', (req, res, next) => {
    res.on('finish', () => {
      const keyId = req.apiKey?.id || 'anonymous'
      const skipPaths = ['/api/qr', '/api/status', '/api/me', '/api/server-info', '/api/docs', '/api/docs.json']
      if (!skipPaths.some(p => req.path.startsWith(p)) && res.statusCode < 500) {
        trackEvent(keyId, 'api_request', {
          method: req.method,
          path: req.path.split('/').slice(0, 4).join('/'),
          status: res.statusCode,
          duration: Math.round(Number(process.hrtime.bigint() - req.startAt) / 1e6)
        })
      }
    })
    next()
  })

  app.get('/api/me', (req, res) => ok(res, {
    id: req.apiKey.id,
    name: req.apiKey.name,
    role: req.apiKey.role,
    prefix: req.apiKey.prefix,
    expiresAt: req.apiKey.expiresAt || null,
    teamId: req.apiKey.teamId || null,
    userId: req.apiKey.userId || null
  }))
  app.get('/api/server-info', asyncHandler(async (req, res) => ok(res, {
    domain: cfg.publicDomain || null,
    ip: cfg.publicIp || await getPublicIp(),
    port: cfg.port || null
  })))
  app.use('/api/admin', createAdminRouter(apiKeys))
  
  // Super admin routes (requires admin API key)
  if (superAdmin) {
    app.use('/api/super-admin', createSuperAdminRouter({ superAdmin, audit }))
  }
  app.use('/api', createWhatsAppRouter(whatsapp))
  app.get('/api/campaigns/recent', asyncHandler(async (req, res) => {
    const campaignDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'campaigns')
    let files = []
    try {
      files = readdirSync(campaignDir)
        .filter(f => f.startsWith('campaign-') && f.endsWith('.json'))
        .map(f => ({ name: f, mtime: statSync(path.join(campaignDir, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 20)
    } catch {
      // campaigns dir may not exist
    }
    const reports = files.map(f => {
      try {
        const raw = readFileSync(path.join(campaignDir, f.name), 'utf-8')
        const data = JSON.parse(raw)
        return {
          file: f.name,
          campaign: data.campaign || null,
          time: data.time || null,
          total: data.total ?? null,
          success: data.success ?? null,
          failed: data.failed ?? null,
          resultsCount: Array.isArray(data.results) ? data.results.length : null
        }
      } catch {
        return { file: f.name, campaign: null, time: null, total: null, success: null, failed: null, resultsCount: null }
      }
    })
    ok(res, { totalCampaigns: files.length, reports })
  }))
  // Quota enforcement — intercepts send endpoints
  app.use('/api', enforceQuota({ billing, webhooks }))

  app.use('/api', createMessagingRouter(whatsapp, cfg))

  // Protected auth, team, and billing routes (require API key + tenant enrichment)
  app.use('/api/auth', createProtectedAuthRouter({ users, teams }))
  app.use('/api/team', createTeamRouter({ teams, apiKeys, audit }))
  app.use('/api/billing', createBillingRouter({ billing, audit }))
  app.use('/api/webhooks', createWebhookRouter({ webhooks, audit }))
  app.use('/api/schedule', createSchedulingRouter({ scheduler, audit }))
  app.use('/api/contacts', createContactRouter({ contacts, audit }))
  app.use('/api/ab-tests', createABTestRouter({ abTests, audit }))
  app.use('/api/branding', createBrandingRouter({ branding }))
  app.use('/api/reports', createReportingRouter({ reports, audit }))

  // Queue status
  app.get('/api/queue/stats', (req, res) => ok(res, queue.getStats()))

  // Backup
  app.post('/api/backup', asyncHandler(async (req, res) => {
    const result = backup.createBackup()
    ok(res, result)
  }))
  app.get('/api/backup/info', asyncHandler(async (req, res) => {
    ok(res, backup.getInfo())
  }))
  app.get('/api/backup/list', asyncHandler(async (req, res) => {
    ok(res, backup.listBackups())
  }))
  app.post('/api/backup/restore', asyncHandler(async (req, res) => {
    const { path: backupPath } = req.body
    if (!backupPath) return fail(res, 400, 'MISSING_PATH', 'Backup path is required')
    const result = backup.restore(backupPath)
    ok(res, result)
  }))

  // API key management
  app.post('/api/admin/keys/rotate', asyncHandler(async (req, res) => {
    const { id } = req.body
    if (!id) return fail(res, 400, 'MISSING_ID', 'Key ID is required')
    const result = apiKeys.rotate(id)
    ok(res, result)
  }))
  app.post('/api/admin/keys/extend', asyncHandler(async (req, res) => {
    const { id, days } = req.body
    if (!id) return fail(res, 400, 'MISSING_ID', 'Key ID is required')
    const result = apiKeys.extendExpiry(id, days || 90)
    ok(res, result)
  }))

  app.use(notFound)
  app.use(errorHandler(logs))
  if (isSentryEnabled()) {
    app.use(getSentry().Handlers.errorHandler())
  }
  return app
}
