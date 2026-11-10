import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { motion as Motion, AnimatePresence } from 'framer-motion'
import {
  MessageCircle,
  X,
  Sparkles,
  ArrowUp,
  Paperclip,
  ImageIcon,
  FileText,
  Film,
  Music,
  File as FileIcon,
  Download,
  UploadCloud,
  Plus,
  ArrowLeft,
  MessagesSquare,
  Trash2,
  User as UserIcon,
  Mail,
  Check,
  AlertCircle,
  Loader2,
  Ticket,
  Building2,
  RotateCcw,
} from 'lucide-react'
import { resolveAgentConfig } from './zaraAgent'
import { ZaraClient } from './zaraClient'
import { ChatAnalytics } from './analytics'
import { ChatMessageText } from './markdown'

// Theme tokens are hardcoded inline at every style site below. Past
// attempts to thread tokens via CSS custom properties broke in the
// in-app dashboard (CRA + Tailwind preflight + preact-compat shim) where
// host-defined :root / body vars shadowed ours. Literal values are the
// only way to guarantee identical rendering across both host apps.

const ease = [0.22, 1, 0.36, 1]

// Agent identity is resolved at runtime inside Chatbot() so each host can
// override the welcome message, suggestions, avatar, etc. via the `agent`
// prop. See resolveAgentConfig in zaraAgent.js for defaults.

const MAX_FILE_SIZE = 25 * 1024 * 1024
const MAX_ATTACHMENTS = 4

const STORAGE_KEY_CHATS = 'pp_chatbot_chats_v1'
const STORAGE_KEY_ACTIVE = 'pp_chatbot_active_v1'
const STORAGE_KEY_USER = 'pp_chatbot_user_v1'

// How often the widget checks for a ProPrompt team member's replies: often
// while the chat is open, less while it is closed, and not at all for a chat
// idle for two hours (unless a person is handling it) or in a hidden tab.
// A reply the chat does not pick up within a minute is emailed instead.
const POLL_OPEN_MS = 5000
const POLL_CLOSED_MS = 20000
const RECENT_CHAT_MS = 2 * 60 * 60 * 1000

let attachmentSeq = 0
const newAttachmentId = () => `att-${Date.now()}-${attachmentSeq++}`
const newId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

function classifyFile(file) {
  const t = file.type || ''
  if (t.startsWith('image/')) return 'image'
  if (t.startsWith('video/')) return 'video'
  if (t.startsWith('audio/')) return 'audio'
  return 'file'
}

function formatBytes(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function relativeTime(ts) {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

function fileKindIcon(kind, size = 16) {
  if (kind === 'image') return <ImageIcon size={size} />
  if (kind === 'video') return <Film size={size} />
  if (kind === 'audio') return <Music size={size} />
  if (kind === 'file') return <FileText size={size} />
  return <FileIcon size={size} />
}

const isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim())

function safeStorageGet(key, fallback) {
  try {
    if (typeof window === 'undefined') return fallback
    const raw = window.localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}
function safeStorageSet(key, value) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {/* ignore quota */}
}
function safeStorageRemove(key) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.removeItem(key)
  } catch {/* noop */}
}

function makeWelcomeChat(welcomeMessage) {
  return {
    id: newId('chat'),
    title: 'New chat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [{ id: 'welcome', role: 'bot', content: welcomeMessage }],
    leadAsked: false,
  }
}

function deriveTitle(text) {
  if (!text) return 'New chat'
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > 36 ? t.slice(0, 36).trimEnd() + '…' : t
}

function lastMessagePreview(chat) {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i]
    if (m.role === 'system') continue
    if (m.content) return m.content.replace(/\s+/g, ' ').slice(0, 60)
    if (m.attachments?.length) return `📎 ${m.attachments.length} attachment${m.attachments.length > 1 ? 's' : ''}`
  }
  return ''
}

// A reply as one short line for the bubble beside the chat button.
function replyPreviewText(text, max = 110) {
  const plain = String(text || '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|`)/g, '')
    .replace(/^\s*([-*•]|\d+[.)]|#{1,6})\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain
}

// What Zara needs when a person hands a chat back: the turns since they took
// over, as a note in front of the visitor's next message (Zara's own
// conversation never saw them).
function handbackNote(messages, personName) {
  const lines = messages
    .filter(m => (m.role === 'user' || m.role === 'human') && m.content)
    .slice(-20)
    .map(m => {
      const who = m.role === 'user' ? 'Visitor' : `${m.author || personName} (ProPrompt team)`
      const text = m.content.length > 500 ? `${m.content.slice(0, 500)}…` : m.content
      return `${who}: ${text}`
    })
  if (!lines.length) return null
  return `[Note for Zara: ${personName} from the ProPrompt team handled this chat for a while and has handed it back to you. What was said meanwhile:\n${lines.join('\n')}\nCarry on from there without repeating what was already covered.]`
}

// Compose the user turn we send to the agent. Attachments are noted in
// plain text for now since the WS protocol's file ingestion is not yet
// wired through this client.
function composeUserTurn(text, attachments) {
  let out = text || ''
  if (attachments && attachments.length > 0) {
    const names = attachments.map(a => `${a.name} (${a.kind})`).join(', ')
    out = out
      ? `${out}\n\n[Visitor attached: ${names}]`
      : `[Visitor attached: ${names}]`
  }
  return out.trim()
}

// ── Human handoff configuration ──────────────────────────────────────────
// The ticket endpoint is read from the `config` prop at runtime inside
// Chatbot() and threaded down to HandoffCard so each host can supply its
// own value without env-var coupling.

const VALID_REASONS = new Set([
  'general_inquiry', 'demo_request', 'sales_question', 'billing_issue',
  'technical_issue', 'complaint', 'partnership', 'other',
])

/**
 * Extracts an `action`-fenced JSON block from a Zara reply, if present.
 * The block is expected to be the very last thing in the message.
 * Returns { cleanText, action } where action is parsed JSON or null.
 */
function parseHandoffAction(text) {
  if (!text || typeof text !== 'string') {
    return { cleanText: text || '', action: null }
  }

  // Match a fenced ```action ... ``` block at (or near) the very end.
  // Allow trailing whitespace and tolerate the closing fence on its own line
  // OR with extra spaces.
  const fenceRegex = /```action\s*\n([\s\S]+?)\n```\s*$/i
  const match = text.match(fenceRegex)
  if (!match) return { cleanText: text, action: null }

  let raw = match[1].trim()
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Be lenient: if the AI wrapped the JSON in extra prose, try to extract
    // the first {...} object.
    const innerMatch = raw.match(/\{[\s\S]*\}/)
    if (innerMatch) {
      try { parsed = JSON.parse(innerMatch[0]) } catch { /* noop */ }
    }
  }

  if (!parsed || parsed.type !== 'human_handoff') {
    // Looked like a handoff fence but didn't validate — leave text untouched.
    return { cleanText: text, action: null }
  }

  // Normalise + validate fields so downstream UI doesn't have to.
  const action = {
    type: 'human_handoff',
    reason: VALID_REASONS.has(parsed.reason) ? parsed.reason : 'general_inquiry',
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    urgency: ['low', 'medium', 'high'].includes(parsed.urgency) ? parsed.urgency : 'medium',
  }

  const cleanText = text.slice(0, match.index).trimEnd()
  return { cleanText, action }
}

const REASON_LABEL = {
  general_inquiry: 'General enquiry',
  demo_request: 'Demo request',
  sales_question: 'Sales question',
  billing_issue: 'Billing issue',
  technical_issue: 'Technical issue',
  complaint: 'Complaint',
  partnership: 'Partnership',
  other: 'Request',
}

function HandoffCard({
  msgId,
  action,
  userInfo,
  isDark,
  ticketEndpoint,
  analyticsSource,
}) {
  // Idempotency: never POST the same ticket twice across reloads.
  const storageKey = `pp_ticket_submitted_${msgId}`
  const [status, setStatus] = useState(() => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(storageKey)) {
      return 'success'
    }
    return 'pending'
  })
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    // Already created on a previous render.
    if (status === 'success') return

    // If no backend endpoint is configured, treat it as a success but log
    // the payload to the console so developers can see what would have been
    // sent. The ticket itself reaches the team through the analytics
    // ticket_created event.
    const payload = {
      ...action,
      visitor: userInfo || null,
      source: analyticsSource || 'website-chat',
      created_at: new Date().toISOString(),
    }

    if (!ticketEndpoint) {
      console.info('[Zara chat] Ticket payload (no ticketEndpoint configured):', payload)
      window.localStorage.setItem(storageKey, '1')
      setStatus('success')
      return
    }

    setStatus('submitting')
    fetch(ticketEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(r => {
        if (r.ok) {
          window.localStorage.setItem(storageKey, '1')
          setStatus('success')
        } else {
          setStatus('failed')
        }
      })
      .catch(() => setStatus('failed'))
  }, [action, userInfo, status, storageKey, ticketEndpoint, analyticsSource])

  const statusColor =
    status === 'failed' ? '#FF5C5C' : '#77D501'
  const statusBg =
    status === 'failed' ? 'rgba(255,92,92,0.15)' : 'rgba(119,213,1,0.14)'

  return (
    <Motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease, delay: 0.15 }}
      style={{
        marginTop: 8,
        padding: 12,
        borderRadius: 14,
        background: isDark ? 'rgba(255,255,255,0.035)' : 'rgba(15,26,8,0.04)',
        border: '1px solid rgba(255,255,255,0.07)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: '92%',
      }}
    >
      {/* Ticket status row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Motion.div
          initial={{ scale: 0.7 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          style={{
            width: 26, height: 26, borderRadius: '50%',
            background: statusBg, color: statusColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            border: `1px solid ${statusColor}`,
          }}
        >
          {status === 'submitting' && (
            <Motion.span
              animate={{ rotate: 360 }}
              transition={{ duration: 1.0, repeat: Infinity, ease: 'linear' }}
              style={{ display: 'flex' }}
            >
              <Loader2 size={13} />
            </Motion.span>
          )}
          {status === 'failed' && <AlertCircle size={14} />}
          {(status === 'success' || status === 'pending') && (
            <Check size={14} strokeWidth={3} />
          )}
        </Motion.div>
        <div
          style={{
            flex: 1, minWidth: 0,
            fontSize: 12.5, fontWeight: 600, color: '#FFFFFF',
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          <span>
            {status === 'submitting' && 'Creating your ticket…'}
            {status === 'failed' && "Couldn't create the ticket"}
            {(status === 'success' || status === 'pending') && 'Ticket created'}
          </span>
          {action.urgency === 'high' && (
            <span
              style={{
                fontSize: 10.5, fontWeight: 700, letterSpacing: 0.4,
                color: '#FF9B6B', textTransform: 'uppercase',
                padding: '1px 6px', borderRadius: 4,
                background: 'rgba(255,155,107,0.12)',
                border: '1px solid rgba(255,155,107,0.3)',
              }}
            >
              Priority
            </span>
          )}
        </div>
        <Ticket size={14} style={{ color: 'rgba(255,255,255,0.35)' }} />
      </div>

      {/* Explanation: the ticket is in and the team will be in touch. */}
      <div
        style={{
          fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5,
        }}
      >
        {userInfo?.email ? (
          <>The ProPrompt team will get back to you soon at{' '}
            <span style={{ color: '#FFFFFF' }}>{userInfo.email}</span>.</>
        ) : (
          <>The ProPrompt team will get back to you soon.</>
        )}
      </div>
    </Motion.div>
  )
}

