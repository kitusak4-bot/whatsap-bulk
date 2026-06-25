import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'

export class BackupService {
  constructor({ db, cfg, logger }) {
    this.db = db
    this.cfg = cfg
    this.logger = logger
    this._backupDir = path.resolve(cfg.backupDir || './backups')
  }

  createBackup(destination) {
    const now = new Date()
    const timestamp = now.toISOString().replace(/[:.]/g, '-')
    const backupPath = destination || path.join(this._backupDir, `baileys-backup-${timestamp}.sqlite`)

    fs.mkdirSync(path.dirname(backupPath), { recursive: true })

    // Force WAL checkpoint to ensure all data is in the main file
    this.db.pragma('wal_checkpoint(TRUNCATE)')

    // Create a snapshot backup using VACUUM INTO (SQLite 3.27+)
    this.db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`)

    const stats = fs.statSync(backupPath)
    this.logger.info({ backupPath, sizeBytes: stats.size, timestamp }, 'Backup created')

    // Rotate old backups
    this._rotate()

    return { path: backupPath, sizeBytes: stats.size, timestamp }
  }

  restore(backupPath) {
    const resolved = path.resolve(backupPath)
    if (!fs.existsSync(resolved)) {
      throw new Error(`Backup file not found: ${resolved}`)
    }

    const dbPath = this.cfg.databasePath
    if (!dbPath || dbPath === ':memory:') {
      throw new Error('Cannot restore to in-memory database')
    }

    this.logger.warn({ backupPath: resolved, dbPath }, 'Restoring database from backup')

    // Close existing connection
    this.db.close()

    // Copy backup over the live database
    fs.copyFileSync(resolved, dbPath)

    // Reopen the database
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    this.db.pragma('foreign_keys = ON')

    this.logger.info({ backupPath: resolved, dbPath }, 'Database restored successfully')
    return { message: 'Database restored successfully', databasePath: dbPath }
  }

  listBackups() {
    try {
      return fs.readdirSync(this._backupDir)
        .filter(f => f.endsWith('.sqlite'))
        .map(f => {
          const stats = fs.statSync(path.join(this._backupDir, f))
          return { name: f, sizeBytes: stats.size, createdAt: stats.mtime.toISOString() }
        })
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    } catch {
      return []
    }
  }

  getInfo() {
    const dbPath = this.cfg.databasePath
    let stats
    let sizeBytes = 0
    let lastModified = new Date().toISOString()
    try {
      stats = fs.statSync(dbPath)
      sizeBytes = stats.size
      lastModified = stats.mtime.toISOString()
    } catch {
      // In-memory database — report zero size
    }
    const walSize = dbPath !== ':memory:' && fs.existsSync(dbPath + '-wal') ? fs.statSync(dbPath + '-wal').size : 0
    const shmSize = dbPath !== ':memory:' && fs.existsSync(dbPath + '-shm') ? fs.statSync(dbPath + '-shm').size : 0
    return {
      databasePath: dbPath,
      sizeBytes,
      walSizeBytes: walSize,
      shmSizeBytes: shmSize,
      totalSizeBytes: sizeBytes + walSize + shmSize,
      lastModified,
      backupCount: this.listBackups().length
    }
  }

  _rotate() {
    const retention = this.cfg.backupRetentionDays || 30
    const cutoff = Date.now() - retention * 86400000
    try {
      for (const f of fs.readdirSync(this._backupDir)) {
        if (!f.endsWith('.sqlite')) continue
        const p = path.join(this._backupDir, f)
        const mtime = fs.statSync(p).mtimeMs
        if (mtime < cutoff) {
          fs.unlinkSync(p)
          this.logger.info({ file: f }, 'Removed expired backup')
        }
      }
    } catch { /* ignore */ }
  }
}
