export class BaileysClient {
  constructor({ apiKey, baseUrl }) {
    this.apiKey = apiKey
    this.baseUrl = baseUrl.replace(/\/+$/, '')
  }

  async _fetch(method, path, body) {
    const url = `${this.baseUrl}${path}`
    const headers = {
      'x-api-key': this.apiKey,
      'content-type': 'application/json'
    }
    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    })
    const json = await response.json()
    if (!response.ok) {
      const error = new Error(json.error || `HTTP ${response.status}`)
      error.status = response.status
      error.code = json.code
      error.details = json.details
      throw error
    }
    return json.data !== undefined ? json.data : json
  }

  _get(path) { return this._fetch('GET', path) }
  _post(path, body) { return this._fetch('POST', path, body) }
  _put(path, body) { return this._fetch('PUT', path, body) }
  _delete(path) { return this._fetch('DELETE', path) }

  // Messaging
  sendMessage(to, message) { return this._post('/api/send-message', { to, message }) }
  sendImage(to, url, opts = {}) { return this._post('/api/send-image', { to, url, ...opts }) }
  sendDocument(to, url, opts = {}) { return this._post('/api/send-document', { to, url, ...opts }) }
  sendAudio(to, url, opts = {}) { return this._post('/api/send-audio', { to, url, ...opts }) }
  sendLocation(to, latitude, longitude, opts = {}) { return this._post('/api/send-location', { to, latitude, longitude, ...opts }) }
  getMessages(opts = {}) { return this._get(`/api/messages?${new URLSearchParams(opts)}`) }
  getStatus() { return this._get('/api/status') }

  // Webhooks
  createWebhook(data) { return this._post('/api/webhooks', data) }
  listWebhooks() { return this._get('/api/webhooks') }
  getWebhook(id) { return this._get(`/api/webhooks/${id}`) }
  updateWebhook(id, data) { return this._put(`/api/webhooks/${id}`, data) }
  deleteWebhook(id) { return this._delete(`/api/webhooks/${id}`) }
  getWebhookDeliveries(id, limit = 25) { return this._get(`/api/webhooks/${id}/deliveries?limit=${limit}`) }

  // Scheduling
  scheduleMessage(data) { return this._post('/api/schedule', data) }
  listScheduled() { return this._get('/api/schedule') }
  getScheduled(id) { return this._get(`/api/schedule/${id}`) }
  cancelScheduled(id) { return this._post(`/api/schedule/${id}/cancel`) }
  deleteScheduled(id) { return this._delete(`/api/schedule/${id}`) }

  // Contacts & Groups
  createContact(data) { return this._post('/api/contacts', data) }
  listContacts(query) {
    const qs = query ? `?query=${encodeURIComponent(query)}` : ''
    return this._get(`/api/contacts${qs}`)
  }
  getContact(id) { return this._get(`/api/contacts/${id}`) }
  updateContact(id, data) { return this._put(`/api/contacts/${id}`, data) }
  deleteContact(id) { return this._delete(`/api/contacts/${id}`) }
  createGroup(data) { return this._post('/api/contacts/groups', data) }
  listGroups() { return this._get('/api/contacts/groups/list') }
  getGroup(id) { return this._get(`/api/contacts/groups/${id}`) }
  updateGroup(id, data) { return this._put(`/api/contacts/groups/${id}`, data) }
  deleteGroup(id) { return this._delete(`/api/contacts/groups/${id}`) }
  addToGroup(groupId, contactIds) { return this._post(`/api/contacts/groups/${groupId}/members`, { contactIds }) }
  removeFromGroup(groupId, contactId) { return this._delete(`/api/contacts/groups/${groupId}/members/${contactId}`) }
  getGroupMembers(groupId) { return this._get(`/api/contacts/groups/${groupId}/members`) }

  // A/B Testing
  createABTest(data) { return this._post('/api/ab-tests', data) }
  listABTests() { return this._get('/api/ab-tests') }
  getABTest(id) { return this._get(`/api/ab-tests/${id}`) }
  updateABTest(id, data) { return this._put(`/api/ab-tests/${id}`, data) }
  deleteABTest(id) { return this._delete(`/api/ab-tests/${id}`) }
  startABTest(id) { return this._post(`/api/ab-tests/${id}/start`) }
  sendABTestVariant(id, variantIndex, recipient) { return this._post(`/api/ab-tests/${id}/send`, { variantIndex, recipient }) }
  getABTestResults(id) { return this._get(`/api/ab-tests/${id}/results`) }

  // White-label Branding
  getBranding() { return this._get('/api/branding') }
  updateBranding(data) { return this._put('/api/branding', data) }

  // Billing
  getBillingPlans() { return this._get('/api/billing/plans') }
  getSubscription() { return this._get('/api/billing/subscription') }
  getUsage() { return this._get('/api/billing/usage') }
}
