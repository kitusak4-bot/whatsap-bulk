/**
 * Developed by Mohammad Rameez Imdad (Rameez Scripts)
 * WhatsApp: https://wa.me/923224083545 (For Custom Projects)
 * YouTube: https://www.youtube.com/@rameezimdad (Subscribe for more!)
 */

import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  proto
} from 'baileys'
import PQueue from 'p-queue'
import { AppError } from '../utils/errors.js'
import { normalizeRecipient } from '../utils/recipient.js'

const deliveryStatus = {
  [proto.WebMessageInfo.Status.ERROR]: 'failed',
  [proto.WebMessageInfo.Status.PENDING]: 'queued',
  [proto.WebMessageInfo.Status.SERVER_ACK]: 'sent',
  [proto.WebMessageInfo.Status.DELIVERY_ACK]: 'delivered',
  [proto.WebMessageInfo.Status.READ]: 'read',
  [proto.WebMessageInfo.Status.PLAYED]: 'read'
}

export class WhatsAppService {
  constructor({ authStore, messages, logs, logger, cfg }) {
    this.authStore = authStore
    this.messages = messages
    this.logs = logs
    this.logger = logger.child({ module: 'whatsapp' }, { level: cfg.baileysLogLevel || 'warn' })
    this.cfg = cfg
    this.socket = null
    this.status = 'stopped'
    this.qr = null
    this.qrExpiresAt = null
    this.lastError = null
    this.connectedAt = null
    this.reconnectAttempts = 0
    this.reconnectTimer = null
    this.generation = 0
    this.stopped = true
    this.startPromise = null
    this.version = null
    this.qrWaiters = new Set()
    // one message at a time; optional MESSAGE_DELAY_MS gap between sends (0 = no gap, fire instantly)
    const gap = cfg.messageDelayMs ?? 0
    this.queue = gap > 0
      ? new PQueue({ concurrency: 1, interval: gap, intervalCap: 1 })
      : new PQueue({ concurrency: 1 })
  }

  async start() {
    if (this.startPromise) return this.startPromise
    if (this.socket && ['connecting', 'qr_ready', 'connected'].includes(this.status)) return
    this.stopped = false
    this.startPromise = this.connect()
      .catch(error => {
        this.status = 'error'
        this.lastError = error.message
        this.logs.write('error', 'whatsapp', 'connection start failed', { error: error.message })
        this.scheduleReconnect(false)
        throw error
      })
      .finally(() => {
        this.startPromise = null
      })
    return this.startPromise
  }

