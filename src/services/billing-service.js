import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { AppError } from '../utils/errors.js'

export class BillingService {
  constructor({ db, cfg, logger }) {
    this.db = db
    this.cfg = cfg
    this.logger = logger
    this.stripe = null
    this.stripeEnabled = false

    if (cfg.stripeSecretKey) {
      try {
        this.stripe = new Stripe(cfg.stripeSecretKey, { apiVersion: '2025-02-24.acacia' })
        this.stripeEnabled = true
      } catch (error) {
        logger.warn({ err: error.message }, 'Stripe init failed — running in mock mode')
      }
    } else {
      logger.info('No STRIPE_SECRET_KEY — running in mock billing mode')
    }

    this.stmtFindSub = db.prepare('SELECT * FROM subscriptions WHERE team_id = ?')
    this.stmtUpsertSub = db.prepare(`
      INSERT INTO subscriptions (id, team_id, plan_id, stripe_customer_id, stripe_subscription_id, status, current_period_start, current_period_end, trial_end, canceled_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(team_id) DO UPDATE SET plan_id=excluded.plan_id, status=excluded.status, current_period_start=excluded.current_period_start, current_period_end=excluded.current_period_end, trial_end=excluded.trial_end, canceled_at=excluded.canceled_at, updated_at=excluded.updated_at, stripe_subscription_id=excluded.stripe_subscription_id, stripe_customer_id=excluded.stripe_customer_id
    `)
    this.stmtUpdateSub = db.prepare(`
      UPDATE subscriptions SET status=?, plan_id=?, current_period_start=?, current_period_end=?, trial_end=?, canceled_at=?, updated_at=? WHERE team_id=?
    `)
    this.stmtGetUsage = db.prepare(`
      SELECT COALESCE(SUM(messages_sent), 0) AS total FROM usage_records WHERE team_id = ? AND period_start = ? AND period_end = ?
    `)
    this.stmtUpsertUsage = db.prepare(`
      INSERT INTO usage_records (id, team_id, period_start, period_end, messages_sent, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    this.stmtFindUsage = db.prepare('SELECT * FROM usage_records WHERE team_id = ? AND period_start = ? AND period_end = ?')
    this.stmtUpdateUsage = db.prepare('UPDATE usage_records SET messages_sent = messages_sent + ? WHERE team_id = ? AND period_start = ? AND period_end = ?')
    this.stmtListPlans = db.prepare('SELECT * FROM plans ORDER BY sort_order ASC')
    this.stmtFindPlan = db.prepare('SELECT * FROM plans WHERE id = ?')
    this.stmtFindTeam = db.prepare('SELECT * FROM teams WHERE id = ?')
    this.stmtFindUser = db.prepare('SELECT email, name FROM users WHERE id = ?')
  }

  listPlans() {
    return this.stmtListPlans.all().map(p => ({
      id: p.id,
      name: p.name,
      stripePriceId: p.stripe_price_id,
      monthlyLimit: p.monthly_limit,
      teamMembers: p.team_members,
      apiKeysLimit: p.api_keys_limit,
      features: JSON.parse(p.features_json || '[]'),
      priceCents: p.price_cents,
      priceFormatted: '$' + (p.price_cents / 100).toFixed(2),
      sortOrder: p.sort_order
    }))
  }

  getPlan(planId) {
    const p = this.stmtFindPlan.get(planId)
    if (!p) return null
    return {
      id: p.id,
      name: p.name,
      stripePriceId: p.stripe_price_id,
      monthlyLimit: p.monthly_limit,
      teamMembers: p.team_members,
      apiKeysLimit: p.api_keys_limit,
      features: JSON.parse(p.features_json || '[]'),
      priceCents: p.price_cents,
      priceFormatted: '$' + (p.price_cents / 100).toFixed(2)
    }
  }

  getSubscription(teamId) {
    let sub = this.stmtFindSub.get(teamId)
    if (!sub) {
      const now = new Date().toISOString()
      const id = randomUUID()
      this.stmtUpsertSub.run(id, teamId, 'free', null, null, 'active', now, now, null, null, now, now)
      sub = this.stmtFindSub.get(teamId)
    }
    return sub
  }

  getUsage(teamId) {
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
    const row = this.stmtGetUsage.get(teamId, periodStart, periodEnd)
    return { periodStart, periodEnd, messagesSent: row?.total || 0 }
  }

  trackUsage(teamId, count = 1) {
    const now = new Date()
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString()
    const existing = this.stmtFindUsage.get(teamId, periodStart, periodEnd)
    if (existing) {
      this.stmtUpdateUsage.run(count, teamId, periodStart, periodEnd)
    } else {
      const id = randomUUID()
      this.stmtUpsertUsage.run(id, teamId, periodStart, periodEnd, count, now.toISOString())
    }
  }

  async checkQuota(teamId) {
    const sub = this.getSubscription(teamId)
    const plan = this.getPlan(sub.plan_id)
    const usage = this.getUsage(teamId)

    if (!plan) return { allowed: true, plan: null, usage }

    const allowed = usage.messagesSent < plan.monthlyLimit
    return {
      allowed,
      plan: { id: plan.id, name: plan.name, monthlyLimit: plan.monthlyLimit },
      usage,
      remaining: Math.max(0, plan.monthlyLimit - usage.messagesSent),
      exceeded: usage.messagesSent >= plan.monthlyLimit,
      percentage: plan.monthlyLimit > 0 ? Math.round((usage.messagesSent / plan.monthlyLimit) * 100) : 0
    }
  }

  async createCheckoutSession({ teamId, planId, successUrl, cancelUrl }) {
    const plan = this.getPlan(planId)
    if (!plan) throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan not found')
    if (plan.priceCents === 0) {
      this.changePlan(teamId, 'free')
      return { url: null, sessionId: null, free: true }
    }

    if (!this.stripeEnabled) {
      this.changePlan(teamId, planId)
      return { url: null, sessionId: 'mock_ses_' + randomUUID(), free: false, mock: true }
    }

    const sub = this.getSubscription(teamId)
    let customerId = sub.stripe_customer_id
    if (!customerId) {
      const team = this.stmtFindTeam.get(teamId)
      const owner = team ? this.stmtFindUser.get(team.owner_id) : null
      const customer = await this.stripe.customers.create({
        email: owner?.email,
        name: owner?.name || team?.name,
        metadata: { team_id: teamId }
      })
      customerId = customer.id
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: plan.stripePriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      subscription_data: {
        trial_period_days: this.cfg.stripeTrialDays || 14,
        metadata: { team_id: teamId, plan_id: planId }
      }
    })

    return { url: session.url, sessionId: session.id, free: false }
  }

  async createPortalSession({ teamId, returnUrl }) {
    if (!this.stripeEnabled) {
      return { url: returnUrl, mock: true }
    }

    const sub = this.getSubscription(teamId)
    if (!sub.stripe_customer_id) throw new AppError(400, 'NO_CUSTOMER', 'No Stripe customer found')

    const session = await this.stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: returnUrl
    })

    return { url: session.url }
  }

  handleWebhook(rawBody, signature) {
    if (!this.stripeEnabled) throw new AppError(400, 'STRIPE_DISABLED', 'Stripe is not configured')
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.cfg.stripeWebhookSecret)
    const sub = event.data.object

    switch (event.type) {
      case 'checkout.session.completed': {
        const teamId = sub.metadata?.team_id
        const planId = sub.metadata?.plan_id
        if (teamId && planId) {
          const now = new Date().toISOString()
          const periodStart = new Date(sub.current_period_start * 1000).toISOString()
          const periodEnd = new Date(sub.current_period_end * 1000).toISOString()
          this.stmtUpsertSub.run(sub.id, teamId, planId, sub.customer, sub.subscription, 'active', periodStart, periodEnd, null, null, now, now)
        }
        break
      }
      case 'customer.subscription.updated': {
        const teamId = sub.metadata?.team_id
        if (teamId) {
          const now = new Date().toISOString()
          const status = sub.status === 'active' || sub.status === 'trialing' ? sub.status : 'past_due'
          const periodStart = new Date(sub.current_period_start * 1000).toISOString()
          const periodEnd = new Date(sub.current_period_end * 1000).toISOString()
          const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null
          this.stmtUpdateSub.run(status, sub.items?.data?.[0]?.price?.metadata?.plan_id || 'pro', periodStart, periodEnd, trialEnd, null, now, teamId)
        }
        break
      }
      case 'customer.subscription.deleted': {
        const teamId = sub.metadata?.team_id
        if (teamId) {
          const now = new Date().toISOString()
          this.stmtUpdateSub.run('canceled', 'free', null, null, null, now, now, teamId)
        }
        break
      }
      case 'invoice.payment_failed': {
        const teamId = sub.metadata?.team_id || sub.subscription?.metadata?.team_id
        if (teamId) {
          const now = new Date().toISOString()
          this.stmtUpdateSub.run('past_due', null, null, null, null, null, now, teamId)
        }
        break
      }
    }

    return { received: true, type: event.type }
  }

  changePlan(teamId, planId) {
    const plan = this.getPlan(planId)
    if (!plan) throw new AppError(404, 'PLAN_NOT_FOUND', 'Plan not found')

    const now = new Date().toISOString()
    const nextMonth = new Date()
    nextMonth.setMonth(nextMonth.getMonth() + 1)

    this.stmtUpdateSub.run('active', planId, now, nextMonth.toISOString(), null, null, now, teamId)
    return { teamId, planId, status: 'active', changedAt: now }
  }

  cancelSubscription(teamId) {
    if (this.stripeEnabled) {
      const sub = this.getSubscription(teamId)
      if (sub.stripe_subscription_id) {
        this.stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true }).catch(() => {})
      }
    }
    const now = new Date().toISOString()
    this.stmtUpdateSub.run('canceled', 'free', null, null, null, now, now, teamId)
    return { teamId, status: 'canceled', canceledAt: now }
  }
}
