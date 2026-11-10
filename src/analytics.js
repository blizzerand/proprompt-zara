// Chat analytics client — fire-and-forget event stream.
//
// Configurable per-host: each host passes an `endpoint` and `source` so
// the same Zara package can drop events from multiple surfaces (landing
// page, in-app, etc.) into the same backend.

const VISITOR_ID_KEY = 'pp_visitor_id'
const QUEUE_KEY = 'pp_analytics_queue'
const MAX_QUEUE_SIZE = 50

function makeUUID() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* noop */ }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

export function getOrCreateVisitorId() {
  try {
    let id = window.localStorage.getItem(VISITOR_ID_KEY)
    if (!id) {
      id = makeUUID()
      window.localStorage.setItem(VISITOR_ID_KEY, id)
    }
    return id
  } catch {
    return 'unknown'
  }
}

export class ChatAnalytics {
  constructor({ endpoint, source = 'proprompt-website', enabled = true } = {}) {
    this.endpoint = endpoint || null
    this.source = source
    this.enabled = enabled !== false && Boolean(endpoint)
    this.sessionId = null
    this.visitor = null
  }

  _getSessionId() {
    if (!this.sessionId) {
      this.sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    }
    return this.sessionId
  }

  setVisitor(info) {
    this.visitor = info && info.email
      ? { name: info.name || null, email: info.email, ...(info.company ? { company: info.company } : {}) }
      : null
  }

  _envelope(event, data) {
    return {
      event,
      event_id: makeUUID(),
      occurred_at: new Date().toISOString(),
      source: this.source,
      visitor_id: getOrCreateVisitorId(),
      session_id: this._getSessionId(),
      visitor: this.visitor,
      page: typeof window !== 'undefined' ? {
        url: window.location.href,
        referrer: document.referrer || null,
        title: document.title || null,
      } : null,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      data: data || {},
    }
  }

  _enqueue(payload) {
    try {
      const raw = window.localStorage.getItem(QUEUE_KEY)
      const queue = raw ? JSON.parse(raw) : []
      queue.push(payload)
      window.localStorage.setItem(
        QUEUE_KEY,
        JSON.stringify(queue.slice(-MAX_QUEUE_SIZE))
      )
    } catch { /* noop */ }
  }

  async _transmit(payload) {
    if (!this.enabled) return false
    try {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      })
      return res.ok
    } catch { return false }
  }

  _send(event, data) {
    if (!this.enabled) return
    const payload = this._envelope(event, data)
    this._transmit(payload).then(ok => { if (!ok) this._enqueue(payload) })
  }

  // For messages a person is waiting on: send now and report whether it
  // arrived, so the widget can show "not sent" and retry with the same
  // payload (same event_id, so the server never stores it twice).
  async _sendNow(event, data) {
    const payload = this._envelope(event, data)
    const ok = await this._transmit(payload)
    return { ok, payload }
  }

  async resend(payload) {
    return this._transmit(payload)
  }

  // A person's replies in a chat and who is handling it, from the backend
  // (GET <endpoint>/chats/:chatId/updates). null when unavailable.
  async fetchChatUpdates(chatId, after) {
    if (!this.enabled || !chatId) return null
    const base = this.endpoint.replace(/\/+$/, '')
    const params = new URLSearchParams({ visitor_id: getOrCreateVisitorId() })
    if (after) params.set('after', after)
    try {
      const res = await fetch(`${base}/chats/${encodeURIComponent(chatId)}/updates?${params}`, { cache: 'no-store' })
      if (!res.ok) return null
      return await res.json()
    } catch { return null }
  }

  async flushQueue() {
    if (!this.enabled || typeof window === 'undefined') return
    let queue
    try { queue = JSON.parse(window.localStorage.getItem(QUEUE_KEY) || '[]') }
    catch { queue = [] }
    if (!Array.isArray(queue) || queue.length === 0) return
    const remaining = []
    for (const payload of queue) {
      // eslint-disable-next-line no-await-in-loop
      const ok = await this._transmit(payload)
      if (!ok) remaining.push(payload)
    }
    try { window.localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining)) }
    catch { /* noop */ }
  }

  sessionStart() { this._send('session_start', {}) }
  chatStarted({ chatId }) { this._send('chat_started', { chat_id: chatId }) }
  messageSent({ chatId, conversationId, messageId, content, attachments }) {
    this._send('message_sent', {
      chat_id: chatId,
      conversation_id: conversationId || null,
      message_id: messageId,
      content,
      attachments: (attachments || []).map(a => ({
        name: a.name, kind: a.kind, size: a.size, type: a.type || null,
      })),
    })
  }
  messageReceived({ chatId, conversationId, messageId, content, hasAction, action }) {
    this._send('message_received', {
      chat_id: chatId,
      conversation_id: conversationId || null,
      message_id: messageId,
      content,
      has_action: !!hasAction,
      action: action || null,
    })
  }
  leadCaptured({ name, email, company }) {
    this._send('lead_captured', { name, email, ...(company ? { company } : {}) })
  }
  // A visitor's message while a person handles the chat: sent now, not queued.
  messageSentNow({ chatId, conversationId, messageId, content, attachments }) {
    if (!this.enabled) return Promise.resolve({ ok: false, payload: null })
    return this._sendNow('message_sent', {
      chat_id: chatId,
      conversation_id: conversationId || null,
      message_id: messageId,
      content,
      attachments: (attachments || []).map(a => ({
        name: a.name, kind: a.kind, size: a.size, type: a.type || null,
      })),
    })
  }
  ticketCreated({ chatId, conversationId, messageId, action }) {
    this._send('ticket_created', {
      chat_id: chatId,
      conversation_id: conversationId || null,
      message_id: messageId,
      reason: action.reason,
      summary: action.summary,
      urgency: action.urgency,
    })
  }
  whatsappClicked({ chatId, conversationId, messageId, action, destination }) {
    this._send('whatsapp_clicked', {
      chat_id: chatId,
      conversation_id: conversationId || null,
      message_id: messageId,
      destination: destination || null,
      reason: action?.reason || null,
      summary: action?.summary || null,
    })
  }
  chatDeleted({ chatId }) { this._send('chat_deleted', { chat_id: chatId }) }
}
