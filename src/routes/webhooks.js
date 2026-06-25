import { Router } from 'express'
import { requireTeamMember } from '../middleware/tenant.js'
import { asyncHandler, AppError } from '../utils/errors.js'
import { ok } from '../utils/response.js'

export const createWebhookRouter = ({ webhooks, audit }) => {
  const router = Router()
  router.use(requireTeamMember)

  router.get('/', asyncHandler(async (req, res) => {
    const list = webhooks.list(req.apiKey.teamId)
    ok(res, list)
  }))

  router.get('/:id', asyncHandler(async (req, res) => {
    const wh = webhooks.get(req.apiKey.teamId, req.params.id)
    if (!wh) throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook not found')
    ok(res, wh)
  }))

  router.post('/', asyncHandler(async (req, res) => {
    const { name, url, events, secret } = req.body
    if (!name || !url || !events?.length) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Name, url, and events are required')
    }
    const wh = webhooks.create(req.apiKey.teamId, { name, url, events, secret })
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'webhook.created', resource: 'webhook', resourceId: wh.id
    })
    ok(res, wh, 201)
  }))

  router.put('/:id', asyncHandler(async (req, res) => {
    const wh = webhooks.update(req.apiKey.teamId, req.params.id, req.body)
    if (!wh) throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook not found')
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'webhook.updated', resource: 'webhook', resourceId: wh.id
    })
    ok(res, wh)
  }))

  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = webhooks.remove(req.apiKey.teamId, req.params.id)
    if (!removed) throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook not found')
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'webhook.deleted', resource: 'webhook', resourceId: req.params.id
    })
    ok(res, { deleted: true })
  }))

  router.get('/:id/deliveries', asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100)
    const deliveries = webhooks.getDeliveries(req.apiKey.teamId, req.params.id, limit)
    if (deliveries === null) throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'Webhook not found')
    ok(res, deliveries)
  }))

  return router
}
