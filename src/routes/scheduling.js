import { Router } from 'express'
import { z } from 'zod'
import { requireTeamMember } from '../middleware/tenant.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler, AppError } from '../utils/errors.js'
import { ok } from '../utils/response.js'

const createSchema = z.object({
  recipient: z.string().trim().min(8).max(80),
  messageType: z.enum(['text', 'image', 'document', 'audio', 'location']),
  payload: z.record(z.string(), z.any()),
  scheduledAt: z.string().refine(value => !isNaN(Date.parse(value)), 'Invalid date')
})

export const createSchedulingRouter = ({ scheduler, audit }) => {
  const router = Router()
  router.use(requireTeamMember)

  router.get('/', asyncHandler(async (req, res) => {
    ok(res, scheduler.list(req.apiKey.teamId))
  }))

  router.get('/:id', asyncHandler(async (req, res) => {
    const msg = scheduler.get(req.apiKey.teamId, req.params.id)
    if (!msg) throw new AppError(404, 'SCHEDULED_NOT_FOUND', 'Scheduled message not found')
    ok(res, msg)
  }))

  router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
    const scheduledAt = new Date(req.body.scheduledAt).toISOString()
    if (new Date(scheduledAt) <= new Date()) {
      throw new AppError(400, 'PAST_DATE', 'Scheduled time must be in the future')
    }
    const msg = scheduler.create(req.apiKey.teamId, req.apiKey.id, { ...req.body, scheduledAt })
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'scheduled.created', resource: 'scheduled_message', resourceId: msg.id
    })
    ok(res, msg, 201)
  }))

  router.post('/:id/cancel', asyncHandler(async (req, res) => {
    const canceled = scheduler.cancel(req.apiKey.teamId, req.params.id)
    if (!canceled) throw new AppError(404, 'SCHEDULED_NOT_FOUND', 'Scheduled message not found or already sent')
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'scheduled.canceled', resource: 'scheduled_message', resourceId: req.params.id
    })
    ok(res, { canceled: true })
  }))

  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = scheduler.remove(req.apiKey.teamId, req.params.id)
    if (!removed) throw new AppError(404, 'SCHEDULED_NOT_FOUND', 'Scheduled message not found')
    ok(res, { deleted: true })
  }))

  return router
}
