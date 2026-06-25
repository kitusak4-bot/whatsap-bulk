import { Router } from 'express'
import { requireTeamMember } from '../middleware/tenant.js'
import { asyncHandler } from '../utils/errors.js'
import { ok } from '../utils/response.js'

export const createReportingRouter = ({ reports, audit }) => {
  const router = Router()
  router.use(requireTeamMember)

  router.get('/messages', asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365)
    const stats = reports.getMessageStats(req.apiKey.teamId, days)
    const daily = reports.getDailyVolume(req.apiKey.teamId, days)
    ok(res, { stats, daily, days })
  }))

  router.get('/usage', asyncHandler(async (req, res) => {
    const summary = reports.getUsageSummary(req.apiKey.teamId)
    ok(res, summary)
  }))

  router.get('/audit', asyncHandler(async (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365)
    const data = reports.getAuditSummary(req.apiKey.teamId, days)
    ok(res, { actions: data, days })
  }))

  router.get('/export/audit', asyncHandler(async (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'json'
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365)
    const since = new Date(Date.now() - days * 86400000).toISOString()
    const logs = audit.db.prepare(`
      SELECT id, action, resource, resource_id, details_json, created_at
      FROM audit_logs WHERE team_id = ? AND created_at >= ? ORDER BY created_at DESC
    `).all(req.apiKey.teamId, since)

    if (format === 'csv') {
      const header = 'id,action,resource,resource_id,details,created_at\n'
      const rows = logs.map(l =>
        `"${l.id}","${l.action}","${l.resource}","${l.resource_id}","${(l.details_json || '').replace(/"/g, '""')}","${l.created_at}"`
      ).join('\n')
      res.set({
        'content-type': 'text/csv',
        'content-disposition': `attachment; filename="audit-export-${Date.now()}.csv"`
      })
      return res.send(header + rows)
    }

    ok(res, logs)
  }))

  return router
}
