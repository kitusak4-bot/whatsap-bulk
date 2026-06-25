export const createDemoAccount = (apiKeys, cfg) => {
  const demoMode = process.env.DEMO_MODE === 'true'
  const demoAdminKey = process.env.DEMO_ADMIN_KEY

  if (!demoMode || !demoAdminKey) {
    return { enabled: false }
  }

  const demoApiKey = apiKeys.create({ name: 'demo-user', role: 'admin' })

  return {
    enabled: true,
    adminKey: demoAdminKey,
    demoApiKey: demoApiKey.apiKey,
    demoKeyId: demoApiKey.id,
    info: {
      mode: 'demo',
      restrictions: [
        'Daily send limit reduced to 20 messages',
        'Demo admin key resets every 24 hours',
        'No media uploads over 1MB',
        'Session expires after 2 hours'
      ]
    }
  }
}