// Square-rounded avatar showing the agent's official image. Falls back to
// the brand gradient + Sparkles glyph if the image is missing or fails.
function AgentAvatar({ size = 36, agent }) {
  const [failed, setFailed] = useState(false)
  const avatarUrl = agent?.avatarUrl
  const showImage = avatarUrl && !failed
  const radius = Math.round(size * 0.33)
  const iconSize = Math.round(size * 0.47)

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        background: showImage
          ? '#0D1009'
          : 'linear-gradient(135deg, #AAEE40 0%, #77D501 50%, #4DB800 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 4px 12px rgba(119,213,1,0.35)',
        color: '#0A0E06',
        flexShrink: 0,
      }}
    >
      {showImage ? (
        <img
          src={avatarUrl}
          alt={agent?.name || 'Agent'}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <Sparkles size={iconSize} strokeWidth={2.2} />
      )}
    </div>
  )
}

// A ProPrompt team member handling the chat: their initial, in Zara's green.
function PersonAvatar({ size = 36, name }) {
  return (
    <div
      aria-label={name}
      style={{
        width: size, height: size, borderRadius: Math.round(size * 0.33), flexShrink: 0,
        background: 'linear-gradient(135deg, #AAEE40 0%, #77D501 50%, #4DB800 100%)',
        boxShadow: '0 4px 12px rgba(119,213,1,0.35)', color: '#0A0E06',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 700, fontSize: Math.round(size * 0.44),
      }}
    >
      {(name || '?').trim().charAt(0).toUpperCase()}
    </div>
  )
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '4px 2px' }}>
      {[0, 1, 2].map(i => (
        <Motion.span
          key={i}
          initial={{ opacity: 0.3, y: 0 }}
          animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
          transition={{ duration: 1.0, repeat: Infinity, ease: 'easeInOut', delay: i * 0.15 }}
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'rgba(255,255,255,0.55)', display: 'inline-block',
          }}
        />
      ))}
    </div>
  )
}

function AttachmentTile({ att, onRemove, isDark, compact }) {
  const removable = !!onRemove
  const isImage = att.kind === 'image'
  const isVideo = att.kind === 'video'
  const tileBg = isDark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.04)'

  if (isImage) {
    return (
      <Motion.div
        layout
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={{ duration: 0.22, ease }}
        style={{
          position: 'relative',
          width: compact ? 64 : 200,
          height: compact ? 64 : 'auto',
          maxHeight: compact ? 64 : 240,
          borderRadius: 12, overflow: 'hidden',
          background: tileBg, border: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
        }}
      >
        <img
          src={att.url} alt={att.name}
          style={{
            display: 'block', width: '100%',
            height: compact ? '100%' : 'auto',
            maxHeight: compact ? 64 : 240, objectFit: 'cover',
          }}
        />
        {removable && (
          <button
            type="button" onClick={() => onRemove(att.id)}
            aria-label={`Remove ${att.name}`}
            style={{
              position: 'absolute', top: 4, right: 4,
              width: 20, height: 20, borderRadius: '50%',
              background: 'rgba(0,0,0,0.7)', color: '#fff',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={12} strokeWidth={2.6} />
          </button>
        )}
      </Motion.div>
    )
  }

  if (isVideo) {
    return (
      <Motion.div
        layout
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.85 }}
        transition={{ duration: 0.22, ease }}
        style={{
          position: 'relative',
          width: compact ? 96 : 240,
          borderRadius: 12, overflow: 'hidden',
          background: '#000', border: '1px solid rgba(255,255,255,0.07)',
          flexShrink: 0,
        }}
      >
        <video
          src={att.url} controls={!compact} muted={compact}
          style={{ display: 'block', width: '100%', maxHeight: compact ? 64 : 200, objectFit: 'cover' }}
        />
        {removable && (
          <button
            type="button" onClick={() => onRemove(att.id)} aria-label={`Remove ${att.name}`}
            style={{
              position: 'absolute', top: 4, right: 4,
              width: 20, height: 20, borderRadius: '50%',
              background: 'rgba(0,0,0,0.7)', color: '#fff',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <X size={12} strokeWidth={2.6} />
          </button>
        )}
      </Motion.div>
    )
  }

  return (
    <Motion.div
      layout
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85 }}
      transition={{ duration: 0.22, ease }}
      style={{
        position: 'relative', display: 'flex', alignItems: 'center', gap: 10,
        padding: compact ? '8px 28px 8px 10px' : '10px 12px',
        borderRadius: 12, background: tileBg, border: '1px solid rgba(255,255,255,0.07)',
        minWidth: compact ? 180 : 220, maxWidth: 260, flexShrink: 0,
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 10,
        background: 'rgba(119,213,1,0.14)', color: '#77D501',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        {fileKindIcon(att.kind, 18)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13, fontWeight: 600, color: '#FFFFFF',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
          title={att.name}
        >
          {att.name}
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>
          {formatBytes(att.size)}
        </div>
      </div>
      {!removable && att.url && (
        <a
          href={att.url} download={att.name} aria-label={`Download ${att.name}`}
          style={{
            color: 'rgba(255,255,255,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 4, borderRadius: 6,
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#77D501')}
          onMouseLeave={e => (e.currentTarget.style.color = 'rgba(255,255,255,0.55)')}
        >
          <Download size={15} />
        </a>
      )}
      {removable && (
        <button
          type="button" onClick={() => onRemove(att.id)} aria-label={`Remove ${att.name}`}
          style={{
            position: 'absolute', top: 6, right: 6,
            width: 20, height: 20, borderRadius: '50%',
            background: 'rgba(0,0,0,0.55)', color: '#fff',
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <X size={11} strokeWidth={2.6} />
        </button>
      )}
    </Motion.div>
  )
}

function LeadForm({ onSubmit, isDark }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [company, setCompany] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [touched, setTouched] = useState(false)
  const nameRef = useRef(null)

  useEffect(() => { nameRef.current?.focus() }, [])

  const nameValid = name.trim().length >= 2
  const emailValid = isValidEmail(email)
  const ready = nameValid && emailValid && !submitting

  const handle = (e) => {
    e.preventDefault()
    setTouched(true)
    if (!ready) return
    setSubmitting(true)
    setTimeout(() => onSubmit({ name: name.trim(), email: email.trim(), company: company.trim() || null }), 250)
  }

  const fieldStyle = (valid) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    background: '#0D1009',
    border: `1px solid ${touched && !valid ? '#FF7A7A' : 'rgba(255,255,255,0.12)'}`,
    borderRadius: 10, padding: '8px 12px',
    transition: 'border-color 0.18s ease',
  })

  return (
    <Motion.form
      onSubmit={handle}
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.32, ease, delay: 0.1 }}
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: 14, borderRadius: '18px 18px 18px 4px',
        background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,26,8,0.04)',
        border: '1px solid rgba(255,255,255,0.07)',
        maxWidth: '92%',
      }}
    >
      <div style={{ fontSize: 13.5, color: '#FFFFFF', lineHeight: 1.5, marginBottom: 4 }}>
        Quick — who am I chatting with? It helps me follow up if we get cut off.
      </div>
      <div style={fieldStyle(nameValid || !touched)}>
        <UserIcon size={14} style={{ color: 'rgba(255,255,255,0.55)' }} />
        <input
          ref={nameRef}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your name"
          aria-label="Your name"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#FFFFFF', fontFamily: 'inherit', fontSize: 13.5, padding: 0,
          }}
        />
      </div>
      <div style={fieldStyle(emailValid || !touched)}>
        <Mail size={14} style={{ color: 'rgba(255,255,255,0.55)' }} />
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@work.com"
          aria-label="Email"
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#FFFFFF', fontFamily: 'inherit', fontSize: 13.5, padding: 0,
          }}
        />
      </div>
      <div style={fieldStyle(true)}>
        <Building2 size={14} style={{ color: 'rgba(255,255,255,0.55)' }} />
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          placeholder="Company (optional)"
          aria-label="Company"
          maxLength={120}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
            color: '#FFFFFF', fontFamily: 'inherit', fontSize: 13.5, padding: 0,
          }}
        />
      </div>
      <Motion.button
        type="submit"
        disabled={!ready}
        whileHover={ready ? { y: -1 } : undefined}
        whileTap={ready ? { scale: 0.98 } : undefined}
        style={{
          marginTop: 4, padding: '9px 14px', borderRadius: 10,
          background: ready ? '#77D501' : 'rgba(255,255,255,0.07)',
          color: ready ? '#0A0E06' : 'rgba(255,255,255,0.35)',
          fontWeight: 600, fontSize: 13, border: 'none',
          cursor: ready ? 'pointer' : 'not-allowed',
          fontFamily: 'inherit',
          transition: 'background 0.2s ease',
        }}
      >
        {submitting ? 'Saving…' : 'Continue'}
      </Motion.button>
      {touched && (!nameValid || !emailValid) && (
        <div style={{ fontSize: 11.5, color: '#FF9090' }}>
          {!nameValid ? 'Please enter your name.' : 'Please enter a valid email.'}
        </div>
      )}
    </Motion.form>
  )
}