  async connect() {
    const generation = ++this.generation
    this.status = this.reconnectAttempts ? 'reconnecting' : 'connecting'
    const { state, saveCreds } = this.authStore.load()
    if (!this.version) {
      try {
        const latest = await fetchLatestBaileysVersion()
        this.version = latest.version
        this.logs.write('info', 'whatsapp', 'protocol version resolved', {
          version: this.version.join('.'),
          isLatest: latest.isLatest
        })
      } catch (error) {
        this.logger.warn({ err: error }, 'protocol version lookup failed; using Baileys default')
      }
    }

    const socket = makeWASocket({
      ...(this.version ? { version: this.version } : {}),
      logger: this.logger,
      browser: Browsers.ubuntu('Rameez Baileys API'),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, this.logger)
      },
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false, // send-only
      generateHighQualityLinkPreview: false,
      getMessage: async key => key.id ? this.messages.getContent(key.id) : undefined
    })

    this.socket = socket
    socket.ev.on('creds.update', () => {
      if (generation === this.generation) saveCreds().catch(error => {
        this.logs.write('error', 'whatsapp', 'credential save failed', { error: error.message })
      })
    })
    socket.ev.on('connection.update', update => this.onConnectionUpdate(update, generation))
    socket.ev.on('messages.upsert', () => {}) // send-only: inbound dropped, never stored
    socket.ev.on('messages.update', updates => this.onMessageUpdates(updates))
    socket.ev.on('message-receipt.update', receipts => {
      this.logs.write('debug', 'message', 'message receipt update', { count: receipts.length })
    })
  }

  onConnectionUpdate(update, generation) {
    if (generation !== this.generation) return
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      this.qr = qr
      this.qrExpiresAt = new Date(Date.now() + this.cfg.qrTtlMs).toISOString()
      this.status = 'qr_ready'
      this.resolveQrWaiters()
      this.logs.write('info', 'whatsapp', 'QR code generated', { expiresAt: this.qrExpiresAt })
    }

    if (connection === 'open') {
      this.status = 'connected'
      this.connectedAt = new Date().toISOString()
      this.qr = null
      this.qrExpiresAt = null
      this.lastError = null
      this.reconnectAttempts = 0
      this.resolveQrWaiters()
      this.logs.write('info', 'whatsapp', 'WhatsApp connected', { user: this.maskUser(this.socket?.user?.id) })
      return
    }

    if (connection !== 'close') return
    const code = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.data?.statusCode
    const loggedOut = code === DisconnectReason.loggedOut
    this.lastError = lastDisconnect?.error?.message || 'Connection closed'
    this.socket = null
    this.logs.write(loggedOut ? 'warn' : 'error', 'whatsapp', 'WhatsApp connection closed', {
      code,
      loggedOut,
      error: this.lastError
    })

    if (loggedOut) {
      this.status = 'logged_out'
      ++this.generation
      this.authStore.clear()
      this.scheduleReconnect(true)
      return
    }
    this.scheduleReconnect(false)
  }

  onMessageUpdates(updates) {
    for (const { key, update } of updates) {
      const status = deliveryStatus[update.status]
      if (!key.id || !status) continue
      const changed = this.messages.updateDelivery(key.id, status)
      if (changed) this.logs.write('info', 'message', 'message delivery updated', { waMessageId: key.id, status })
    }
  }

  scheduleReconnect(fresh) {
    if (this.stopped || this.reconnectTimer) return
    this.status = fresh ? 'connecting' : 'reconnecting'
    const base = Math.min(1000 * (2 ** this.reconnectAttempts), this.cfg.reconnectMaxDelayMs)
    const delay = fresh ? 1000 : Math.round(base * (0.8 + Math.random() * 0.4))
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.start().catch(error => {
        this.lastError = error.message
        this.logger.warn({ err: error }, 'reconnect attempt failed')
      })
    }, delay)
    this.reconnectTimer.unref()
  }

  resolveQrWaiters() {
    for (const resolve of this.qrWaiters) resolve(this.getQr())
    this.qrWaiters.clear()
  }

  getQr() {
    if (!this.qr || Date.parse(this.qrExpiresAt) <= Date.now()) return null
    return { qr: this.qr, expiresAt: this.qrExpiresAt }
  }

  async waitForQr(timeoutMs = this.cfg.qrWaitMs) {
    const current = this.getQr()
    if (current || this.status === 'connected') return current
    return new Promise(resolve => {
      const done = value => {
        clearTimeout(timer)
        this.qrWaiters.delete(done)
        resolve(value)
      }
      const timer = setTimeout(() => done(this.getQr()), timeoutMs)
      this.qrWaiters.add(done)
    })
  }

  getStatus() {
    return {
      status: this.status,
      connected: this.status === 'connected',
      user: this.status === 'connected' ? this.maskUser(this.socket?.user?.id) : null,
      connectedAt: this.connectedAt,
      qrAvailable: Boolean(this.getQr()),
      qrExpiresAt: this.getQr()?.expiresAt || null,
      reconnectAttempts: this.reconnectAttempts,
      pendingMessages: this.queue.size + this.queue.pending,
      lastError: this.lastError
    }
  }

  maskUser(id) {
    if (!id) return null
    const [number, server] = id.split('@')
    return `${number.slice(0, 3)}***${number.slice(-3)}@${server || 's.whatsapp.net'}`
  }

  async ensureConnected() {
    if (this.status !== 'connected' || !this.socket) {
      throw new AppError(503, 'WHATSAPP_NOT_CONNECTED', 'WhatsApp is not connected')
    }
  }

  async resolveRecipient(to) {
    const jid = normalizeRecipient(to)
    if (!this.cfg.checkRecipientExists || jid.endsWith('@g.us')) return jid
    const [result] = await this.socket.onWhatsApp(jid)
    if (!result?.exists) throw new AppError(404, 'RECIPIENT_NOT_FOUND', 'Recipient is not registered on WhatsApp')
    return result.jid || jid
  }

  async send({ to, type, content, payload, apiKeyId }) {
    await this.ensureConnected()
    const recipient = await this.resolveRecipient(to)
    const record = this.messages.create({ recipient, type, payload, apiKeyId })
    const queuedBehind = this.queue.size + this.queue.pending

    const markFailed = error => {
      this.messages.markFailed(record.id, error.message)
      this.logs.write('error', 'message', 'message send failed', {
        messageId: record.id,
        recipient: this.maskUser(recipient),
        type,
        error: error.message
      }, { apiKeyId })
    }

    const task = this.queue.add(async () => {
      await this.ensureConnected()
      const result = await this.socket.sendMessage(recipient, content)
      if (!result?.key?.id) throw new Error('WhatsApp did not return a message ID')
      const sent = this.messages.markSent(record.id, result)
      this.logs.write('info', 'message', 'message sent', {
        messageId: record.id,
        waMessageId: sent.waMessageId,
        recipient: this.maskUser(recipient),
        type
      }, { apiKeyId })
      return { ...sent, recipient, type }
    })

    // bulk requests would outwait the HTTP timeout behind the anti-ban gap;
    // wait briefly, then hand back "queued" and let it send in the background
    let timer
    const winner = await Promise.race([
      task.then(result => ({ result }), error => ({ error })),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 15000); timer.unref?.() })
    ])
    clearTimeout(timer)

    if (!winner) {
      task.then(() => {}, markFailed)
      return { id: record.id, status: 'queued', recipient, type, queuedBehind }
    }
    if (winner.error) {
      markFailed(winner.error)
      throw winner.error
    }
    return winner.result
  }

  async logout() {
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    const socket = this.socket
    ++this.generation
    this.socket = null
    this.status = 'logged_out'
    this.qr = null
    this.qrExpiresAt = null

    if (socket) {
      await socket.logout().catch(error => this.logger.warn({ err: error }, 'socket logout failed'))
      socket.end(new Error('API logout'))
    }
    this.authStore.clear()
    this.reconnectAttempts = 0
    this.logs.write('info', 'whatsapp', 'WhatsApp session logged out')
    await this.start()
    return this.getStatus()
  }

  async stop() {
    this.stopped = true
    ++this.generation
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    await this.queue.onIdle()
    this.queue.pause()
    if (this.socket) this.socket.end(new Error('Server shutdown'))
    this.socket = null
    this.status = 'stopped'
  }
}
