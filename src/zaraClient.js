// ZaraClient — thin WebSocket client for the ProPrompt agent API.
//
// Configurable via constructor so each host can point at staging /
// production / a local agent-api without env-var coupling.

const HTTPS_TO_WSS = u => u.replace(/^http(s?):\/\//, (_, s) => `ws${s}://`)

const TERMINAL_REPLY_TYPES = new Set([
  'session_updated',
  'session_created',
  'session_loaded',
])

const DEFAULTS = {
  apiBase: 'https://agent-api.proprompt.store',
  agentId: 'proprompt',
  guestEmail: 'support@codedesign.app',
}

export class ZaraClient {
  constructor(options = {}) {
    const { apiBase, agentId, guestEmail } = { ...DEFAULTS, ...options }
    this.wsBase = HTTPS_TO_WSS(apiBase)
    this.agentId = agentId
    this.guestEmail = guestEmail
    this.ws = null
    this.userEmail = null
    this.clientId = `pp_web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this._connectPromise = null
    this._pending = null
  }

  setUserEmail(email) {
    const normalized = (email && email.trim()) || null
    if (this.userEmail === normalized) return
    this.userEmail = normalized
    this._disconnect()
  }

  _disconnect() {
    if (this.ws) {
      try { this.ws.close(1000, 'reconfigure') } catch { /* noop */ }
    }
    this.ws = null
    this._connectPromise = null
    if (this._pending) {
      try { this._pending.reject(new Error('Connection reset')) } catch { /* noop */ }
      clearTimeout(this._pending.timer)
      this._pending = null
    }
  }

  async _connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return
    if (this._connectPromise) return this._connectPromise

    const email = this.userEmail || this.guestEmail
    const url = `${this.wsBase}/ws/${this.clientId}?user_email=${encodeURIComponent(email)}&agent_id=${encodeURIComponent(this.agentId)}`

    this._connectPromise = new Promise((resolve, reject) => {
      let ws
      try { ws = new WebSocket(url) } catch (err) { reject(err); return }

      const timeout = setTimeout(() => {
        try { ws.close() } catch { /* noop */ }
        reject(new Error('WebSocket connection timed out'))
      }, 12000)

      ws.addEventListener('open', () => {
        clearTimeout(timeout)
        this.ws = ws
        resolve()
      })

      ws.addEventListener('error', () => clearTimeout(timeout))

      ws.addEventListener('close', () => {
        clearTimeout(timeout)
        this.ws = null
        this._connectPromise = null
        if (this._pending) {
          try { this._pending.reject(new Error('Connection closed')) } catch { /* noop */ }
          clearTimeout(this._pending.timer)
          this._pending = null
        }
        reject(new Error('WebSocket closed before opening'))
      })

      ws.addEventListener('message', (event) => this._handleMessage(event))
    })

    return this._connectPromise
  }

  _handleMessage(event) {
    let msg
    try { msg = JSON.parse(event.data) } catch { return }
    if (!this._pending) return

    if (TERMINAL_REPLY_TYPES.has(msg.type)) {
      const pending = this._pending
      this._pending = null
      clearTimeout(pending.timer)
      pending.resolve({
        message: msg.message || msg.result || '',
        conversationId: msg.conversation_id,
        status: msg.status,
      })
    } else if (msg.type === 'error') {
      const pending = this._pending
      this._pending = null
      clearTimeout(pending.timer)
      pending.reject(new Error(msg.error || msg.message || 'Agent error'))
    }
  }

  async _send(payload, { timeoutMs = 60000 } = {}) {
    await this._connect()
    if (this._pending) throw new Error('Another request is already in flight')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending = null
        reject(new Error('Agent did not respond in time'))
      }, timeoutMs)
      this._pending = { resolve, reject, timer }
      try { this.ws.send(JSON.stringify(payload)) }
      catch (err) {
        clearTimeout(timer)
        this._pending = null
        reject(err)
      }
    })
  }

  async start(userRequest) {
    return this._send({ type: 'start_interaction', user_request: userRequest, project_id: null })
  }

  async continue(conversationId, answer) {
    return this._send({ type: 'continue_interaction', conversation_id: conversationId, answer })
  }

  disconnect() {
    this._disconnect()
  }
}
