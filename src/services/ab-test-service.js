import { randomUUID } from 'node:crypto'

export class ABTestService {
  constructor({ db, whatsapp, webhooks, logger }) {
    this.db = db
    this.whatsapp = whatsapp
    this.webhooks = webhooks
    this.logger = logger

    this.stmtCreateTest = db.prepare(`
      INSERT INTO ab_tests (id, team_id, name, description, variants_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?)
    `)
    this.stmtUpdateTest = db.prepare(`
      UPDATE ab_tests SET name=?, description=?, variants_json=?, status=?, updated_at=? WHERE id=? AND team_id=?
    `)
    this.stmtFindTest = db.prepare('SELECT * FROM ab_tests WHERE id=? AND team_id=?')
    this.stmtListTests = db.prepare('SELECT * FROM ab_tests WHERE team_id=? ORDER BY created_at DESC')
    this.stmtDeleteTest = db.prepare('DELETE FROM ab_tests WHERE id=? AND team_id=?')

    this.stmtInsertResult = db.prepare(`
      INSERT INTO ab_test_results (id, test_id, team_id, variant_index, recipient, message_id, status, delivered_at, read_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    this.stmtUpdateResult = db.prepare(`
      UPDATE ab_test_results SET status=?, delivered_at=?, read_at=? WHERE id=?
    `)
    this.stmtResultsByTest = db.prepare('SELECT * FROM ab_test_results WHERE test_id=? ORDER BY created_at ASC')
    this.stmtStatsByVariant = db.prepare(`
      SELECT variant_index, COUNT(*) AS sent,
        SUM(CASE WHEN status='delivered' OR status='read' THEN 1 ELSE 0 END) AS delivered,
        SUM(CASE WHEN status='read' THEN 1 ELSE 0 END) AS read_count
      FROM ab_test_results WHERE test_id=? GROUP BY variant_index
    `)
  }

  list(teamId) {
    return this.stmtListTests.all(teamId).map(row => this._formatTest(row))
  }

  get(teamId, id) {
    const row = this.stmtFindTest.get(id, teamId)
    return row ? this._formatTest(row) : null
  }

  create(teamId, { name, description, variants }) {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.stmtCreateTest.run(id, teamId, name, description || '', JSON.stringify(variants), now, now)
    return this.get(teamId, id)
  }

  update(teamId, id, data) {
    const existing = this.stmtFindTest.get(id, teamId)
    if (!existing) return null
    const now = new Date().toISOString()
    this.stmtUpdateTest.run(
      data.name ?? existing.name,
      data.description ?? existing.description,
      data.variants ? JSON.stringify(data.variants) : existing.variants_json,
      data.status ?? existing.status,
      now, id, teamId
    )
    return this.get(teamId, id)
  }

  remove(teamId, id) {
    const existing = this.stmtFindTest.get(id, teamId)
    if (!existing) return false
    this.stmtDeleteTest.run(id, teamId)
    return true
  }

  start(teamId, id) {
    const test = this.get(teamId, id)
    if (!test) return null
    if (test.status !== 'draft') return null
    return this.update(teamId, id, { status: 'running' })
  }

  async sendVariant(teamId, testId, variantIndex, recipient, apiKeyId) {
    const test = this.get(teamId, testId)
    if (!test || test.status !== 'running') return null
    const variant = test.variants[variantIndex]
    if (!variant) return null

    const resultId = randomUUID()
    const now = new Date().toISOString()
    this.stmtInsertResult.run(resultId, testId, teamId, variantIndex, recipient, null, 'sent', null, null, now)

    try {
      const sendResult = await this.whatsapp.send({
        to: recipient,
        type: variant.type || 'text',
        content: variant.content,
        payload: variant.payload || variant.content,
        apiKeyId
      })
      this.stmtUpdateResult.run('sent', null, null, resultId)
      this.db.prepare('UPDATE ab_test_results SET message_id=? WHERE id=?').run(sendResult.waMessageId, resultId)
      this.webhooks.dispatch(teamId, 'ab_test.sent', {
        testId, variantIndex, recipient, waMessageId: sendResult.waMessageId
      }).catch(() => {})
      return { resultId, waMessageId: sendResult.waMessageId }
    } catch (error) {
      this.stmtUpdateResult.run('failed', null, null, resultId)
      return { resultId, error: error.message }
    }
  }

  getResults(teamId, id) {
    const test = this.stmtFindTest.get(id, teamId)
    if (!test) return null
    const stats = this.stmtStatsByVariant.all(id)
    const results = this.stmtResultsByTest.all(id).map(r => ({
      id: r.id,
      variantIndex: r.variant_index,
      recipient: r.recipient,
      status: r.status,
      sentAt: r.created_at,
      deliveredAt: r.delivered_at,
      readAt: r.read_at
    }))
    return { stats, results }
  }

  _formatTest(row) {
    const variants = JSON.parse(row.variants_json || '[]')
    const stats = this.stmtStatsByVariant.all(row.id)
    return {
      id: row.id,
      teamId: row.team_id,
      name: row.name,
      description: row.description,
      variants,
      status: row.status,
      stats,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }
  }
}
