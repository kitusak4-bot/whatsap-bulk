# Baileys WhatsApp API — Node.js Client

## Installation
```bash
npm install @rameez/baileys-api
```

## Usage
```js
import { BaileysClient } from '@rameez/baileys-api'

const client = new BaileysClient({
  apiKey: 'wapi_xxx_xxx',
  baseUrl: 'https://your-instance.com'
})

// Send a text message
const result = await client.sendMessage('923001234567', 'Hello World')
console.log(result.status) // 'sent'

// Send an image
await client.sendImage('923001234567', 'https://example.com/image.jpg', { caption: 'Nice!' })

// Check WhatsApp status
const status = await client.getStatus()
console.log(status.connected)

// List recent messages
const { messages } = await client.getMessages({ limit: 10 })

// Manage webhooks
const webhook = await client.createWebhook({
  name: 'My Webhook',
  url: 'https://myapp.com/webhook',
  events: ['message.sent', 'message.delivered']
})

// Schedule a message
const scheduled = await client.scheduleMessage({
  recipient: '923001234567',
  messageType: 'text',
  payload: { text: 'Scheduled message' },
  scheduledAt: '2026-07-01T10:00:00.000Z'
})

// Manage contacts
const contact = await client.createContact({
  name: 'John Doe',
  number: '923001234567',
  tags: ['customer', 'vip']
})

// A/B testing
const test = await client.createABTest({
  name: 'Welcome Offer',
  variants: [
    { name: 'Discount 10%', type: 'text', content: { text: 'Get 10% off!' } },
    { name: 'Discount 20%', type: 'text', content: { text: 'Get 20% off!' } }
  ]
})

// White-label branding
await client.updateBranding({
  brandName: 'My Company',
  primaryColor: '#4F46E5',
  logoUrl: 'https://example.com/logo.png'
})
```

## API

### `new BaileysClient(options)`
- `options.apiKey` — Your API key
- `options.baseUrl` — Your instance URL

### Methods
- `sendMessage(to, message)` — Send text message
- `sendImage(to, url, opts?)` — Send image
- `sendDocument(to, url, opts?)` — Send document
- `sendAudio(to, url, opts?)` — Send audio
- `sendLocation(to, lat, lng, opts?)` — Send location
- `getStatus()` — Get WhatsApp connection status
- `getMessages(opts?)` — List messages
- `createWebhook(data)` — Create webhook
- `listWebhooks()` — List webhooks
- `updateWebhook(id, data)` — Update webhook
- `deleteWebhook(id)` — Delete webhook
- `getWebhookDeliveries(id)` — Get webhook delivery logs
- `scheduleMessage(data)` — Schedule a message
- `listScheduled()` — List scheduled messages
- `cancelScheduled(id)` — Cancel scheduled message
- `createContact(data)` — Create contact
- `listContacts(query?)` — List/search contacts
- `updateContact(id, data)` — Update contact
- `deleteContact(id)` — Delete contact
- `createGroup(data)` — Create contact group
- `listGroups()` — List contact groups
- `addToGroup(groupId, contactIds)` — Add contacts to group
- `getGroupMembers(groupId)` — List group members
- `createABTest(data)` — Create A/B test
- `startABTest(id)` — Start a test
- `sendABTestVariant(id, variantIndex, recipient)` — Send a variant
- `getABTestResults(id)` — Get test results
- `getBranding()` — Get white-label branding
- `updateBranding(data)` — Update branding
- `getBillingPlans()` — List plans
- `getSubscription()` — Get current subscription
- `getUsage()` — Get usage stats