function MessageBubble({ msg, isDark, userInfo, handoffConfig, onRetry }) {
  // A person joined or left the chat.
  if (msg.role === 'system' && msg.kind === 'notice') {
    return (
      <Motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        style={{ display: 'flex', justifyContent: 'center', padding: '2px 0' }}
      >
        <div style={{
          fontSize: 11.5, color: '#C9F08F', padding: '4px 10px', borderRadius: 999,
          background: 'rgba(119,213,1,0.10)', border: '1px solid rgba(119,213,1,0.22)',
        }}>
          {msg.content}
        </div>
      </Motion.div>
    )
  }

  if (msg.role === 'system' && msg.kind === 'lead-form-submitted') {
    return (
      <Motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        style={{ textAlign: 'center', fontSize: 11.5, color: 'rgba(255,255,255,0.55)', padding: '4px 0' }}
      >
        ✓ {msg.content}
      </Motion.div>
    )
  }

  const isUser = msg.role === 'user'
  const isHuman = msg.role === 'human' // a ProPrompt team member
  const hasText = !!msg.content
  const hasAttachments = msg.attachments && msg.attachments.length > 0
  const hasAction = !isUser && msg.action && msg.action.type === 'human_handoff'

  const userBg = isDark ? '#FFFFFF' : '#0F1A08'
  const userColor = isDark ? '#0A0E06' : '#FFFFFF'
  const botBg = isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,26,8,0.04)'
  const botColor = '#FFFFFF'
  const botBorder = '1px solid rgba(255,255,255,0.07)'

  const onlyImages = hasAttachments && !hasText &&
    msg.attachments.every(a => a.kind === 'image' || a.kind === 'video')

  return (
    <Motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, ease }}
      style={{
        display: 'flex', flexDirection: 'column',
        alignItems: isUser ? 'flex-end' : 'flex-start',
        width: '100%', gap: 0,
      }}
    >
      {isHuman && (
        <div style={{ fontSize: 11, color: '#C9F08F', margin: '0 0 4px 4px', fontWeight: 600 }}>
          {msg.author || 'ProPrompt'} · ProPrompt team
        </div>
      )}
      <div
        style={{
          maxWidth: '85%',
          padding: onlyImages ? 0 : '10px 14px',
          borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
          background: onlyImages ? 'transparent' : (isUser ? userBg : botBg),
          color: isUser ? userColor : botColor,
          border: onlyImages || isUser ? 'none' : (isHuman ? '1px solid rgba(119,213,1,0.28)' : botBorder),
          fontSize: 14, lineHeight: 1.5, fontWeight: 450,
          letterSpacing: '-0.005em', wordBreak: 'break-word',
          boxShadow: !onlyImages && isUser
            ? (isDark ? '0 2px 12px rgba(255,255,255,0.06)' : '0 2px 12px rgba(0,0,0,0.06)')
            : 'none',
          display: hasText || hasAttachments ? 'flex' : 'none',
          flexDirection: 'column',
          gap: hasText && hasAttachments ? 8 : 0,
        }}
      >
        {hasAttachments && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {msg.attachments.map(a => <AttachmentTile key={a.id} att={a} isDark={isDark} />)}
          </div>
        )}
        {hasText && (
          isUser || isHuman ? (
            // User and team text stay plain — keeps newlines, no markdown surprises.
            <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
          ) : (
            // Bot content is rendered as markdown. The wrapper resets the
            // default last-child margin so the bubble doesn't have a trailing gap.
            <div className="chatbot-md">
              <ChatMessageText>{msg.content}</ChatMessageText>
            </div>
          )
        )}
      </div>

      {isUser && msg.status === 'sending' && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 4 }}>Sending…</div>
      )}
      {isUser && msg.status === 'failed' && (
        <button
          type="button"
          onClick={() => onRetry && onRetry(msg.id)}
          style={{
            marginTop: 4, display: 'inline-flex', alignItems: 'center', gap: 4,
            fontSize: 11.5, color: '#FF9090', background: 'transparent', border: 'none',
            cursor: 'pointer', fontFamily: 'inherit', padding: 0,
          }}
        >
          <RotateCcw size={12} /> Not sent. Tap to retry
        </button>
      )}

      {/* Human handoff card — only rendered for bot messages with an action. */}
      {hasAction && (
        <HandoffCard
          msgId={msg.id}
          action={msg.action}
          userInfo={userInfo}
          isDark={isDark}
          ticketEndpoint={handoffConfig?.ticketEndpoint}
          analyticsSource={handoffConfig?.analyticsSource}
        />
      )}
    </Motion.div>
  )
}

