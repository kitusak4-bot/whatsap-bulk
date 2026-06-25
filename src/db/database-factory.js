import { createDatabase } from './database.js'
import { PostgresAdapter } from './postgres-adapter.js'

export const createDatabaseOrConnect = (cfg, logger) => {
  if (cfg.databaseType === 'postgres' && cfg.pgConnectionString) {
    logger.info('Connecting to PostgreSQL…')
    return { type: 'postgres', adapter: new PostgresAdapter(cfg.pgConnectionString) }
  }
  const db = createDatabase(cfg.databasePath)
  return { type: 'sqlite', db }
}
