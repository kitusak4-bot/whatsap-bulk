/**
 * Horizontal worker entrypoint.
 * Processes job queues independently of the API server.
 * Start with:  node src/worker.js
 * Scale with:  WORKER_CONCURRENCY=10 node src/worker.js
 */
import 'dotenv/config'
import { loadConfig } from './config.js'
import { createDatabase } from './db/database.js'
import { createLogger } from './logger.js'
import { QueueService } from './services/queue-service.js'
import { RedisQueueService } from './services/redis-queue-service.js'

const cfg = loadConfig()
const logger = createLogger(cfg)

let queue

if (cfg.useRedisQueue && cfg.redisUrl) {
  queue = new RedisQueueService({ redisUrl: cfg.redisUrl, logger })
  logger.info('Worker using Redis queue backend')
} else {
  const db = createDatabase(cfg.databasePath)
  queue = new QueueService({ db, logger })
  logger.info('Worker using SQLite queue backend')
}

queue.startPolling(cfg.queuePollIntervalMs, cfg.queueConcurrency)

logger.info({ concurrency: cfg.queueConcurrency, intervalMs: cfg.queuePollIntervalMs }, 'Worker started')

process.on('SIGTERM', () => {
  logger.info('Worker shutting down…')
  queue.stop()
  process.exit(0)
})

process.on('SIGINT', () => {
  logger.info('Worker shutting down…')
  queue.stop()
  process.exit(0)
})
