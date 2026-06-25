import { Router } from 'express'
import { requireTeamMember } from '../middleware/tenant.js'
import { asyncHandler } from '../utils/errors.js'
import { ok } from '../utils/response.js'

export const createBillingRouter = ({ billing, audit }) => {
  const router = Router()
  router.use(requireTeamMember)

  router.get('/plans', asyncHandler(async (req, res) => {
    ok(res, { plans: billing.listPlans() })
  }))

  router.get('/subscription', asyncHandler(async (req, res) => {
    const sub = billing.getSubscription(req.apiKey.teamId)
    const plan = billing.getPlan(sub.plan_id)
    const usage = billing.getUsage(req.apiKey.teamId)
    const quota = await billing.checkQuota(req.apiKey.teamId)
    ok(res, {
      subscription: {
        id: sub.id,
        planId: sub.plan_id,
        status: sub.status,
        trialEnd: sub.trial_end,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        canceledAt: sub.canceled_at
      },
      plan,
      usage,
      quota
    })
  }))

  router.get('/usage', asyncHandler(async (req, res) => {
    const usage = billing.getUsage(req.apiKey.teamId)
    const quota = await billing.checkQuota(req.apiKey.teamId)
    ok(res, { usage, quota })
  }))

  router.post('/checkout', asyncHandler(async (req, res) => {
    const { planId } = req.body
    if (!planId) return ok(res, { error: 'planId is required' }, 400)

    const baseUrl = `${req.protocol}://${req.get('host')}`
    const result = await billing.createCheckoutSession({
      teamId: req.apiKey.teamId,
      planId,
      successUrl: `${baseUrl}/dashboard?billing=success`,
      cancelUrl: `${baseUrl}/dashboard?billing=canceled`
    })

    audit.write({
      teamId: req.apiKey.teamId,
      userId: req.apiKey.userId,
      action: 'billing.checkout',
      resource: 'subscription',
      details: { planId, mock: result.mock || false }
    })

    ok(res, result)
  }))

  router.post('/portal', asyncHandler(async (req, res) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`
    const result = await billing.createPortalSession({
      teamId: req.apiKey.teamId,
      returnUrl: `${baseUrl}/dashboard`
    })
    ok(res, result)
  }))

  router.post('/change-plan', asyncHandler(async (req, res) => {
    const { planId } = req.body
    if (!planId) return ok(res, { error: 'planId is required' }, 400)

    const result = billing.changePlan(req.apiKey.teamId, planId)

    audit.write({
      teamId: req.apiKey.teamId,
      userId: req.apiKey.userId,
      action: 'billing.change_plan',
      resource: 'subscription',
      resourceId: result.planId,
      details: { planId }
    })

    ok(res, result)
  }))

  router.post('/cancel', asyncHandler(async (req, res) => {
    const result = billing.cancelSubscription(req.apiKey.teamId)

    audit.write({
      teamId: req.apiKey.teamId,
      userId: req.apiKey.userId,
      action: 'billing.cancel',
      resource: 'subscription',
      details: {}
    })

    ok(res, result)
  }))

  router.post('/webhook', asyncHandler(async (req, res) => {
    const signature = req.get('stripe-signature')
    if (!signature) return ok(res, { error: 'Missing stripe-signature header' }, 400)
    const rawBody = req.body instanceof Buffer ? req.body : JSON.stringify(req.body)
    const result = billing.handleWebhook(rawBody, signature)
    ok(res, result)
  }))

  return router
}