function ChatListView({ chats, activeChatId, onSelect, onNew, onDelete, isDark, canCreateNew = true }) {
  const [confirmId, setConfirmId] = useState(null)
  const sorted = useMemo(
    () => [...chats].sort((a, b) => b.updatedAt - a.updatedAt),
    [chats]
  )

  return (
    <Motion.div
      key="list"
      initial={{ x: -40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: -40, opacity: 0 }}
      transition={{ duration: 0.28, ease }}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {canCreateNew && (
        <div style={{ padding: '14px 14px 8px' }}>
          <Motion.button
            type="button"
            onClick={onNew}
            whileHover={{ y: -1 }}
            whileTap={{ scale: 0.98 }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '10px 14px', borderRadius: 12,
              background: '#77D501', color: '#0A0E06',
              border: 'none', cursor: 'pointer',
              fontFamily: 'inherit', fontWeight: 600, fontSize: 13.5,
              boxShadow: '0 6px 20px rgba(119,213,1,0.28)',
            }}
          >
            <Plus size={16} strokeWidth={2.4} />
            New chat
          </Motion.button>
        </div>
      )}

      <div className="chatbot-scroll" style={{ flex: 1, overflowY: 'auto', padding: '4px 8px 14px' }}>
        {sorted.length === 0 ? (
          <div style={{
            padding: '40px 20px', textAlign: 'center',
            color: 'rgba(255,255,255,0.55)', fontSize: 13,
          }}>
            No chats yet.
          </div>
        ) : sorted.map(chat => {
          const isActive = chat.id === activeChatId
          const isConfirm = confirmId === chat.id
          const preview = lastMessagePreview(chat)
          return (
            <Motion.div
              key={chat.id}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25, ease }}
              className="chatbot-list-row"
              style={{
                position: 'relative', padding: '10px 12px', margin: '2px 0',
                borderRadius: 12, cursor: isConfirm ? 'default' : 'pointer',
                background: isActive ? 'rgba(119,213,1,0.14)' : 'transparent',
                border: `1px solid ${isActive ? 'rgba(119,213,1,0.24)' : 'transparent'}`,
                transition: 'background 0.18s ease, border-color 0.18s ease',
              }}
              onClick={() => { if (!isConfirm) onSelect(chat.id) }}
            >
              {!isConfirm ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div
                      style={{
                        flex: 1, minWidth: 0,
                        fontSize: 13.5, fontWeight: 600,
                        color: '#FFFFFF',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                      title={chat.title}
                    >
                      {chat.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', flexShrink: 0 }}>
                      {relativeTime(chat.updatedAt)}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 3,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      paddingRight: 24,
                    }}
                  >
                    {preview || '—'}
                  </div>
                  {sorted.length > 1 && (
                    <button
                      type="button"
                      aria-label="Delete chat"
                      onClick={(e) => { e.stopPropagation(); setConfirmId(chat.id) }}
                      className="chatbot-list-trash"
                      style={{
                        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                        width: 28, height: 28, borderRadius: 8,
                        background: 'transparent', color: 'rgba(255,255,255,0.35)',
                        border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: 0, transition: 'opacity 0.15s ease, background 0.15s ease, color 0.15s ease',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,90,90,0.12)'
                        e.currentTarget.style.color = '#FF7A7A'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                        e.currentTarget.style.color = 'rgba(255,255,255,0.35)'
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </>
              ) : (
                <Motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
                >
                  <div style={{ fontSize: 12.5, color: '#FFFFFF' }}>Delete this chat?</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmId(null) }}
                      style={{
                        padding: '5px 10px', fontSize: 12, borderRadius: 8,
                        background: 'transparent', color: 'rgba(255,255,255,0.55)',
                        border: '1px solid rgba(255,255,255,0.07)', cursor: 'pointer',
                        fontFamily: 'inherit',
                      }}
                    >Cancel</button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onDelete(chat.id); setConfirmId(null) }}
                      style={{
                        padding: '5px 10px', fontSize: 12, borderRadius: 8,
                        background: '#FF5C5C', color: '#fff',
                        border: 'none', cursor: 'pointer', fontWeight: 600,
                        fontFamily: 'inherit',
                      }}
                    >Delete</button>
                  </div>
                </Motion.div>
              )}
            </Motion.div>
          )
        })}
      </div>
    </Motion.div>
  )
}

/**
 * Zara chatbot — drop-in component.
 *
 * Props:
 *   user                 { email, name? } | null
 *     If provided, the in-chat lead-form is skipped (we already know who
 *     they are) and analytics events carry their identity from the first
 *     event onwards. Useful inside authenticated apps (prompt-store).
 *
 *   theme                'dark' | 'light'  (default 'dark')
 *     Drives bubble / panel contrast. The chatbot doesn't read CSS vars
 *     for theme — host supplies this so we don't fight any global theme
 *     provider.
 *
 *   agent                object — overrides for the agent identity
 *                                 (name, welcome, suggestions, avatarUrl,
 *                                 title, id). See zaraAgent.js for defaults.
 *
 *   config               object — runtime configuration:
 *     agentApiUrl              https://agent-api.proprompt.store (default)
 *     agentId                  proprompt
 *     guestEmail               anonymous fallback (must be a registered
 *                              user on the agent platform)
 *     ticketEndpoint           optional POST endpoint for ticket creation;
 *                              if absent, the handoff card just logs locally
 *     analyticsEndpoint        chat-events ingest endpoint; if absent,
 *                              analytics are disabled
 *     analyticsSource          identifier baked into every event
 *                              (default 'proprompt-website')
 */
