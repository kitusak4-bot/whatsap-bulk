export const enforceQuota = ({ billing, webhooks }) => {
  return async (req, res, next) => {
    // Skip quota check for non-message-sending paths
    const sendPaths = ['/send-message', '/send-image', '/send-document', '/send-audio', '/send-location']
    if (!sendPaths.includes(req.path)) return next()

    if (!req.apiKey?.teamId) return next()

    try {
      const quota = await billing.checkQuota(req.apiKey.teamId)
      if (quota.exceeded) {
        return res.status(429).json({
          success: false,
          data: {},
          error: 'Monthly message limit reached. Upgrade your plan to send more messages.',
          code: 'QUOTA_EXCEEDED',
          details: { plan: quota.plan, usage: quota.usage, remaining: 0 }
        })
      }

      // Track usage and fire webhook after successful send
      const originalJson = res.json.bind(res)
      res.json = function (body) {
        if (res.statusCode < 400 && body?.success) {
          try { billing.trackUsage(req.apiKey.teamId, 1) } catch {}
          if (webhooks) {
            const recipient = req.body?.to || ''
            webhooks.dispatch(req.apiKey.teamId, 'message.sent', {
              recipient,
              type: req.path.replace('/send-', ''),
              messageId: body?.data?.id,
              waMessageId: body?.data?.waMessageId
            }).catch(() => {})
          }
        }
        return originalJson(body)
      }

      next()
    } catch {
      next()
    }
  }
}
