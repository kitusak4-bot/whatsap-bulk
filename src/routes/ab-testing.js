import { Router } from 'express'
import { z } from 'zod'
import { requireTeamMember } from '../middleware/tenant.js'
import { validate } from '../middleware/validate.js'
import { asyncHandler, AppError } from '../utils/errors.js'
import { ok } from '../utils/response.js'

const variantSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.enum(['text', 'image', 'document', 'audio', 'location']),
  content: z.record(z.string(), z.any()),
  payload: z.record(z.string(), z.any()).optional()
})

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().default(''),
  variants: z.array(variantSchema).min(2).max(10)
})

export const createABTestRouter = ({ abTests, audit }) => {
  const router = Router()
  router.use(requireTeamMember)

  router.get('/', asyncHandler(async (req, res) => {
    ok(res, abTests.list(req.apiKey.teamId))
  }))

  router.get('/:id', asyncHandler(async (req, res) => {
    const test = abTests.get(req.apiKey.teamId, req.params.id)
    if (!test) throw new AppError(404, 'ABTEST_NOT_FOUND', 'A/B test not found')
    ok(res, test)
  }))

  router.post('/', validate(createSchema), asyncHandler(async (req, res) => {
    const test = abTests.create(req.apiKey.teamId, req.body)
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'ab_test.created', resource: 'ab_test', resourceId: test.id
    })
    ok(res, test, 201)
  }))

  router.put('/:id', asyncHandler(async (req, res) => {
    const test = abTests.update(req.apiKey.teamId, req.params.id, req.body)
    if (!test) throw new AppError(404, 'ABTEST_NOT_FOUND', 'A/B test not found')
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'ab_test.updated', resource: 'ab_test', resourceId: test.id
    })
    ok(res, test)
  }))

  router.delete('/:id', asyncHandler(async (req, res) => {
    const removed = abTests.remove(req.apiKey.teamId, req.params.id)
    if (!removed) throw new AppError(404, 'ABTEST_NOT_FOUND', 'A/B test not found')
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'ab_test.deleted', resource: 'ab_test', resourceId: req.params.id
    })
    ok(res, { deleted: true })
  }))

  router.post('/:id/start', asyncHandler(async (req, res) => {
    const test = abTests.start(req.apiKey.teamId, req.params.id)
    if (!test) throw new AppError(400, 'INVALID_STATE', 'Test must be in draft state to start')
    audit.write({
      teamId: req.apiKey.teamId, userId: req.apiKey.userId, apiKeyId: req.apiKey.id,
      action: 'ab_test.started', resource: 'ab_test', resourceId: test.id
    })
    ok(res, test)
  }))

  router.post('/:id/send', asyncHandler(async (req, res) => {
    const { variantIndex, recipient } = req.body
    if (variantIndex === undefined || !recipient) {
      throw new AppError(400, 'VALIDATION_ERROR', 'variantIndex and recipient are required')
    }
    const result = await abTests.sendVariant(req.apiKey.teamId, req.params.id, variantIndex, recipient, req.apiKey.id)
    if (result === null) throw new AppError(404, 'ABTEST_NOT_FOUND', 'Test not found or not running')
    ok(res, result, 201)
  }))

  router.get('/:id/results', asyncHandler(async (req, res) => {
    const results = abTests.getResults(req.apiKey.teamId, req.params.id)
    if (results === null) throw new AppError(404, 'ABTEST_NOT_FOUND', 'Test not found')
    ok(res, results)
  }))

  return router
}