export default function Chatbot({
  user = null,
  theme = 'dark',
  agent: agentOverrides,
  config = {},
}) {
  const isDark = theme !== 'light'
  const agent = useMemo(() => resolveAgentConfig(agentOverrides), [agentOverrides])

  // Stable per-instance singletons for the agent client and analytics sink.
  const zaraClientRef = useRef(null)
  if (!zaraClientRef.current) {
    zaraClientRef.current = new ZaraClient({
      apiBase: config.agentApiUrl,
      agentId: config.agentId || agent.id,
      guestEmail: config.guestEmail,
    })
  }
  const analyticsRef = useRef(null)
  if (!analyticsRef.current) {
    analyticsRef.current = new ChatAnalytics({
      endpoint: config.analyticsEndpoint,
      source: config.analyticsSource,
    })
  }
  const zaraClient = zaraClientRef.current
  const analytics = analyticsRef.current

  // Bundle the handoff config so we can drill it through MessageBubble.
  const handoffConfig = useMemo(() => ({
    ticketEndpoint: config.ticketEndpoint || '',
    analyticsSource: config.analyticsSource || 'proprompt-website',
  }), [config.ticketEndpoint, config.analyticsSource])

  // When the host passes a `user` prop, treat that as the lead — skip the
  // in-chat name/email form and seed analytics with their identity.
  const seededUser = useMemo(() => {
    if (!user || !user.email) return null
    return { name: user.name || null, email: user.email, savedAt: Date.now() }
  }, [user])

  const [open, setOpen] = useState(false)
  const [view, setView] = useState('chat')

  const [chats, setChats] = useState(() => {
    const stored = safeStorageGet(STORAGE_KEY_CHATS, null)
    if (Array.isArray(stored) && stored.length > 0) return stored
    return [makeWelcomeChat(agent.welcome)]
  })
  const [activeChatId, setActiveChatId] = useState(() => {
    const stored = safeStorageGet(STORAGE_KEY_ACTIVE, null)
    return stored || null
  })
  const [userInfo, setUserInfo] = useState(
    () => seededUser || safeStorageGet(STORAGE_KEY_USER, null)
  )

  const [input, setInput] = useState('')
  const [pendingAttachments, setPendingAttachments] = useState([])
  const [typing, setTyping] = useState(false)
  const [unread, setUnread] = useState(false)
  // Replies that arrived while the chat was closed, for the bubble beside
  // the chat button: { count, author, content, isTeam, joined }.
  const [unreadPreview, setUnreadPreview] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  // "Hi, I'm Zara" greeting next to the FAB. Shows on every page load
  // for ~10s, then auto-hides for this session. Also hides immediately
  // when the user opens the chat. No persistence — fresh nudge each
  // time the page reloads.
  const [helperVisible, setHelperVisible] = useState(true)

  const scrollRef = useRef(null)
  const inputRef = useRef(null)
  const fileInputRef = useRef(null)
  const dragCounterRef = useRef(0)

  const activeChat = useMemo(() => {
    return chats.find(c => c.id === activeChatId) || chats[0]
  }, [chats, activeChatId])

  // Keep activeChatId synced if it doesn't match an existing chat.
  useEffect(() => {
    if (chats.length === 0) {
      const fresh = makeWelcomeChat(agent.welcome)
      setChats([fresh])
      setActiveChatId(fresh.id)
      return
    }
    if (!chats.find(c => c.id === activeChatId)) {
      setActiveChatId(chats[0].id)
    }
  }, [chats, activeChatId, agent.welcome])

  // If the host swaps the `user` prop after mount (e.g. login mid-session),
  // adopt their identity for subsequent chats.
  useEffect(() => {
    if (seededUser && (!userInfo || userInfo.email !== seededUser.email)) {
      setUserInfo(seededUser)
    }
  }, [seededUser, userInfo])

  // Sync the visitor's email to the agent client so subsequent chats use
  // their identity instead of the guest fallback. Also keep analytics in
  // sync so every subsequent event carries the lead identity.
  useEffect(() => {
    if (userInfo?.email) zaraClient.setUserEmail(userInfo.email)
    analytics.setVisitor(userInfo || null)
  }, [userInfo, zaraClient, analytics])

  // One-time session bootstrap: announce we're alive, then retry any events
  // that failed to send on previous visits.
  useEffect(() => {
    analytics.sessionStart()
    analytics.flushQueue()
  }, [analytics])

  // Persist.
  useEffect(() => {
    const sanitized = chats.map(c => ({
      ...c,
      messages: c.messages.map(m => ({
        ...m,
        attachments: m.attachments?.map(a => ({
          id: a.id, kind: a.kind, name: a.name, size: a.size, type: a.type,
          // url is an object URL — drop on persist; on reload it'd be invalid anyway.
        })),
      })),
    }))
    safeStorageSet(STORAGE_KEY_CHATS, sanitized)
  }, [chats])
  useEffect(() => {
    if (activeChatId) safeStorageSet(STORAGE_KEY_ACTIVE, activeChatId)
  }, [activeChatId])
  useEffect(() => {
    if (userInfo) safeStorageSet(STORAGE_KEY_USER, userInfo)
  }, [userInfo])

  // Hide the helper bubble the moment the chat is opened — even if the
  // user opens before the 10s auto-hide timer fires.
  useEffect(() => {
    if (open && helperVisible) setHelperVisible(false)
  }, [open, helperVisible])

  // Auto-hide the helper bubble 10s after first paint.
  useEffect(() => {
    if (!helperVisible) return undefined
    const t = window.setTimeout(() => setHelperVisible(false), 10000)
    return () => window.clearTimeout(t)
  }, [helperVisible])

  // Auto-scroll on new messages, and to the newest message when the chat
  // opens (replies may have arrived while it was closed).
  useEffect(() => {
    if (!open || !scrollRef.current) return undefined
    const el = scrollRef.current
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    // The panel animates in; settle at the bottom once it has.
    const t = setTimeout(() => el.scrollTo({ top: el.scrollHeight }), 350)
    return () => clearTimeout(t)
  }, [open, activeChat?.messages, typing, view])

  // Focus input when opened or view returns to chat.
  useEffect(() => {
    if (open && view === 'chat') {
      setUnread(false)
      setUnreadPreview(null)
      const id = setTimeout(() => inputRef.current?.focus(), 280)
      return () => clearTimeout(id)
    }
  }, [open, view, activeChatId])

  // Esc closes.
  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  // Revoke pending object URLs on unmount.
  useEffect(() => {
    return () => {
      pendingAttachments.forEach(a => a.url && URL.revokeObjectURL(a.url))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const updateChat = useCallback((chatId, updater) => {
    setChats(prev => prev.map(c => c.id === chatId ? { ...updater(c), updatedAt: Date.now() } : c))
  }, [])

  // ── A ProPrompt team member handling the chat ───────────────────────────
  // The backend says who (if anyone) is handling a chat and holds their
  // replies; the widget checks in while the chat is in use.
  const chatsRef = useRef(chats)
  chatsRef.current = chats
  const openRef = useRef(open)
  openRef.current = open
  const viewRef = useRef(view)
  viewRef.current = view

  const applyChatUpdates = useCallback((chatId, updates) => {
    setChats(prev => prev.map(c => {
      if (c.id !== chatId) return c
      const before = c.assignee || null
      const after = updates.assignee || null
      const known = new Set(c.messages.map(m => m.id))
      const fresh = (updates.messages || [])
        .filter(m => !known.has(m.id))
        .map(m => ({ id: m.id, role: 'human', author: m.author_name, content: m.content, at: m.occurred_at }))
      if (!fresh.length && (before?.name || null) === (after?.name || null)) return c

      let messages = c.messages
      let takeoverAt = c.takeoverAt ?? null
      let handbackContext = c.handbackContext || null
      if (!before && after) {
        takeoverAt = messages.length
        messages = [...messages, { id: newId('n'), role: 'system', kind: 'notice', content: `${after.name} from ProPrompt has joined the chat` }]
      }
      messages = [...messages, ...fresh]
      if (before && !after) {
        handbackContext = handbackNote(messages.slice(takeoverAt ?? 0), before.name)
        takeoverAt = null
        messages = [...messages, { id: newId('n'), role: 'system', kind: 'notice', content: "You're back with Zara" }]
      }
      return {
        ...c,
        assignee: after,
        takeoverAt,
        handbackContext,
        humanCursor: fresh.length ? fresh[fresh.length - 1].at : (c.humanCursor || null),
        messages,
        updatedAt: Date.now(),
      }
    }))
  }, [])

  // Show replies that arrive while the chat is closed in the bubble beside the
  // chat button (and as a count on it), until the visitor opens the chat.
  const noteReplies = useCallback((replies, joinedName = null) => {
    if (openRef.current && viewRef.current === 'chat') return
    if (!replies.length && !joinedName) return
    setUnread(true)
    setUnreadPreview(prev => {
      const latest = replies[replies.length - 1]
      return {
        count: (prev?.count || 0) + replies.length,
        author: latest ? latest.author : (prev?.author || joinedName),
        content: latest ? latest.content : (prev?.content || ''),
        isTeam: latest ? latest.isTeam : (prev ? prev.isTeam : true),
        joined: joinedName || prev?.joined || null,
      }
    })
  }, [])

  const activeChatKnown = !!activeChat?.messages.some(m => m.role === 'user')
  const activeChatAssigned = !!activeChat?.assignee
  useEffect(() => {
    if (!activeChat?.id || !activeChatKnown) return undefined
    const chatId = activeChat.id
    let stopped = false
    let timer = null

    const tick = async () => {
      clearTimeout(timer)
      if (stopped) return
      const chat = chatsRef.current.find(c => c.id === chatId)
      const visible = typeof document === 'undefined' || !document.hidden
      const inUse = open || activeChatAssigned || (chat && Date.now() - (chat.updatedAt || 0) < RECENT_CHAT_MS)
      if (chat && visible && inUse) {
        const updates = await analytics.fetchChatUpdates(chatId, chat.humanCursor || null)
        if (!stopped && updates) {
          const known = new Set(chat.messages.map(m => m.id))
          const fresh = (updates.messages || []).filter(m => !known.has(m.id))
          const joinedName = !chat.assignee && updates.assignee ? updates.assignee.name : null
          applyChatUpdates(chatId, updates)
          noteReplies(
            fresh.map(m => ({ author: m.author_name, content: m.content, isTeam: true })),
            joinedName
          )
        }
      }
      if (!stopped) timer = setTimeout(tick, open ? POLL_OPEN_MS : POLL_CLOSED_MS)
    }

    const onVisible = () => { if (!document.hidden) tick() }
    document.addEventListener('visibilitychange', onVisible)
    tick()
    return () => {
      stopped = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [activeChat?.id, activeChatKnown, activeChatAssigned, open, analytics, applyChatUpdates, noteReplies])

  // The "you have a reply" email links back with ?zara=open&chat=<id>: open
  // that chat (when it is in this browser), then tidy the address bar.
  useEffect(() => {
    if (typeof window === 'undefined') return
    let params
    try { params = new URLSearchParams(window.location.search) } catch { return }
    if (params.get('zara') !== 'open') return
    const wanted = params.get('chat')
    if (wanted && chatsRef.current.some(c => c.id === wanted)) setActiveChatId(wanted)
    setView('chat')
    setOpen(true)
    params.delete('zara')
    params.delete('chat')
    const query = params.toString()
    try {
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
    } catch { /* noop */ }
  }, [])

  const markSent = useCallback((chatId, messageId, ok, payload) => {
    updateChat(chatId, c => ({
      ...c,
      messages: c.messages.map(m => m.id === messageId
        ? { ...m, status: ok ? 'sent' : 'failed', retryPayload: ok ? undefined : payload }
        : m),
    }))
  }, [updateChat])

  const retrySend = useCallback((messageId) => {
    const chat = chatsRef.current.find(c => c.messages.some(m => m.id === messageId))
    const msg = chat?.messages.find(m => m.id === messageId)
    if (!chat || !msg?.retryPayload) return
    updateChat(chat.id, c => ({
      ...c,
      messages: c.messages.map(m => m.id === messageId ? { ...m, status: 'sending' } : m),
    }))
    analytics.resend(msg.retryPayload).then(ok => markSent(chat.id, messageId, ok, msg.retryPayload))
  }, [analytics, updateChat, markSent])

  const addFiles = useCallback((fileList) => {
    const files = Array.from(fileList || [])
    if (files.length === 0) return
    setPendingAttachments(prev => {
      const remaining = MAX_ATTACHMENTS - prev.length
      const accepted = files.slice(0, Math.max(0, remaining)).filter(f => f.size <= MAX_FILE_SIZE)
      const next = accepted.map(f => ({
        id: newAttachmentId(), file: f, kind: classifyFile(f),
        name: f.name, size: f.size, type: f.type, url: URL.createObjectURL(f),
      }))
      return [...prev, ...next]
    })
  }, [])

  const removePending = useCallback((id) => {
    setPendingAttachments(prev => {
      const removed = prev.find(p => p.id === id)
      if (removed?.url) URL.revokeObjectURL(removed.url)
      return prev.filter(p => p.id !== id)
    })
  }, [])

  const send = useCallback((text) => {
    const trimmed = (text || '').trim()
    if (!trimmed && pendingAttachments.length === 0) return
    if (typing || !activeChat) return

    const sentAttachments = pendingAttachments.map(a => ({
      id: a.id, kind: a.kind, name: a.name, size: a.size, type: a.type, url: a.url,
    }))

    const userMsg = {
      id: newId('u'), role: 'user',
      content: trimmed, attachments: sentAttachments,
    }

    const isFirstUserMessage = !activeChat.messages.some(m => m.role === 'user')
    const shouldAskLead = isFirstUserMessage && !userInfo && !activeChat.leadAsked
    const nextTitle = (c) => c.messages.some(m => m.role === 'user')
      ? c.title
      : deriveTitle(trimmed || sentAttachments[0]?.name || 'New chat')

    // A ProPrompt team member is handling this chat: the message goes to the
    // backend only (Zara stays quiet), sent now and retried if it fails.
    // Their reply arrives through the update check.
    if (activeChat.assignee) {
      const chatId = activeChat.id
      updateChat(chatId, c => ({
        ...c,
        title: nextTitle(c),
        messages: [...c.messages, { ...userMsg, status: 'sending' }],
      }))
      setInput('')
      setPendingAttachments([])
      analytics.messageSentNow({
        chatId,
        conversationId: activeChat.conversationId || null,
        messageId: userMsg.id,
        content: trimmed,
        attachments: sentAttachments,
      }).then(({ ok, payload }) => markSent(chatId, userMsg.id, ok, payload))
      if (shouldAskLead) {
        setTimeout(() => {
          updateChat(chatId, c => ({
            ...c,
            leadAsked: true,
            messages: [...c.messages, { id: newId('lead'), role: 'system', kind: 'lead-form' }],
          }))
        }, 700)
      }
      return
    }

    // Back with Zara after a person handled the chat: tell Zara what was said.
    const handback = activeChat.handbackContext || null

    updateChat(activeChat.id, c => ({
      ...c,
      title: nextTitle(c),
      messages: [...c.messages, userMsg],
      handbackContext: null,
    }))

    setInput('')
    setPendingAttachments([])
    setTyping(true)

    const chatId = activeChat.id
    const existingConversationId = activeChat.conversationId
    const visitorTurn = composeUserTurn(trimmed, sentAttachments)
    const userTurnText = handback ? `${handback}\n\n${visitorTurn}` : visitorTurn

    analytics.messageSent({
      chatId,
      conversationId: existingConversationId || null,
      messageId: userMsg.id,
      content: trimmed,
      attachments: sentAttachments,
    })

    ;(async () => {
      try {
        const result = existingConversationId
          ? await zaraClient.continue(existingConversationId, userTurnText)
          : await zaraClient.start(userTurnText)

        const { cleanText, action } = parseHandoffAction(result.message || '')
        const botMsg = {
          id: newId('b'),
          role: 'bot',
          content: cleanText || "I didn't catch that — can you rephrase?",
          ...(action ? { action } : {}),
        }
        const newConversationId = result.conversationId || existingConversationId || null
        updateChat(chatId, c => ({
          ...c,
          conversationId: result.conversationId || c.conversationId,
          messages: [...c.messages, botMsg],
        }))
        noteReplies([{ author: 'Zara', content: botMsg.content, isTeam: false }])
        analytics.messageReceived({
          chatId,
          conversationId: newConversationId,
          messageId: botMsg.id,
          content: botMsg.content,
          hasAction: !!action,
          action: action || null,
        })
        if (action) {
          analytics.ticketCreated({
            chatId,
            conversationId: newConversationId,
            messageId: botMsg.id,
            action,
          })
        }
      } catch (err) {
        const botMsg = {
          id: newId('b'),
          role: 'bot',
          content:
            `Sorry — I couldn't reach the ProPrompt agent (${err.message}). ` +
            `Check your connection or try again in a moment.`,
        }
        updateChat(chatId, c => ({ ...c, messages: [...c.messages, botMsg] }))
      } finally {
        setTyping(false)
        if (!openRef.current || viewRef.current !== 'chat') setUnread(true)
      }

      if (shouldAskLead) {
        setTimeout(() => {
          updateChat(chatId, c => ({
            ...c,
            leadAsked: true,
            messages: [...c.messages, { id: newId('lead'), role: 'system', kind: 'lead-form' }],
          }))
        }, 700)
      }
    })()
  }, [open, view, typing, pendingAttachments, activeChat, userInfo, updateChat, analytics, markSent, noteReplies])

  const submitLead = useCallback(({ name, email, company }) => {
    setUserInfo({ name, email, ...(company ? { company } : {}), savedAt: Date.now() })
    analytics.leadCaptured({ name, email, company })
    if (!activeChat) return
    const chatId = activeChat.id
    updateChat(chatId, c => ({
      ...c,
      messages: c.messages.map(m =>
        m.role === 'system' && m.kind === 'lead-form'
          ? { ...m, kind: 'lead-form-submitted', content: `Thanks, ${name.split(' ')[0]}! I'll keep things personal.` }
          : m
      ),
    }))
    setTimeout(() => {
      updateChat(chatId, c => ({
        ...c,
        messages: [...c.messages, {
          id: newId('b'),
          role: 'bot',
          content: `Great to meet you, ${name.split(' ')[0]}. Anything else I can dig into?`,
        }],
      }))
    }, 600)
  }, [activeChat, updateChat])

  const onSubmit = (e) => {
    e.preventDefault()
    send(input)
  }

  const newChat = useCallback(() => {
    const fresh = makeWelcomeChat(agent.welcome)
    setChats(prev => [fresh, ...prev])
    setActiveChatId(fresh.id)
    setView('chat')
    setInput('')
    setPendingAttachments([])
    analytics.chatStarted({ chatId: fresh.id })
  }, [agent.welcome, analytics])

  const switchChat = useCallback((id) => {
    setActiveChatId(id)
    setView('chat')
    setInput('')
    setPendingAttachments([])
    setUnread(false)
  }, [])

  const deleteChat = useCallback((id) => {
    setChats(prev => {
      const next = prev.filter(c => c.id !== id)
      if (next.length === 0) {
        const fresh = makeWelcomeChat(agent.welcome)
        setActiveChatId(fresh.id)
        return [fresh]
      }
      if (id === activeChatId) {
        setActiveChatId(next[0].id)
      }
      return next
    })
    analytics.chatDeleted({ chatId: id })
  }, [activeChatId, agent.welcome, analytics])

  // Drag & drop on the panel.
  const onDragEnter = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current += 1
    setDragOver(true)
  }
  const onDragOver = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    dragCounterRef.current -= 1
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0
      setDragOver(false)
    }
  }
  const onDrop = (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current = 0
    setDragOver(false)
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
  }

  const onPaste = (e) => {
    const items = e.clipboardData?.items
    if (!items) return
    const files = []
    for (const item of items) {
      if (item.kind === 'file') {
        const f = item.getAsFile()
        if (f) files.push(f)
      }
    }
    if (files.length) {
      e.preventDefault()
      addFiles(files)
    }
  }

  const accent = '#77D501'
  const panelBg = isDark ? '#0B0E08' : '#FFFFFF'
  const headerGradient = isDark
    ? 'linear-gradient(180deg, rgba(119,213,1,0.08) 0%, rgba(119,213,1,0) 100%)'
    : 'linear-gradient(180deg, rgba(95,170,0,0.06) 0%, rgba(95,170,0,0) 100%)'

  const canSend = (input.trim().length > 0 || pendingAttachments.length > 0) && !typing
  const showSuggestions = activeChat && activeChat.messages.length === 1 && !typing
  // A chat counts as "empty" when nothing has been said yet — only the
  // welcome bubble. We use this to hide redundant "new chat" affordances.
  const activeChatIsEmpty = !!activeChat &&
    !activeChat.messages.some(m => m.role === 'user')

  return (
    <div
      data-zara-root
      data-zara-theme={theme === 'light' ? 'light' : 'dark'}
      style={{
        // Use the Inter system stack — matches the website's brand,
        // gracefully falls back where Inter isn't loaded.
        fontFamily:
          "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        // Reset text-align so hosts like prompt-store (which sets
        // `.App { text-align: center }`) can't drag the chat bubbles
        // and panel copy into the middle of the bubble.
        textAlign: 'left',
      }}
    >
      {/* Floating launcher */}
      <AnimatePresence>
        {!open && (
          <Motion.button
            key="fab"
            initial={{ opacity: 0, scale: 0.6, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.6, y: 20 }}
            transition={{ duration: 0.35, ease }}
            whileHover={{ scale: 1.06, y: -2 }}
            whileTap={{ scale: 0.94 }}
            onClick={() => setOpen(true)}
            aria-label="Open chat"
            style={{
              position: 'fixed', right: 24, bottom: 24, zIndex: 9998,
              width: 58, height: 58, borderRadius: '50%',
              background: accent, color: '#0A0E06',
              border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 10px 32px rgba(119,213,1,0.45), 0 2px 6px rgba(0,0,0,0.3)',
            }}
          >
            <Motion.span
              aria-hidden
              animate={{ scale: [1, 1.6], opacity: [0.45, 0] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeOut' }}
              style={{
                position: 'absolute', inset: 0, borderRadius: '50%',
                background: accent, zIndex: -1,
              }}
            />
            <MessageCircle size={24} strokeWidth={2.2} />
            {unread && (
              <Motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 18 }}
                aria-label={unreadPreview?.count ? `${unreadPreview.count} new ${unreadPreview.count === 1 ? 'reply' : 'replies'}` : 'New activity'}
                style={unreadPreview?.count ? {
                  position: 'absolute', top: -2, right: -2,
                  minWidth: 20, height: 20, padding: '0 5px', borderRadius: 10,
                  background: '#FF5C5C', border: '2px solid #77D501', color: '#FFFFFF',
                  fontSize: 11, fontWeight: 700, lineHeight: '16px', textAlign: 'center',
                  boxSizing: 'border-box',
                } : {
                  position: 'absolute', top: 4, right: 4,
                  width: 12, height: 12, borderRadius: '50%',
                  background: '#FF5C5C', border: '2px solid #77D501',
                }}
              >
                {unreadPreview?.count ? (unreadPreview.count > 9 ? '9+' : unreadPreview.count) : null}
              </Motion.span>
            )}
          </Motion.button>
        )}
      </AnimatePresence>

      {/* The bubble next to the FAB. Normally a short hello from Zara that
          hides after 10s; while replies wait unread (the chat is closed) it
          shows who replied and a preview instead, until the chat is opened. */}
      <AnimatePresence>
        {!open && (helperVisible || unreadPreview) && (
          <Motion.div
            key="zara-helper"
            initial={{ opacity: 0, x: 10, y: 4 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0, x: 10, y: 4 }}
            transition={{ duration: 0.32, ease }}
            role="status"
            aria-live="polite"
            style={{
              position: 'fixed',
              right: 96,
              bottom: 36,
              zIndex: 9997,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              maxWidth: 'min(280px, calc(100vw - 112px))',
              padding: '10px 14px 10px 10px',
              borderRadius: 14,
              border: '1px solid rgba(119,213,1,0.26)',
              background: 'rgba(7,10,5,0.92)',
              color: '#FFFFFF',
              boxShadow:
                '0 18px 50px rgba(0,0,0,0.36), 0 0 28px rgba(119,213,1,0.12)',
              fontSize: 14,
              fontWeight: 600,
              lineHeight: 1.35,
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              cursor: 'pointer',
            }}
            onClick={() => {
              // Tapping the bubble itself opens the chat — saves the
              // user a second move toward the FAB.
              setHelperVisible(false)
              setView('chat')
              setOpen(true)
            }}
          >
            {unreadPreview ? (
              <>
                {unreadPreview.isTeam
                  ? <PersonAvatar size={48} name={unreadPreview.author} />
                  : <AgentAvatar size={48} agent={agent} />}
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span>
                    {unreadPreview.count > 1
                      ? `You have ${unreadPreview.count} new replies`
                      : unreadPreview.count === 1
                        ? (unreadPreview.isTeam ? `${unreadPreview.author} from ProPrompt replied` : 'Zara replied')
                        : `${unreadPreview.joined} from ProPrompt joined your chat`}
                  </span>
                  {unreadPreview.content && (
                    <span style={{
                      fontSize: 13, fontWeight: 450, color: 'rgba(255,255,255,0.72)',
                      overflow: 'hidden', display: '-webkit-box',
                      WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                    }}>
                      {replyPreviewText(unreadPreview.content)}
                    </span>
                  )}
                </span>
              </>
            ) : (
              <>
                <AgentAvatar size={48} agent={agent} />
                <span style={{ flex: 1 }}>Hi, I'm Zara. Need help? Let's chat.</span>
              </>
            )}
            {/* Speech-bubble tail pointing at the FAB on the right. */}
            <span
              aria-hidden
              style={{
                position: 'absolute',
                right: -7,
                top: '50%',
                width: 12,
                height: 12,
                transform: 'translateY(-50%) rotate(45deg)',
                borderTop: '1px solid rgba(119,213,1,0.26)',
                borderRight: '1px solid rgba(119,213,1,0.26)',
                background: 'rgba(7,10,5,0.92)',
              }}
            />
          </Motion.div>
        )}
      </AnimatePresence>

      {/* Chat panel */}
      <AnimatePresence>
        {open && (
          <Motion.div
            key="panel"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.32, ease }}
            role="dialog"
            aria-label="ProPrompt chat"
            className="chatbot-panel"
            onDragEnter={onDragEnter}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onPaste={onPaste}
            style={{
              position: 'fixed', right: 24, bottom: 24, zIndex: 9999,
              width: 380, maxWidth: 'calc(100vw - 32px)',
              height: 580, maxHeight: 'calc(100vh - 48px)',
              background: panelBg, borderRadius: 20,
              border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: isDark
                ? '0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(119,213,1,0.06)'
                : '0 24px 80px rgba(0,0,0,0.18)',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              transformOrigin: 'bottom right',
            }}
          >
            {/* Drag overlay */}
            <AnimatePresence>
              {dragOver && view === 'chat' && (
                <Motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{
                    position: 'absolute', inset: 8, borderRadius: 14,
                    border: '2px dashed #77D501',
                    background: isDark ? 'rgba(119,213,1,0.07)' : 'rgba(95,170,0,0.08)',
                    backdropFilter: 'blur(6px)', zIndex: 5,
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 10,
                    pointerEvents: 'none',
                  }}
                >
                  <Motion.div
                    animate={{ y: [0, -4, 0] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
                    style={{
                      width: 46, height: 46, borderRadius: 14,
                      background: 'rgba(119,213,1,0.14)', color: '#77D501',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      border: '1px solid rgba(119,213,1,0.24)',
                    }}
                  >
                    <UploadCloud size={22} />
                  </Motion.div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#FFFFFF' }}>Drop to attach</div>
                  <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>Images, video, audio, or documents</div>
                </Motion.div>
              )}
            </AnimatePresence>

            {/* Header */}
            <div
              style={{
                position: 'relative', padding: '14px 14px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.07)', background: headerGradient,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {view === 'chat' ? (
                  <button
                    onClick={() => setView('list')}
                    aria-label="View all chats"
                    style={{
                      width: 34, height: 34, borderRadius: 10,
                      background: 'transparent', border: '1px solid rgba(255,255,255,0.07)',
                      color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                      transition: 'all 0.18s ease',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(119,213,1,0.14)'
                      e.currentTarget.style.color = '#77D501'
                      e.currentTarget.style.borderColor = 'rgba(119,213,1,0.24)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = 'rgba(255,255,255,0.55)'
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'
                    }}
                  >
                    <MessagesSquare size={15} />
                  </button>
                ) : (
                  <button
                    onClick={() => setView('chat')}
                    aria-label="Back to chat"
                    style={{
                      width: 34, height: 34, borderRadius: 10,
                      background: 'transparent', border: '1px solid rgba(255,255,255,0.07)',
                      color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      flexShrink: 0,
                      transition: 'all 0.18s ease',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(119,213,1,0.14)'
                      e.currentTarget.style.color = '#77D501'
                      e.currentTarget.style.borderColor = 'rgba(119,213,1,0.24)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = 'rgba(255,255,255,0.55)'
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'
                    }}
                  >
                    <ArrowLeft size={15} />
                  </button>
                )}

                {view === 'chat' ? (
                  <>
                    {activeChat?.assignee
                      ? <PersonAvatar size={36} name={activeChat.assignee.name} />
                      : <AgentAvatar size={36} agent={agent} />}

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14.5, fontWeight: 700, color: '#FFFFFF',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {activeChat?.assignee ? `${activeChat.assignee.name} · ProPrompt team` : agent.name}
                      </div>
                      <div
                        style={{
                          fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 1,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                      >
                        {activeChat?.assignee
                          ? 'A person from ProPrompt is helping you'
                          : activeChat?.title && activeChat.title !== 'New chat'
                            ? activeChat.title
                            : agent.title}
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, color: '#FFFFFF' }}>
                      Your chats
                    </div>
                    <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', marginTop: 1 }}>
                      {chats.length} {chats.length === 1 ? 'conversation' : 'conversations'}
                    </div>
                  </div>
                )}

                {view === 'chat' && !activeChatIsEmpty && (
                  <button
                    onClick={newChat}
                    aria-label="New chat"
                    title="New chat"
                    style={{
                      width: 32, height: 32, borderRadius: 10,
                      background: 'transparent', border: '1px solid rgba(255,255,255,0.07)',
                      color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.18s ease',
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.background = 'rgba(119,213,1,0.14)'
                      e.currentTarget.style.color = '#77D501'
                      e.currentTarget.style.borderColor = 'rgba(119,213,1,0.24)'
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.background = 'transparent'
                      e.currentTarget.style.color = 'rgba(255,255,255,0.55)'
                      e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'
                    }}
                  >
                    <Plus size={15} />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close chat"
                  style={{
                    width: 32, height: 32, borderRadius: 10,
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.07)',
                    color: 'rgba(255,255,255,0.55)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'all 0.18s ease',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.background = 'rgba(119,213,1,0.14)'
                    e.currentTarget.style.color = '#FFFFFF'
                    e.currentTarget.style.borderColor = 'rgba(119,213,1,0.24)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'rgba(255,255,255,0.55)'
                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'
                  }}
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Body */}
            <AnimatePresence mode="wait" initial={false}>
              {view === 'list' ? (
                <ChatListView
                  key="list-view"
                  chats={chats}
                  activeChatId={activeChatId}
                  onSelect={switchChat}
                  onNew={newChat}
                  onDelete={deleteChat}
                  isDark={isDark}
                  canCreateNew={!chats.some(c => !c.messages.some(m => m.role === 'user'))}
                />
              ) : (
                <Motion.div
                  key="chat-view"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ duration: 0.24, ease }}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
                >
                  <div
                    ref={scrollRef}
                    className="chatbot-scroll"
                    style={{
                      flex: 1, overflowY: 'auto', padding: '20px 18px',
                      display: 'flex', flexDirection: 'column', gap: 12,
                    }}
                  >
                    {activeChat?.messages.map(m => {
                      if (m.role === 'system' && m.kind === 'lead-form') {
                        return (
                          <Motion.div
                            key={m.id}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.3 }}
                            style={{ display: 'flex', justifyContent: 'flex-start' }}
                          >
                            <LeadForm onSubmit={submitLead} isDark={isDark} />
                          </Motion.div>
                        )
                      }
                      return (
                        <MessageBubble
                          key={m.id}
                          msg={m}
                          isDark={isDark}
                          userInfo={userInfo}
                          handoffConfig={handoffConfig}
                          onRetry={retrySend}
                        />
                      )
                    })}

                    {typing && (
                      <Motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25 }}
                        style={{ display: 'flex', justifyContent: 'flex-start' }}
                      >
                        <div
                          style={{
                            padding: '10px 14px', borderRadius: '18px 18px 18px 4px',
                            background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,26,8,0.04)',
                            border: '1px solid rgba(255,255,255,0.07)',
                          }}
                        >
                          <TypingDots />
                        </div>
                      </Motion.div>
                    )}

                    {showSuggestions && (
                      <Motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.15, duration: 0.4, ease }}
                        style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}
                      >
                        {agent.suggestions.map((s, i) => (
                          <Motion.button
                            key={s}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.2 + i * 0.06, duration: 0.3, ease }}
                            whileHover={{ y: -1 }}
                            whileTap={{ scale: 0.97 }}
                            onClick={() => send(s)}
                            style={{
                              padding: '7px 12px', borderRadius: 999,
                              background: 'rgba(119,213,1,0.14)', color: '#77D501',
                              border: '1px solid rgba(119,213,1,0.24)',
                              fontSize: 12.5, fontWeight: 500,
                              cursor: 'pointer', fontFamily: 'inherit',
                              transition: 'background 0.2s ease, border-color 0.2s ease',
                            }}
                          >
                            {s}
                          </Motion.button>
                        ))}
                      </Motion.div>
                    )}
                  </div>

                  {/* Input */}
                  <form
                    onSubmit={onSubmit}
                    style={{
                      padding: '12px 14px 14px',
                      borderTop: '1px solid rgba(255,255,255,0.07)',
                      background: isDark ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.015)',
                    }}
                  >
                    <AnimatePresence initial={false}>
                      {pendingAttachments.length > 0 && (
                        <Motion.div
                          layout
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.22, ease }}
                          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, paddingBottom: 10, overflow: 'hidden' }}
                        >
                          <AnimatePresence initial={false}>
                            {pendingAttachments.map(att => (
                              <AttachmentTile
                                key={att.id} att={att}
                                onRemove={removePending}
                                isDark={isDark} compact
                              />
                            ))}
                          </AnimatePresence>
                        </Motion.div>
                      )}
                    </AnimatePresence>

                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: '#0D1009', border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 14, padding: '6px',
                        transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(119,213,1,0.24)'
                        e.currentTarget.style.boxShadow = '0 0 0 3px rgba(119,213,1,0.14)'
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.12)'
                        e.currentTarget.style.boxShadow = 'none'
                      }}
                    >
                      <Motion.button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        whileHover={{ scale: 1.06 }}
                        whileTap={{ scale: 0.92 }}
                        aria-label="Attach files"
                        disabled={pendingAttachments.length >= MAX_ATTACHMENTS}
                        style={{
                          width: 34, height: 34, borderRadius: 10,
                          background: 'transparent', color: 'rgba(255,255,255,0.55)',
                          border: 'none',
                          cursor: pendingAttachments.length >= MAX_ATTACHMENTS ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                          opacity: pendingAttachments.length >= MAX_ATTACHMENTS ? 0.4 : 1,
                          transition: 'background 0.15s ease, color 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (pendingAttachments.length >= MAX_ATTACHMENTS) return
                          e.currentTarget.style.background = 'rgba(119,213,1,0.14)'
                          e.currentTarget.style.color = '#77D501'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = 'transparent'
                          e.currentTarget.style.color = 'rgba(255,255,255,0.55)'
                        }}
                      >
                        <Paperclip size={17} />
                      </Motion.button>
                      <input
                        ref={inputRef}
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type a message…"
                        aria-label="Message"
                        style={{
                          flex: 1, background: 'transparent', border: 'none', outline: 'none',
                          color: '#FFFFFF', fontFamily: 'inherit',
                          fontSize: 14, fontWeight: 450, padding: '8px 6px',
                        }}
                      />
                      <Motion.button
                        type="submit"
                        disabled={!canSend}
                        whileHover={canSend ? { scale: 1.05 } : undefined}
                        whileTap={canSend ? { scale: 0.92 } : undefined}
                        aria-label="Send message"
                        style={{
                          width: 34, height: 34, borderRadius: 10,
                          background: canSend ? accent : 'rgba(255,255,255,0.07)',
                          color: canSend ? '#0A0E06' : 'rgba(255,255,255,0.35)',
                          border: 'none',
                          cursor: canSend ? 'pointer' : 'not-allowed',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          flexShrink: 0,
                          transition: 'background 0.2s ease, color 0.2s ease',
                        }}
                      >
                        <ArrowUp size={16} strokeWidth={2.6} />
                      </Motion.button>
                    </div>

                    <input
                      ref={fileInputRef}
                      type="file" multiple
                      onChange={(e) => {
                        addFiles(e.target.files)
                        e.target.value = ''
                      }}
                      style={{ display: 'none' }}
                      aria-hidden="true"
                    />

                    <div
                      style={{
                        fontSize: 10.5, color: 'rgba(255,255,255,0.35)',
                        textAlign: 'center', marginTop: 8, letterSpacing: 0.2,
                      }}
                    >
                      Powered by ProPrompt · drag, paste or attach files · Esc to close
                    </div>
                  </form>
                </Motion.div>
              )}
            </AnimatePresence>
          </Motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .chatbot-scroll::-webkit-scrollbar { width: 6px; }
        .chatbot-scroll::-webkit-scrollbar-track { background: transparent; }
        .chatbot-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
        .chatbot-scroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
        .chatbot-list-row:hover .chatbot-list-trash { opacity: 1 !important; }
        /* Markdown bubble normalisation */
        .chatbot-md > *:first-child { margin-top: 0 !important; }
        .chatbot-md > *:last-child { margin-bottom: 0 !important; }
        .chatbot-md a:hover { opacity: 0.85; }
        @media (max-width: 480px) {
          .chatbot-panel {
            right: 12px !important; left: 12px !important; bottom: 12px !important;
            width: auto !important; max-width: none !important;
            height: calc(100vh - 24px) !important; max-height: calc(100vh - 24px) !important;
          }
        }
      `}</style>
    </div>
  )
}
