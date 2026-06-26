/**
 * Developed by Mohammad Rameez Imdad (Rameez Scripts)
 * WhatsApp: https://wa.me/923224083545 (For Custom Projects)
 * YouTube: https://www.youtube.com/@rameezimdad (Subscribe for more!)
 */

import 'dotenv/config'
import { createServer } from 'node:http'
import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { createDatabase, schema, ensureSuperAdmin } from './db/database.js'
import { createLogger } from './logger.js'
import { ApiKeyService } from './services/api-key-service.js'
import { SqliteAuthStore } from './services/auth-store.js'
import { LogService } from './services/log-service.js'
import { MessageRepository } from './services/message-repository.js'
import { WhatsAppService } from './services/whatsapp-service.js'
import { initSentry } from './services/sentry.js'
import { initAnalytics, shutdownAnalytics } from './services/analytics.js'
import { createDemoAccount } from './services/demo-account.js'
import { UserService } from './services/user-service.js'
import { TeamService } from './services/team-service.js'
import { AuditService } from './services/audit-service.js'
import { BillingService } from './services/billing-service.js'
import { WebhookService } from './services/webhook-service.js'
import { SchedulerService } from './services/scheduler-service.js'
import { ContactService } from './services/contact-service.js'
import { ABTestService } from './services/ab-test-service.js'
import { WhiteLabelService } from './services/white-label-service.js'
import { QueueService } from './services/queue-service.js'
import { RedisQueueService } from './services/redis-queue-service.js'
import { RateLimiter } from './services/rate-limiter.js'
import { ReportingService } from './services/reporting-service.js'
import { BackupService } from './services/backup-service.js'
import { SuperAdminService } from './services/super-admin-service.js'
import { PostgresAdapter } from './db/postgres-adapter.js'

const cfg = loadConfig()
const logger = createLogger(cfg)
initSentry(cfg, logger)
initAnalytics(cfg, logger)
const db = createDatabase(cfg.databasePath)
const logs = new LogService(db, logger)
logs.prune(cfg.logRetentionDays)
const maintenanceTimer = setInterval(() => logs.prune(cfg.logRetentionDays), 86400000)
maintenanceTimer.unref()
const apiKeys = new ApiKeyService(db, cfg.apiKeyPepper, cfg.adminApiKey, logs)
const demo = createDemoAccount(apiKeys, cfg)
if (demo.enabled) {
  logger.info({ keyId: demo.demoKeyId, restrictions: demo.info.restrictions }, 'Demo account created')
}
const authStore = new SqliteAuthStore(db)
const messages = new MessageRepository(db)
const whatsapp = new WhatsAppService({ authStore, messages, logs, logger, cfg })
const users = new UserService(db)
const teams = new TeamService(db)
const audit = new AuditService(db)

// Create super admin on first launch
ensureSuperAdmin(db, users, teams, apiKeys, logs)
const billing = new BillingService({ db, cfg, logger })
const webhooks = new WebhookService({ db, cfg, logger })
const scheduler = new SchedulerService({ db, whatsapp, webhooks, logger })
const contacts = new ContactService(db)
const abTests = new ABTestService({ db, whatsapp, webhooks, logger })
const branding = new WhiteLabelService(db)
const queue = cfg.useRedisQueue && cfg.redisUrl
  ? new RedisQueueService({ redisUrl: cfg.redisUrl, logger })
  : new QueueService({ db, logger })

// Connect to PostgreSQL if configured (for migration/analytics)
let pg = null
if (cfg.databaseType === 'postgres' && cfg.pgConnectionString) {
  pg = new PostgresAdapter(cfg.pgConnectionString)
  pg.migrate(schema).catch(err => logger.error({ err }, 'PostgreSQL migration failed'))
}
const rateLimiter = new RateLimiter(db)
const reports = new ReportingService(db)
const backup = new BackupService({ db, cfg, logger })
const superAdmin = new SuperAdminService(db)
const app = createApp({ cfg, logger, logs, apiKeys, whatsapp, users, teams, audit, billing, webhooks, scheduler, contacts, abTests, branding, queue, rateLimiter, reports, backup, superAdmin })
const server = createServer(app)

server.requestTimeout = 30000
server.headersTimeout = 15000
server.keepAliveTimeout = 5000
server.maxRequestsPerSocket = 1000

server.listen(cfg.port, cfg.host, () => {
  logs.write('info', 'system', 'API server started', { host: cfg.host, port: cfg.port, env: cfg.env })
  scheduler.startPolling(cfg.schedulerPollIntervalMs)
  const webhookRetryTimer = setInterval(() => webhooks.retryPending({ queue }), cfg.webhookRetryIntervalMs)
  webhookRetryTimer.unref()
  queue.startPolling(cfg.queuePollIntervalMs, cfg.queueConcurrency)
  const queueCleanupTimer = setInterval(() => queue.cleanup(cfg.backupRetentionDays), 86400000)
  queueCleanupTimer.unref()
  whatsapp.start().catch(error => {
    logs.write('error', 'whatsapp', 'initial connection failed', { error: error.message })
  })
})

let shuttingDown = false
const shutdown = async signal => {
  if (shuttingDown) return
  shuttingDown = true
  logs.write('info', 'system', 'server shutdown started', { signal })

  const forceExit = setTimeout(() => {
    logger.fatal('forced shutdown after timeout')
    process.exit(1)
  }, 15000)
  forceExit.unref()

  server.closeIdleConnections() // keep-alive sockets would stall close()
  server.close(async error => {
    if (error) logger.error({ err: error }, 'HTTP server close failed')
    clearInterval(maintenanceTimer)
    await whatsapp.stop().catch(stopError => logger.error({ err: stopError }, 'WhatsApp shutdown failed'))
    await shutdownAnalytics().catch(() => {})
    db.close()
    logger.info('server shutdown complete')
    logger.flush()
    clearTimeout(forceExit)
    process.exit(error ? 1 : 0)
  })
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('uncaughtException', error => {
  logger.fatal({ err: error }, 'uncaught exception')
  shutdown('uncaughtException')
})
process.on('unhandledRejection', error => {
  logger.error({ err: error }, 'unhandled rejection')
})
