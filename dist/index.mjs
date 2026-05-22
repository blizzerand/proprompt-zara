/* @proprompt/zara v1.0.0 */

// src/Chatbot.jsx
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion as Motion, AnimatePresence } from "framer-motion";
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
  Ticket
} from "lucide-react";

// src/zaraAgent.js
var DEFAULT_AGENT = {
  id: "proprompt",
  name: "Zara",
  title: "ProPrompt Website Support",
  welcome: "Hi, I'm Zara.\n\nAsk me anything, or tell me what you need help with today. I'll point you to the right AI employee.\n\nOh, and by the way, you can try any AI employee free for 14 days. No credit card needed.",
  suggestions: [
    "What are AI Employees?",
    "How does pricing work?",
    "Which agent should I start with?",
    "How do I start the 14-day trial?"
  ],
  // Avatar lives on agent-api by default; can be overridden via config.
  avatarUrl: "https://agent-api.proprompt.store/static/agent_images/proprompt_small_b0ed2d76"
};
function resolveAgentConfig(overrides = {}) {
  return {
    ...DEFAULT_AGENT,
    ...overrides,
    suggestions: overrides.suggestions || DEFAULT_AGENT.suggestions
  };
}

// src/zaraClient.js
var HTTPS_TO_WSS = (u) => u.replace(/^http(s?):\/\//, (_, s) => `ws${s}://`);
var TERMINAL_REPLY_TYPES = /* @__PURE__ */ new Set([
  "session_updated",
  "session_created",
  "session_loaded"
]);
var DEFAULTS = {
  apiBase: "https://agent-api.proprompt.store",
  agentId: "proprompt",
  guestEmail: "support@codedesign.app"
};
var ZaraClient = class {
  constructor(options = {}) {
    const { apiBase, agentId, guestEmail } = { ...DEFAULTS, ...options };
    this.wsBase = HTTPS_TO_WSS(apiBase);
    this.agentId = agentId;
    this.guestEmail = guestEmail;
    this.ws = null;
    this.userEmail = null;
    this.clientId = `pp_web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this._connectPromise = null;
    this._pending = null;
  }
  setUserEmail(email) {
    const normalized = email && email.trim() || null;
    if (this.userEmail === normalized) return;
    this.userEmail = normalized;
    this._disconnect();
  }
  _disconnect() {
    if (this.ws) {
      try {
        this.ws.close(1e3, "reconfigure");
      } catch {
      }
    }
    this.ws = null;
    this._connectPromise = null;
    if (this._pending) {
      try {
        this._pending.reject(new Error("Connection reset"));
      } catch {
      }
      clearTimeout(this._pending.timer);
      this._pending = null;
    }
  }
  async _connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this._connectPromise) return this._connectPromise;
    const email = this.userEmail || this.guestEmail;
    const url = `${this.wsBase}/ws/${this.clientId}?user_email=${encodeURIComponent(email)}&agent_id=${encodeURIComponent(this.agentId)}`;
    this._connectPromise = new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }
      const timeout = setTimeout(() => {
        try {
          ws.close();
        } catch {
        }
        reject(new Error("WebSocket connection timed out"));
      }, 12e3);
      ws.addEventListener("open", () => {
        clearTimeout(timeout);
        this.ws = ws;
        resolve();
      });
      ws.addEventListener("error", () => clearTimeout(timeout));
      ws.addEventListener("close", () => {
        clearTimeout(timeout);
        this.ws = null;
        this._connectPromise = null;
        if (this._pending) {
          try {
            this._pending.reject(new Error("Connection closed"));
          } catch {
          }
          clearTimeout(this._pending.timer);
          this._pending = null;
        }
        reject(new Error("WebSocket closed before opening"));
      });
      ws.addEventListener("message", (event) => this._handleMessage(event));
    });
    return this._connectPromise;
  }
  _handleMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!this._pending) return;
    if (TERMINAL_REPLY_TYPES.has(msg.type)) {
      const pending = this._pending;
      this._pending = null;
      clearTimeout(pending.timer);
      pending.resolve({
        message: msg.message || msg.result || "",
        conversationId: msg.conversation_id,
        status: msg.status
      });
    } else if (msg.type === "error") {
      const pending = this._pending;
      this._pending = null;
      clearTimeout(pending.timer);
      pending.reject(new Error(msg.error || msg.message || "Agent error"));
    }
  }
  async _send(payload, { timeoutMs = 6e4 } = {}) {
    await this._connect();
    if (this._pending) throw new Error("Another request is already in flight");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending = null;
        reject(new Error("Agent did not respond in time"));
      }, timeoutMs);
      this._pending = { resolve, reject, timer };
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this._pending = null;
        reject(err);
      }
    });
  }
  async start(userRequest) {
    return this._send({ type: "start_interaction", user_request: userRequest, project_id: null });
  }
  async continue(conversationId, answer) {
    return this._send({ type: "continue_interaction", conversation_id: conversationId, answer });
  }
  disconnect() {
    this._disconnect();
  }
};

// src/analytics.js
var VISITOR_ID_KEY = "pp_visitor_id";
var QUEUE_KEY = "pp_analytics_queue";
var MAX_QUEUE_SIZE = 50;
function makeUUID() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function getOrCreateVisitorId() {
  try {
    let id = window.localStorage.getItem(VISITOR_ID_KEY);
    if (!id) {
      id = makeUUID();
      window.localStorage.setItem(VISITOR_ID_KEY, id);
    }
    return id;
  } catch {
    return "unknown";
  }
}
var ChatAnalytics = class {
  constructor({ endpoint, source = "proprompt-website", enabled = true } = {}) {
    this.endpoint = endpoint || null;
    this.source = source;
    this.enabled = enabled !== false && Boolean(endpoint);
    this.sessionId = null;
    this.visitor = null;
  }
  _getSessionId() {
    if (!this.sessionId) {
      this.sessionId = `s_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    }
    return this.sessionId;
  }
  setVisitor(info) {
    this.visitor = info && info.email ? { name: info.name || null, email: info.email } : null;
  }
  _envelope(event, data) {
    return {
      event,
      event_id: makeUUID(),
      occurred_at: (/* @__PURE__ */ new Date()).toISOString(),
      source: this.source,
      visitor_id: getOrCreateVisitorId(),
      session_id: this._getSessionId(),
      visitor: this.visitor,
      page: typeof window !== "undefined" ? {
        url: window.location.href,
        referrer: document.referrer || null,
        title: document.title || null
      } : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      data: data || {}
    };
  }
  _enqueue(payload) {
    try {
      const raw = window.localStorage.getItem(QUEUE_KEY);
      const queue = raw ? JSON.parse(raw) : [];
      queue.push(payload);
      window.localStorage.setItem(
        QUEUE_KEY,
        JSON.stringify(queue.slice(-MAX_QUEUE_SIZE))
      );
    } catch {
    }
  }
  async _transmit(payload) {
    if (!this.enabled) return false;
    try {
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      });
      return res.ok;
    } catch {
      return false;
    }
  }
  _send(event, data) {
    if (!this.enabled) return;
    const payload = this._envelope(event, data);
    this._transmit(payload).then((ok) => {
      if (!ok) this._enqueue(payload);
    });
  }
  async flushQueue() {
    if (!this.enabled || typeof window === "undefined") return;
    let queue;
    try {
      queue = JSON.parse(window.localStorage.getItem(QUEUE_KEY) || "[]");
    } catch {
      queue = [];
    }
    if (!Array.isArray(queue) || queue.length === 0) return;
    const remaining = [];
    for (const payload of queue) {
      const ok = await this._transmit(payload);
      if (!ok) remaining.push(payload);
    }
    try {
      window.localStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    } catch {
    }
  }
  sessionStart() {
    this._send("session_start", {});
  }
  chatStarted({ chatId }) {
    this._send("chat_started", { chat_id: chatId });
  }
  messageSent({ chatId, conversationId, messageId, content, attachments }) {
    this._send("message_sent", {
      chat_id: chatId,
      conversation_id: conversationId || null,
      message_id: messageId,
      content,
      attachments: (attachments || []).map((a) => ({
        name: a.name,
        kind: a.kind,
        size: a.size,
        type: a.type || null
      }))
    });
  }
  messageReceived({ chatId, conversationId, messageId, content, hasAction, action }) {
    this._send("message_received", {
      chat_id: chatId,
      conversation_id: conversationId || null,
      message_id: messageId,
      content,
      has_action: !!hasAction,
      action: action || null
    });
  }
  leadCaptured({ name, email }) {
    this._send("lead_captured", { name, email });
  }
  ticketCreated({ chatId, conversationId, messageId, action }) {
    this._send("ticket_created", {
      chat_id: chatId,
      conversation_id: conversationId || null,
      message_id: messageId,
      reason: action.reason,
      summary: action.summary,
      urgency: action.urgency
    });
  }
  whatsappClicked({ chatId, conversationId, messageId, action, destination }) {
    this._send("whatsapp_clicked", {
      chat_id: chatId,
      conversation_id: conversationId || null,
      message_id: messageId,
      destination: destination || null,
      reason: action?.reason || null,
      summary: action?.summary || null
    });
  }
  chatDeleted({ chatId }) {
    this._send("chat_deleted", { chat_id: chatId });
  }
};

// src/Chatbot.jsx
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
var ZARA_THEME_VARS = {
  dark: {
    "--zara-primary": "#77D501",
    "--zara-primary-light": "#8FE620",
    "--zara-primary-dim": "rgba(119,213,1,0.14)",
    "--zara-primary-border": "rgba(119,213,1,0.24)",
    "--zara-primary-text": "#0A0E06",
    "--zara-bg-base": "#070A05",
    "--zara-bg-alt": "#0A0D07",
    "--zara-bg-deep": "#0B0E08",
    "--zara-bg-card": "#0D1009",
    "--zara-bg-card-hover": "#101408",
    "--zara-border": "rgba(255,255,255,0.07)",
    "--zara-border-md": "rgba(255,255,255,0.12)",
    "--zara-border-strong": "rgba(255,255,255,0.18)",
    "--zara-text-primary": "#FFFFFF",
    "--zara-text-muted": "rgba(255,255,255,0.55)",
    "--zara-text-dim": "rgba(255,255,255,0.35)",
    "--zara-text-placeholder": "rgba(255,255,255,0.25)",
    // Aliased to legacy names too so existing var(--bg-base) refs inside
    // this component resolve without rewriting every style block.
    "--primary": "#77D501",
    "--primary-light": "#8FE620",
    "--primary-dim": "rgba(119,213,1,0.14)",
    "--primary-border": "rgba(119,213,1,0.24)",
    "--primary-text": "#0A0E06",
    "--bg-base": "#070A05",
    "--bg-alt": "#0A0D07",
    "--bg-deep": "#0B0E08",
    "--bg-card": "#0D1009",
    "--bg-card-hover": "#101408",
    "--border": "rgba(255,255,255,0.07)",
    "--border-md": "rgba(255,255,255,0.12)",
    "--border-strong": "rgba(255,255,255,0.18)",
    "--text-primary": "#FFFFFF",
    "--text-muted": "rgba(255,255,255,0.55)",
    "--text-dim": "rgba(255,255,255,0.35)",
    "--text-placeholder": "rgba(255,255,255,0.25)"
  },
  light: {
    "--zara-primary": "#5FAA00",
    "--zara-primary-light": "#77D501",
    "--zara-primary-dim": "rgba(95,170,0,0.10)",
    "--zara-primary-border": "rgba(95,170,0,0.22)",
    "--zara-primary-text": "#FFFFFF",
    "--zara-bg-base": "#FAFCF8",
    "--zara-bg-alt": "#F3F7EF",
    "--zara-bg-deep": "#EDF3E8",
    "--zara-bg-card": "#FFFFFF",
    "--zara-bg-card-hover": "#F7FAF4",
    "--zara-border": "rgba(0,0,0,0.07)",
    "--zara-border-md": "rgba(0,0,0,0.12)",
    "--zara-border-strong": "rgba(0,0,0,0.18)",
    "--zara-text-primary": "#0F1A08",
    "--zara-text-muted": "rgba(15,26,8,0.55)",
    "--zara-text-dim": "rgba(15,26,8,0.38)",
    "--zara-text-placeholder": "rgba(15,26,8,0.25)",
    "--primary": "#5FAA00",
    "--primary-light": "#77D501",
    "--primary-dim": "rgba(95,170,0,0.10)",
    "--primary-border": "rgba(95,170,0,0.22)",
    "--primary-text": "#FFFFFF",
    "--bg-base": "#FAFCF8",
    "--bg-alt": "#F3F7EF",
    "--bg-deep": "#EDF3E8",
    "--bg-card": "#FFFFFF",
    "--bg-card-hover": "#F7FAF4",
    "--border": "rgba(0,0,0,0.07)",
    "--border-md": "rgba(0,0,0,0.12)",
    "--border-strong": "rgba(0,0,0,0.18)",
    "--text-primary": "#0F1A08",
    "--text-muted": "rgba(15,26,8,0.55)",
    "--text-dim": "rgba(15,26,8,0.38)",
    "--text-placeholder": "rgba(15,26,8,0.25)"
  }
};
function normalizeBotMarkdown(text) {
  return String(text || "").replace(/\\([[\]()])/g, "$1").replace(/[［【〔]/g, "[").replace(/[］】〕]/g, "]").replace(/（/g, "(").replace(/）/g, ")").replace(/\]\s+\(/g, "](").replace(/ /g, " ").replace(/[​-‏﻿]/g, "");
}
var INLINE_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)<>"]+)/g;
function renderInline(text) {
  const out = [];
  let lastIndex = 0;
  let key = 0;
  let match;
  INLINE_LINK_RE.lastIndex = 0;
  while ((match = INLINE_LINK_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(text.slice(lastIndex, match.index));
    }
    const [whole, mdLabel, mdUrl, bareUrl] = match;
    const url = mdUrl || bareUrl;
    const label = mdLabel || url;
    out.push(
      /* @__PURE__ */ jsx(
        "a",
        {
          href: url,
          target: "_blank",
          rel: "noopener noreferrer",
          style: {
            color: "var(--primary)",
            textDecoration: "underline",
            textUnderlineOffset: 2,
            textDecorationThickness: 1,
            wordBreak: "break-word"
          },
          children: label
        },
        `a-${key++}`
      )
    );
    lastIndex = match.index + whole.length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}
function ChatMessageText({ children }) {
  const clean = normalizeBotMarkdown(children);
  const blocks = clean.split(/\n{2,}/).filter(Boolean);
  return /* @__PURE__ */ jsx(Fragment, { children: blocks.map((block, blockIndex) => {
    const lines = block.split("\n").filter(Boolean);
    const isList = lines.every((line) => /^\s*([-*]|\d+\.)\s+/.test(line));
    if (isList) {
      return /* @__PURE__ */ jsx("ul", { style: { margin: "4px 0 8px", paddingLeft: 20 }, children: lines.map((line, lineIndex) => /* @__PURE__ */ jsx("li", { style: { margin: "2px 0", lineHeight: 1.5 }, children: renderInline(line.replace(/^\s*([-*]|\d+\.)\s+/, "")) }, `line-${lineIndex}`)) }, `block-${blockIndex}`);
    }
    return /* @__PURE__ */ jsx("p", { style: { margin: "0 0 8px", lineHeight: 1.5, whiteSpace: "pre-line" }, children: renderInline(block.replace(/^#{1,4}\s+/gm, "")) }, `block-${blockIndex}`);
  }) });
}
var ease = [0.22, 1, 0.36, 1];
var MAX_FILE_SIZE = 25 * 1024 * 1024;
var MAX_ATTACHMENTS = 4;
var STORAGE_KEY_CHATS = "pp_chatbot_chats_v1";
var STORAGE_KEY_ACTIVE = "pp_chatbot_active_v1";
var STORAGE_KEY_USER = "pp_chatbot_user_v1";
var attachmentSeq = 0;
var newAttachmentId = () => `att-${Date.now()}-${attachmentSeq++}`;
var newId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
function classifyFile(file) {
  const t = file.type || "";
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  return "file";
}
function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
function relativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 6e4);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
function fileKindIcon(kind, size = 16) {
  if (kind === "image") return /* @__PURE__ */ jsx(ImageIcon, { size });
  if (kind === "video") return /* @__PURE__ */ jsx(Film, { size });
  if (kind === "audio") return /* @__PURE__ */ jsx(Music, { size });
  if (kind === "file") return /* @__PURE__ */ jsx(FileText, { size });
  return /* @__PURE__ */ jsx(FileIcon, { size });
}
var isValidEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());
function safeStorageGet(key, fallback) {
  try {
    if (typeof window === "undefined") return fallback;
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function safeStorageSet(key, value) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
  }
}
function makeWelcomeChat(welcomeMessage) {
  return {
    id: newId("chat"),
    title: "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [{ id: "welcome", role: "bot", content: welcomeMessage }],
    leadAsked: false
  };
}
function deriveTitle(text) {
  if (!text) return "New chat";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 36 ? t.slice(0, 36).trimEnd() + "\u2026" : t;
}
function lastMessagePreview(chat) {
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i];
    if (m.role === "system") continue;
    if (m.content) return m.content.replace(/\s+/g, " ").slice(0, 60);
    if (m.attachments?.length) return `\u{1F4CE} ${m.attachments.length} attachment${m.attachments.length > 1 ? "s" : ""}`;
  }
  return "";
}
function composeUserTurn(text, attachments) {
  let out = text || "";
  if (attachments && attachments.length > 0) {
    const names = attachments.map((a) => `${a.name} (${a.kind})`).join(", ");
    out = out ? `${out}

[Visitor attached: ${names}]` : `[Visitor attached: ${names}]`;
  }
  return out.trim();
}
var VALID_REASONS = /* @__PURE__ */ new Set([
  "general_inquiry",
  "demo_request",
  "sales_question",
  "billing_issue",
  "technical_issue",
  "complaint",
  "partnership",
  "other"
]);
function parseHandoffAction(text) {
  if (!text || typeof text !== "string") {
    return { cleanText: text || "", action: null };
  }
  const fenceRegex = /```action\s*\n([\s\S]+?)\n```\s*$/i;
  const match = text.match(fenceRegex);
  if (!match) return { cleanText: text, action: null };
  let raw = match[1].trim();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const innerMatch = raw.match(/\{[\s\S]*\}/);
    if (innerMatch) {
      try {
        parsed = JSON.parse(innerMatch[0]);
      } catch {
      }
    }
  }
  if (!parsed || parsed.type !== "human_handoff") {
    return { cleanText: text, action: null };
  }
  const action = {
    type: "human_handoff",
    reason: VALID_REASONS.has(parsed.reason) ? parsed.reason : "general_inquiry",
    summary: typeof parsed.summary === "string" ? parsed.summary.trim() : "",
    urgency: ["low", "medium", "high"].includes(parsed.urgency) ? parsed.urgency : "medium"
  };
  const cleanText = text.slice(0, match.index).trimEnd();
  return { cleanText, action };
}
function WhatsAppIcon({ size = 16 }) {
  return /* @__PURE__ */ jsx(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "currentColor",
      "aria-hidden": "true",
      children: /* @__PURE__ */ jsx("path", { d: "M17.498 14.382c-.301-.15-1.767-.867-2.04-.966-.273-.101-.473-.15-.673.15-.197.295-.771.964-.944 1.162-.175.195-.349.21-.646.075-.3-.15-1.263-.465-2.403-1.485-.888-.795-1.484-1.77-1.66-2.07-.174-.3-.019-.465.13-.615.136-.135.301-.345.451-.523.146-.181.194-.301.297-.496.1-.21.049-.375-.025-.524-.075-.15-.672-1.62-.922-2.206-.24-.584-.487-.51-.672-.51-.172-.015-.371-.015-.571-.015-.2 0-.523.074-.797.359-.273.3-1.045 1.02-1.045 2.475s1.07 2.865 1.219 3.075c.149.195 2.105 3.195 5.1 4.485.714.3 1.27.48 1.704.629.714.227 1.365.195 1.88.121.574-.091 1.767-.721 2.016-1.426.255-.705.255-1.29.18-1.425-.074-.135-.27-.21-.57-.345m-5.446 7.443h-.016c-1.77 0-3.524-.48-5.055-1.38l-.36-.214-3.75.975 1.005-3.645-.239-.375c-.99-1.576-1.516-3.391-1.516-5.26 0-5.445 4.455-9.885 9.942-9.885 2.654 0 5.145 1.035 7.021 2.91 1.875 1.875 2.909 4.367 2.909 7.02-.004 5.444-4.46 9.885-9.935 9.885M20.52 3.449C18.24 1.245 15.24 0 12.045 0 5.463 0 .104 5.334.101 11.893c0 2.096.549 4.14 1.595 5.945L0 24l6.335-1.652c1.746.943 3.71 1.444 5.71 1.447h.006c6.585 0 11.946-5.336 11.949-11.896 0-3.176-1.24-6.165-3.495-8.411" })
    }
  );
}
function HandoffCard({
  msgId,
  action,
  userInfo,
  isDark,
  onWhatsappClick,
  whatsappNumber,
  whatsappPerson,
  ticketEndpoint,
  analyticsSource
}) {
  const storageKey = `pp_ticket_submitted_${msgId}`;
  const [status, setStatus] = useState(() => {
    if (typeof window !== "undefined" && window.localStorage.getItem(storageKey)) {
      return "success";
    }
    return "pending";
  });
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (status === "success") return;
    const payload = {
      ...action,
      visitor: userInfo || null,
      source: analyticsSource || "website-chat",
      created_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    if (!ticketEndpoint) {
      console.info("[Zara chat] Ticket payload (no ticketEndpoint configured):", payload);
      window.localStorage.setItem(storageKey, "1");
      setStatus("success");
      return;
    }
    setStatus("submitting");
    fetch(ticketEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).then((r) => {
      if (r.ok) {
        window.localStorage.setItem(storageKey, "1");
        setStatus("success");
      } else {
        setStatus("failed");
      }
    }).catch(() => setStatus("failed"));
  }, [action, userInfo, status, storageKey, ticketEndpoint, analyticsSource]);
  const waMessage = encodeURIComponent(
    "Hey! I had a few questions about Proprompt, can we connect?"
  );
  const waUrl = whatsappNumber ? `https://wa.me/${whatsappNumber}?text=${waMessage}` : null;
  const statusColor = status === "failed" ? "#FF5C5C" : "var(--primary)";
  const statusBg = status === "failed" ? "rgba(255,92,92,0.15)" : "var(--primary-dim)";
  return /* @__PURE__ */ jsxs(
    Motion.div,
    {
      initial: { opacity: 0, y: 6 },
      animate: { opacity: 1, y: 0 },
      transition: { duration: 0.35, ease, delay: 0.15 },
      style: {
        marginTop: 8,
        padding: 12,
        borderRadius: 14,
        background: isDark ? "rgba(255,255,255,0.035)" : "rgba(15,26,8,0.04)",
        border: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        maxWidth: "92%"
      },
      children: [
        /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [
          /* @__PURE__ */ jsxs(
            Motion.div,
            {
              initial: { scale: 0.7 },
              animate: { scale: 1 },
              transition: { type: "spring", stiffness: 400, damping: 20 },
              style: {
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: statusBg,
                color: statusColor,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                border: `1px solid ${statusColor}`
              },
              children: [
                status === "submitting" && /* @__PURE__ */ jsx(
                  Motion.span,
                  {
                    animate: { rotate: 360 },
                    transition: { duration: 1, repeat: Infinity, ease: "linear" },
                    style: { display: "flex" },
                    children: /* @__PURE__ */ jsx(Loader2, { size: 13 })
                  }
                ),
                status === "failed" && /* @__PURE__ */ jsx(AlertCircle, { size: 14 }),
                (status === "success" || status === "pending") && /* @__PURE__ */ jsx(Check, { size: 14, strokeWidth: 3 })
              ]
            }
          ),
          /* @__PURE__ */ jsxs(
            "div",
            {
              style: {
                flex: 1,
                minWidth: 0,
                fontSize: 12.5,
                fontWeight: 600,
                color: "var(--text-primary)",
                display: "flex",
                alignItems: "center",
                gap: 6
              },
              children: [
                /* @__PURE__ */ jsxs("span", { children: [
                  status === "submitting" && "Creating your ticket\u2026",
                  status === "failed" && "Couldn't create the ticket",
                  (status === "success" || status === "pending") && "Ticket created"
                ] }),
                action.urgency === "high" && /* @__PURE__ */ jsx(
                  "span",
                  {
                    style: {
                      fontSize: 10.5,
                      fontWeight: 700,
                      letterSpacing: 0.4,
                      color: "#FF9B6B",
                      textTransform: "uppercase",
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "rgba(255,155,107,0.12)",
                      border: "1px solid rgba(255,155,107,0.3)"
                    },
                    children: "Priority"
                  }
                )
              ]
            }
          ),
          /* @__PURE__ */ jsx(Ticket, { size: 14, style: { color: "var(--text-dim)" } })
        ] }),
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              fontSize: 12,
              color: "var(--text-muted)",
              lineHeight: 1.5
            },
            children: [
              userInfo?.email ? /* @__PURE__ */ jsxs(Fragment, { children: [
                "We'll reply by email to",
                " ",
                /* @__PURE__ */ jsx("span", { style: { color: "var(--text-primary)" }, children: userInfo.email }),
                "."
              ] }) : /* @__PURE__ */ jsx(Fragment, { children: "Our team will reply by email shortly." }),
              waUrl && /* @__PURE__ */ jsx(Fragment, { children: " Need a quicker response? Message us on WhatsApp." })
            ]
          }
        ),
        waUrl && /* @__PURE__ */ jsxs(
          Motion.a,
          {
            href: waUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            whileHover: { y: -1 },
            whileTap: { scale: 0.98 },
            onClick: () => {
              if (typeof onWhatsappClick === "function") {
                onWhatsappClick({ destination: waUrl });
              }
            },
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "10px 14px",
              borderRadius: 10,
              background: "#25D366",
              color: "#fff",
              textDecoration: "none",
              fontWeight: 600,
              fontSize: 13,
              boxShadow: "0 4px 14px rgba(37,211,102,0.32)",
              transition: "box-shadow 0.2s ease"
            },
            children: [
              /* @__PURE__ */ jsx(WhatsAppIcon, { size: 15 }),
              "Message ",
              whatsappPerson,
              " on WhatsApp"
            ]
          }
        )
      ]
    }
  );
}
function AgentAvatar({ size = 36, agent }) {
  const [failed, setFailed] = useState(false);
  const avatarUrl = agent?.avatarUrl;
  const showImage = avatarUrl && !failed;
  const radius = Math.round(size * 0.33);
  const iconSize = Math.round(size * 0.47);
  return /* @__PURE__ */ jsx(
    "div",
    {
      style: {
        width: size,
        height: size,
        borderRadius: radius,
        overflow: "hidden",
        background: showImage ? "var(--bg-card)" : "linear-gradient(135deg, #AAEE40 0%, #77D501 50%, #4DB800 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 4px 12px rgba(119,213,1,0.35)",
        color: "#0A0E06",
        flexShrink: 0
      },
      children: showImage ? /* @__PURE__ */ jsx(
        "img",
        {
          src: avatarUrl,
          alt: agent?.name || "Agent",
          onError: () => setFailed(true),
          style: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
          loading: "lazy",
          decoding: "async"
        }
      ) : /* @__PURE__ */ jsx(Sparkles, { size: iconSize, strokeWidth: 2.2 })
    }
  );
}
function TypingDots() {
  return /* @__PURE__ */ jsx("div", { style: { display: "flex", gap: 4, alignItems: "center", padding: "4px 2px" }, children: [0, 1, 2].map((i) => /* @__PURE__ */ jsx(
    Motion.span,
    {
      initial: { opacity: 0.3, y: 0 },
      animate: { opacity: [0.3, 1, 0.3], y: [0, -3, 0] },
      transition: { duration: 1, repeat: Infinity, ease: "easeInOut", delay: i * 0.15 },
      style: {
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "var(--text-muted)",
        display: "inline-block"
      }
    },
    i
  )) });
}
function AttachmentTile({ att, onRemove, isDark, compact }) {
  const removable = !!onRemove;
  const isImage = att.kind === "image";
  const isVideo = att.kind === "video";
  const tileBg = isDark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.04)";
  if (isImage) {
    return /* @__PURE__ */ jsxs(
      Motion.div,
      {
        layout: true,
        initial: { opacity: 0, scale: 0.85 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.85 },
        transition: { duration: 0.22, ease },
        style: {
          position: "relative",
          width: compact ? 64 : 200,
          height: compact ? 64 : "auto",
          maxHeight: compact ? 64 : 240,
          borderRadius: 12,
          overflow: "hidden",
          background: tileBg,
          border: "1px solid var(--border)",
          flexShrink: 0
        },
        children: [
          /* @__PURE__ */ jsx(
            "img",
            {
              src: att.url,
              alt: att.name,
              style: {
                display: "block",
                width: "100%",
                height: compact ? "100%" : "auto",
                maxHeight: compact ? 64 : 240,
                objectFit: "cover"
              }
            }
          ),
          removable && /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: () => onRemove(att.id),
              "aria-label": `Remove ${att.name}`,
              style: {
                position: "absolute",
                top: 4,
                right: 4,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.7)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              },
              children: /* @__PURE__ */ jsx(X, { size: 12, strokeWidth: 2.6 })
            }
          )
        ]
      }
    );
  }
  if (isVideo) {
    return /* @__PURE__ */ jsxs(
      Motion.div,
      {
        layout: true,
        initial: { opacity: 0, scale: 0.85 },
        animate: { opacity: 1, scale: 1 },
        exit: { opacity: 0, scale: 0.85 },
        transition: { duration: 0.22, ease },
        style: {
          position: "relative",
          width: compact ? 96 : 240,
          borderRadius: 12,
          overflow: "hidden",
          background: "#000",
          border: "1px solid var(--border)",
          flexShrink: 0
        },
        children: [
          /* @__PURE__ */ jsx(
            "video",
            {
              src: att.url,
              controls: !compact,
              muted: compact,
              style: { display: "block", width: "100%", maxHeight: compact ? 64 : 200, objectFit: "cover" }
            }
          ),
          removable && /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              onClick: () => onRemove(att.id),
              "aria-label": `Remove ${att.name}`,
              style: {
                position: "absolute",
                top: 4,
                right: 4,
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "rgba(0,0,0,0.7)",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center"
              },
              children: /* @__PURE__ */ jsx(X, { size: 12, strokeWidth: 2.6 })
            }
          )
        ]
      }
    );
  }
  return /* @__PURE__ */ jsxs(
    Motion.div,
    {
      layout: true,
      initial: { opacity: 0, scale: 0.92 },
      animate: { opacity: 1, scale: 1 },
      exit: { opacity: 0, scale: 0.85 },
      transition: { duration: 0.22, ease },
      style: {
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: compact ? "8px 28px 8px 10px" : "10px 12px",
        borderRadius: 12,
        background: tileBg,
        border: "1px solid var(--border)",
        minWidth: compact ? 180 : 220,
        maxWidth: 260,
        flexShrink: 0
      },
      children: [
        /* @__PURE__ */ jsx("div", { style: {
          width: 36,
          height: 36,
          borderRadius: 10,
          background: "var(--primary-dim)",
          color: "var(--primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0
        }, children: fileKindIcon(att.kind, 18) }),
        /* @__PURE__ */ jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
          /* @__PURE__ */ jsx(
            "div",
            {
              style: {
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-primary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap"
              },
              title: att.name,
              children: att.name
            }
          ),
          /* @__PURE__ */ jsx("div", { style: { fontSize: 11, color: "var(--text-muted)", marginTop: 2 }, children: formatBytes(att.size) })
        ] }),
        !removable && att.url && /* @__PURE__ */ jsx(
          "a",
          {
            href: att.url,
            download: att.name,
            "aria-label": `Download ${att.name}`,
            style: {
              color: "var(--text-muted)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 4,
              borderRadius: 6
            },
            onMouseEnter: (e) => e.currentTarget.style.color = "var(--primary)",
            onMouseLeave: (e) => e.currentTarget.style.color = "var(--text-muted)",
            children: /* @__PURE__ */ jsx(Download, { size: 15 })
          }
        ),
        removable && /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            onClick: () => onRemove(att.id),
            "aria-label": `Remove ${att.name}`,
            style: {
              position: "absolute",
              top: 6,
              right: 6,
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "rgba(0,0,0,0.55)",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            },
            children: /* @__PURE__ */ jsx(X, { size: 11, strokeWidth: 2.6 })
          }
        )
      ]
    }
  );
}
function LeadForm({ onSubmit, isDark }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);
  const nameRef = useRef(null);
  useEffect(() => {
    nameRef.current?.focus();
  }, []);
  const nameValid = name.trim().length >= 2;
  const emailValid = isValidEmail(email);
  const ready = nameValid && emailValid && !submitting;
  const handle = (e) => {
    e.preventDefault();
    setTouched(true);
    if (!ready) return;
    setSubmitting(true);
    setTimeout(() => onSubmit({ name: name.trim(), email: email.trim() }), 250);
  };
  const fieldStyle = (valid) => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "var(--bg-card)",
    border: `1px solid ${touched && !valid ? "#FF7A7A" : "var(--border-md)"}`,
    borderRadius: 10,
    padding: "8px 12px",
    transition: "border-color 0.18s ease"
  });
  return /* @__PURE__ */ jsxs(
    Motion.form,
    {
      onSubmit: handle,
      initial: { opacity: 0, y: 8, scale: 0.98 },
      animate: { opacity: 1, y: 0, scale: 1 },
      transition: { duration: 0.32, ease, delay: 0.1 },
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 14,
        borderRadius: "18px 18px 18px 4px",
        background: isDark ? "rgba(255,255,255,0.04)" : "rgba(15,26,8,0.04)",
        border: "1px solid var(--border)",
        maxWidth: "92%"
      },
      children: [
        /* @__PURE__ */ jsx("div", { style: { fontSize: 13.5, color: "var(--text-primary)", lineHeight: 1.5, marginBottom: 4 }, children: "Quick \u2014 who am I chatting with? It helps me follow up if we get cut off." }),
        /* @__PURE__ */ jsxs("div", { style: fieldStyle(nameValid || !touched), children: [
          /* @__PURE__ */ jsx(UserIcon, { size: 14, style: { color: "var(--text-muted)" } }),
          /* @__PURE__ */ jsx(
            "input",
            {
              ref: nameRef,
              type: "text",
              value: name,
              onChange: (e) => setName(e.target.value),
              placeholder: "Your name",
              "aria-label": "Your name",
              style: {
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--text-primary)",
                fontFamily: "inherit",
                fontSize: 13.5,
                padding: 0
              }
            }
          )
        ] }),
        /* @__PURE__ */ jsxs("div", { style: fieldStyle(emailValid || !touched), children: [
          /* @__PURE__ */ jsx(Mail, { size: 14, style: { color: "var(--text-muted)" } }),
          /* @__PURE__ */ jsx(
            "input",
            {
              type: "email",
              value: email,
              onChange: (e) => setEmail(e.target.value),
              placeholder: "you@work.com",
              "aria-label": "Email",
              style: {
                flex: 1,
                background: "transparent",
                border: "none",
                outline: "none",
                color: "var(--text-primary)",
                fontFamily: "inherit",
                fontSize: 13.5,
                padding: 0
              }
            }
          )
        ] }),
        /* @__PURE__ */ jsx(
          Motion.button,
          {
            type: "submit",
            disabled: !ready,
            whileHover: ready ? { y: -1 } : void 0,
            whileTap: ready ? { scale: 0.98 } : void 0,
            style: {
              marginTop: 4,
              padding: "9px 14px",
              borderRadius: 10,
              background: ready ? "var(--primary)" : "var(--border)",
              color: ready ? "var(--primary-text)" : "var(--text-dim)",
              fontWeight: 600,
              fontSize: 13,
              border: "none",
              cursor: ready ? "pointer" : "not-allowed",
              fontFamily: "inherit",
              transition: "background 0.2s ease"
            },
            children: submitting ? "Saving\u2026" : "Continue"
          }
        ),
        touched && (!nameValid || !emailValid) && /* @__PURE__ */ jsx("div", { style: { fontSize: 11.5, color: "#FF9090" }, children: !nameValid ? "Please enter your name." : "Please enter a valid email." })
      ]
    }
  );
}
function MessageBubble({ msg, isDark, userInfo, onWhatsappClick, handoffConfig }) {
  if (msg.role === "system" && msg.kind === "lead-form-submitted") {
    return /* @__PURE__ */ jsxs(
      Motion.div,
      {
        initial: { opacity: 0, y: 4 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.3, ease },
        style: { textAlign: "center", fontSize: 11.5, color: "var(--text-muted)", padding: "4px 0" },
        children: [
          "\u2713 ",
          msg.content
        ]
      }
    );
  }
  const isUser = msg.role === "user";
  const hasText = !!msg.content;
  const hasAttachments = msg.attachments && msg.attachments.length > 0;
  const hasAction = !isUser && msg.action && msg.action.type === "human_handoff";
  const userBg = isDark ? "#FFFFFF" : "#0F1A08";
  const userColor = isDark ? "#0A0E06" : "#FFFFFF";
  const botBg = isDark ? "rgba(255,255,255,0.04)" : "rgba(15,26,8,0.04)";
  const botColor = "var(--text-primary)";
  const botBorder = "1px solid var(--border)";
  const onlyImages = hasAttachments && !hasText && msg.attachments.every((a) => a.kind === "image" || a.kind === "video");
  return /* @__PURE__ */ jsxs(
    Motion.div,
    {
      initial: { opacity: 0, y: 8, scale: 0.96 },
      animate: { opacity: 1, y: 0, scale: 1 },
      transition: { duration: 0.35, ease },
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        width: "100%",
        gap: 0
      },
      children: [
        /* @__PURE__ */ jsxs(
          "div",
          {
            style: {
              maxWidth: "85%",
              padding: onlyImages ? 0 : "10px 14px",
              borderRadius: isUser ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              background: onlyImages ? "transparent" : isUser ? userBg : botBg,
              color: isUser ? userColor : botColor,
              border: onlyImages || isUser ? "none" : botBorder,
              fontSize: 14,
              lineHeight: 1.5,
              fontWeight: 450,
              letterSpacing: "-0.005em",
              wordBreak: "break-word",
              boxShadow: !onlyImages && isUser ? isDark ? "0 2px 12px rgba(255,255,255,0.06)" : "0 2px 12px rgba(0,0,0,0.06)" : "none",
              display: hasText || hasAttachments ? "flex" : "none",
              flexDirection: "column",
              gap: hasText && hasAttachments ? 8 : 0
            },
            children: [
              hasAttachments && /* @__PURE__ */ jsx("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: msg.attachments.map((a) => /* @__PURE__ */ jsx(AttachmentTile, { att: a, isDark }, a.id)) }),
              hasText && (isUser ? (
                // User text stays plain — keeps newlines, no markdown surprises.
                /* @__PURE__ */ jsx("div", { style: { whiteSpace: "pre-wrap" }, children: msg.content })
              ) : (
                // Bot content is rendered as markdown. The wrapper resets the
                // default last-child margin so the bubble doesn't have a trailing gap.
                /* @__PURE__ */ jsx("div", { className: "chatbot-md", children: /* @__PURE__ */ jsx(ChatMessageText, { children: msg.content }) })
              ))
            ]
          }
        ),
        hasAction && /* @__PURE__ */ jsx(
          HandoffCard,
          {
            msgId: msg.id,
            action: msg.action,
            userInfo,
            isDark,
            onWhatsappClick: typeof onWhatsappClick === "function" ? ({ destination }) => onWhatsappClick(msg, destination) : void 0,
            whatsappNumber: handoffConfig?.whatsappNumber,
            whatsappPerson: handoffConfig?.whatsappPerson,
            ticketEndpoint: handoffConfig?.ticketEndpoint,
            analyticsSource: handoffConfig?.analyticsSource
          }
        )
      ]
    }
  );
}
function ChatListView({ chats, activeChatId, onSelect, onNew, onDelete, isDark, canCreateNew = true }) {
  const [confirmId, setConfirmId] = useState(null);
  const sorted = useMemo(
    () => [...chats].sort((a, b) => b.updatedAt - a.updatedAt),
    [chats]
  );
  return /* @__PURE__ */ jsxs(
    Motion.div,
    {
      initial: { x: -40, opacity: 0 },
      animate: { x: 0, opacity: 1 },
      exit: { x: -40, opacity: 0 },
      transition: { duration: 0.28, ease },
      style: {
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden"
      },
      children: [
        canCreateNew && /* @__PURE__ */ jsx("div", { style: { padding: "14px 14px 8px" }, children: /* @__PURE__ */ jsxs(
          Motion.button,
          {
            type: "button",
            onClick: onNew,
            whileHover: { y: -1 },
            whileTap: { scale: 0.98 },
            style: {
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "10px 14px",
              borderRadius: 12,
              background: "var(--primary)",
              color: "var(--primary-text)",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontWeight: 600,
              fontSize: 13.5,
              boxShadow: "0 6px 20px rgba(119,213,1,0.28)"
            },
            children: [
              /* @__PURE__ */ jsx(Plus, { size: 16, strokeWidth: 2.4 }),
              "New chat"
            ]
          }
        ) }),
        /* @__PURE__ */ jsx("div", { className: "chatbot-scroll", style: { flex: 1, overflowY: "auto", padding: "4px 8px 14px" }, children: sorted.length === 0 ? /* @__PURE__ */ jsx("div", { style: {
          padding: "40px 20px",
          textAlign: "center",
          color: "var(--text-muted)",
          fontSize: 13
        }, children: "No chats yet." }) : sorted.map((chat) => {
          const isActive = chat.id === activeChatId;
          const isConfirm = confirmId === chat.id;
          const preview = lastMessagePreview(chat);
          return /* @__PURE__ */ jsx(
            Motion.div,
            {
              layout: true,
              initial: { opacity: 0, y: 4 },
              animate: { opacity: 1, y: 0 },
              exit: { opacity: 0, x: -20 },
              transition: { duration: 0.25, ease },
              className: "chatbot-list-row",
              style: {
                position: "relative",
                padding: "10px 12px",
                margin: "2px 0",
                borderRadius: 12,
                cursor: isConfirm ? "default" : "pointer",
                background: isActive ? "var(--primary-dim)" : "transparent",
                border: `1px solid ${isActive ? "var(--primary-border)" : "transparent"}`,
                transition: "background 0.18s ease, border-color 0.18s ease"
              },
              onClick: () => {
                if (!isConfirm) onSelect(chat.id);
              },
              children: !isConfirm ? /* @__PURE__ */ jsxs(Fragment, { children: [
                /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }, children: [
                  /* @__PURE__ */ jsx(
                    "div",
                    {
                      style: {
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: "var(--text-primary)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap"
                      },
                      title: chat.title,
                      children: chat.title
                    }
                  ),
                  /* @__PURE__ */ jsx("div", { style: { fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }, children: relativeTime(chat.updatedAt) })
                ] }),
                /* @__PURE__ */ jsx(
                  "div",
                  {
                    style: {
                      fontSize: 12,
                      color: "var(--text-muted)",
                      marginTop: 3,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      paddingRight: 24
                    },
                    children: preview || "\u2014"
                  }
                ),
                sorted.length > 1 && /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    "aria-label": "Delete chat",
                    onClick: (e) => {
                      e.stopPropagation();
                      setConfirmId(chat.id);
                    },
                    className: "chatbot-list-trash",
                    style: {
                      position: "absolute",
                      right: 8,
                      top: "50%",
                      transform: "translateY(-50%)",
                      width: 28,
                      height: 28,
                      borderRadius: 8,
                      background: "transparent",
                      color: "var(--text-dim)",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: 0,
                      transition: "opacity 0.15s ease, background 0.15s ease, color 0.15s ease"
                    },
                    onMouseEnter: (e) => {
                      e.currentTarget.style.background = "rgba(255,90,90,0.12)";
                      e.currentTarget.style.color = "#FF7A7A";
                    },
                    onMouseLeave: (e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.color = "var(--text-dim)";
                    },
                    children: /* @__PURE__ */ jsx(Trash2, { size: 14 })
                  }
                )
              ] }) : /* @__PURE__ */ jsxs(
                Motion.div,
                {
                  initial: { opacity: 0 },
                  animate: { opacity: 1 },
                  style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
                  children: [
                    /* @__PURE__ */ jsx("div", { style: { fontSize: 12.5, color: "var(--text-primary)" }, children: "Delete this chat?" }),
                    /* @__PURE__ */ jsxs("div", { style: { display: "flex", gap: 6 }, children: [
                      /* @__PURE__ */ jsx(
                        "button",
                        {
                          type: "button",
                          onClick: (e) => {
                            e.stopPropagation();
                            setConfirmId(null);
                          },
                          style: {
                            padding: "5px 10px",
                            fontSize: 12,
                            borderRadius: 8,
                            background: "transparent",
                            color: "var(--text-muted)",
                            border: "1px solid var(--border)",
                            cursor: "pointer",
                            fontFamily: "inherit"
                          },
                          children: "Cancel"
                        }
                      ),
                      /* @__PURE__ */ jsx(
                        "button",
                        {
                          type: "button",
                          onClick: (e) => {
                            e.stopPropagation();
                            onDelete(chat.id);
                            setConfirmId(null);
                          },
                          style: {
                            padding: "5px 10px",
                            fontSize: 12,
                            borderRadius: 8,
                            background: "#FF5C5C",
                            color: "#fff",
                            border: "none",
                            cursor: "pointer",
                            fontWeight: 600,
                            fontFamily: "inherit"
                          },
                          children: "Delete"
                        }
                      )
                    ] })
                  ]
                }
              )
            },
            chat.id
          );
        }) })
      ]
    },
    "list"
  );
}
function Chatbot({
  user = null,
  theme = "dark",
  agent: agentOverrides,
  config = {}
}) {
  const isDark = theme !== "light";
  const agent = useMemo(() => resolveAgentConfig(agentOverrides), [agentOverrides]);
  const zaraClientRef = useRef(null);
  if (!zaraClientRef.current) {
    zaraClientRef.current = new ZaraClient({
      apiBase: config.agentApiUrl,
      agentId: config.agentId || agent.id,
      guestEmail: config.guestEmail
    });
  }
  const analyticsRef = useRef(null);
  if (!analyticsRef.current) {
    analyticsRef.current = new ChatAnalytics({
      endpoint: config.analyticsEndpoint,
      source: config.analyticsSource
    });
  }
  const zaraClient = zaraClientRef.current;
  const analytics = analyticsRef.current;
  const handoffConfig = useMemo(() => ({
    whatsappNumber: (config.whatsappNumber || "").toString().replace(/\D/g, ""),
    whatsappPerson: config.whatsappPersonName || "Marrin",
    ticketEndpoint: config.ticketEndpoint || "",
    analyticsSource: config.analyticsSource || "proprompt-website"
  }), [config.whatsappNumber, config.whatsappPersonName, config.ticketEndpoint, config.analyticsSource]);
  const seededUser = useMemo(() => {
    if (!user || !user.email) return null;
    return { name: user.name || null, email: user.email, savedAt: Date.now() };
  }, [user]);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState("chat");
  const [chats, setChats] = useState(() => {
    const stored = safeStorageGet(STORAGE_KEY_CHATS, null);
    if (Array.isArray(stored) && stored.length > 0) return stored;
    return [makeWelcomeChat(agent.welcome)];
  });
  const [activeChatId, setActiveChatId] = useState(() => {
    const stored = safeStorageGet(STORAGE_KEY_ACTIVE, null);
    return stored || null;
  });
  const [userInfo, setUserInfo] = useState(
    () => seededUser || safeStorageGet(STORAGE_KEY_USER, null)
  );
  const [input, setInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState([]);
  const [typing, setTyping] = useState(false);
  const [unread, setUnread] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);
  const activeChat = useMemo(() => {
    return chats.find((c) => c.id === activeChatId) || chats[0];
  }, [chats, activeChatId]);
  useEffect(() => {
    if (chats.length === 0) {
      const fresh = makeWelcomeChat(agent.welcome);
      setChats([fresh]);
      setActiveChatId(fresh.id);
      return;
    }
    if (!chats.find((c) => c.id === activeChatId)) {
      setActiveChatId(chats[0].id);
    }
  }, [chats, activeChatId, agent.welcome]);
  useEffect(() => {
    if (seededUser && (!userInfo || userInfo.email !== seededUser.email)) {
      setUserInfo(seededUser);
    }
  }, [seededUser, userInfo]);
  useEffect(() => {
    if (userInfo?.email) zaraClient.setUserEmail(userInfo.email);
    analytics.setVisitor(userInfo || null);
  }, [userInfo, zaraClient, analytics]);
  useEffect(() => {
    analytics.sessionStart();
    analytics.flushQueue();
  }, [analytics]);
  useEffect(() => {
    const sanitized = chats.map((c) => ({
      ...c,
      messages: c.messages.map((m) => ({
        ...m,
        attachments: m.attachments?.map((a) => ({
          id: a.id,
          kind: a.kind,
          name: a.name,
          size: a.size,
          type: a.type
          // url is an object URL — drop on persist; on reload it'd be invalid anyway.
        }))
      }))
    }));
    safeStorageSet(STORAGE_KEY_CHATS, sanitized);
  }, [chats]);
  useEffect(() => {
    if (activeChatId) safeStorageSet(STORAGE_KEY_ACTIVE, activeChatId);
  }, [activeChatId]);
  useEffect(() => {
    if (userInfo) safeStorageSet(STORAGE_KEY_USER, userInfo);
  }, [userInfo]);
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [activeChat?.messages, typing, view]);
  useEffect(() => {
    if (open && view === "chat") {
      setUnread(false);
      const id = setTimeout(() => inputRef.current?.focus(), 280);
      return () => clearTimeout(id);
    }
  }, [open, view, activeChatId]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  useEffect(() => {
    return () => {
      pendingAttachments.forEach((a) => a.url && URL.revokeObjectURL(a.url));
    };
  }, []);
  const updateChat = useCallback((chatId, updater) => {
    setChats((prev) => prev.map((c) => c.id === chatId ? { ...updater(c), updatedAt: Date.now() } : c));
  }, []);
  const addFiles = useCallback((fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setPendingAttachments((prev) => {
      const remaining = MAX_ATTACHMENTS - prev.length;
      const accepted = files.slice(0, Math.max(0, remaining)).filter((f) => f.size <= MAX_FILE_SIZE);
      const next = accepted.map((f) => ({
        id: newAttachmentId(),
        file: f,
        kind: classifyFile(f),
        name: f.name,
        size: f.size,
        type: f.type,
        url: URL.createObjectURL(f)
      }));
      return [...prev, ...next];
    });
  }, []);
  const removePending = useCallback((id) => {
    setPendingAttachments((prev) => {
      const removed = prev.find((p) => p.id === id);
      if (removed?.url) URL.revokeObjectURL(removed.url);
      return prev.filter((p) => p.id !== id);
    });
  }, []);
  const send = useCallback((text) => {
    const trimmed = (text || "").trim();
    if (!trimmed && pendingAttachments.length === 0) return;
    if (typing || !activeChat) return;
    const sentAttachments = pendingAttachments.map((a) => ({
      id: a.id,
      kind: a.kind,
      name: a.name,
      size: a.size,
      type: a.type,
      url: a.url
    }));
    const userMsg = {
      id: newId("u"),
      role: "user",
      content: trimmed,
      attachments: sentAttachments
    };
    const isFirstUserMessage = !activeChat.messages.some((m) => m.role === "user");
    const shouldAskLead = isFirstUserMessage && !userInfo && !activeChat.leadAsked;
    updateChat(activeChat.id, (c) => ({
      ...c,
      title: c.messages.some((m) => m.role === "user") ? c.title : deriveTitle(trimmed || sentAttachments[0]?.name || "New chat"),
      messages: [...c.messages, userMsg]
    }));
    setInput("");
    setPendingAttachments([]);
    setTyping(true);
    const chatId = activeChat.id;
    const existingConversationId = activeChat.conversationId;
    const userTurnText = composeUserTurn(trimmed, sentAttachments);
    analytics.messageSent({
      chatId,
      conversationId: existingConversationId || null,
      messageId: userMsg.id,
      content: trimmed,
      attachments: sentAttachments
    });
    (async () => {
      try {
        const result = existingConversationId ? await zaraClient.continue(existingConversationId, userTurnText) : await zaraClient.start(userTurnText);
        const { cleanText, action } = parseHandoffAction(result.message || "");
        const botMsg = {
          id: newId("b"),
          role: "bot",
          content: cleanText || "I didn't catch that \u2014 can you rephrase?",
          ...action ? { action } : {}
        };
        const newConversationId = result.conversationId || existingConversationId || null;
        updateChat(chatId, (c) => ({
          ...c,
          conversationId: result.conversationId || c.conversationId,
          messages: [...c.messages, botMsg]
        }));
        analytics.messageReceived({
          chatId,
          conversationId: newConversationId,
          messageId: botMsg.id,
          content: botMsg.content,
          hasAction: !!action,
          action: action || null
        });
        if (action) {
          analytics.ticketCreated({
            chatId,
            conversationId: newConversationId,
            messageId: botMsg.id,
            action
          });
        }
      } catch (err) {
        const botMsg = {
          id: newId("b"),
          role: "bot",
          content: `Sorry \u2014 I couldn't reach the ProPrompt agent (${err.message}). Check your connection or try again in a moment.`
        };
        updateChat(chatId, (c) => ({ ...c, messages: [...c.messages, botMsg] }));
      } finally {
        setTyping(false);
        if (!open || view !== "chat") setUnread(true);
      }
      if (shouldAskLead) {
        setTimeout(() => {
          updateChat(chatId, (c) => ({
            ...c,
            leadAsked: true,
            messages: [...c.messages, { id: newId("lead"), role: "system", kind: "lead-form" }]
          }));
        }, 700);
      }
    })();
  }, [open, view, typing, pendingAttachments, activeChat, userInfo, updateChat]);
  const submitLead = useCallback(({ name, email }) => {
    setUserInfo({ name, email, savedAt: Date.now() });
    analytics.leadCaptured({ name, email });
    if (!activeChat) return;
    const chatId = activeChat.id;
    updateChat(chatId, (c) => ({
      ...c,
      messages: c.messages.map(
        (m) => m.role === "system" && m.kind === "lead-form" ? { ...m, kind: "lead-form-submitted", content: `Thanks, ${name.split(" ")[0]}! I'll keep things personal.` } : m
      )
    }));
    setTimeout(() => {
      updateChat(chatId, (c) => ({
        ...c,
        messages: [...c.messages, {
          id: newId("b"),
          role: "bot",
          content: `Great to meet you, ${name.split(" ")[0]}. Anything else I can dig into?`
        }]
      }));
    }, 600);
  }, [activeChat, updateChat]);
  const onSubmit = (e) => {
    e.preventDefault();
    send(input);
  };
  const newChat = useCallback(() => {
    const fresh = makeWelcomeChat(agent.welcome);
    setChats((prev) => [fresh, ...prev]);
    setActiveChatId(fresh.id);
    setView("chat");
    setInput("");
    setPendingAttachments([]);
    analytics.chatStarted({ chatId: fresh.id });
  }, [agent.welcome, analytics]);
  const switchChat = useCallback((id) => {
    setActiveChatId(id);
    setView("chat");
    setInput("");
    setPendingAttachments([]);
    setUnread(false);
  }, []);
  const deleteChat = useCallback((id) => {
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        const fresh = makeWelcomeChat(agent.welcome);
        setActiveChatId(fresh.id);
        return [fresh];
      }
      if (id === activeChatId) {
        setActiveChatId(next[0].id);
      }
      return next;
    });
    analytics.chatDeleted({ chatId: id });
  }, [activeChatId, agent.welcome, analytics]);
  const onDragEnter = (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setDragOver(true);
  };
  const onDragOver = (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragOver(false);
    }
  };
  const onDrop = (e) => {
    if (!e.dataTransfer?.types?.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };
  const onPaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const item of items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  };
  const accent = "var(--primary)";
  const panelBg = isDark ? "#0B0E08" : "#FFFFFF";
  const headerGradient = isDark ? "linear-gradient(180deg, rgba(119,213,1,0.08) 0%, rgba(119,213,1,0) 100%)" : "linear-gradient(180deg, rgba(95,170,0,0.06) 0%, rgba(95,170,0,0) 100%)";
  const canSend = (input.trim().length > 0 || pendingAttachments.length > 0) && !typing;
  const showSuggestions = activeChat && activeChat.messages.length === 1 && !typing;
  const activeChatIsEmpty = !!activeChat && !activeChat.messages.some((m) => m.role === "user");
  const themeStyle = theme === "light" ? ZARA_THEME_VARS.light : ZARA_THEME_VARS.dark;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      "data-zara-root": true,
      "data-zara-theme": theme === "light" ? "light" : "dark",
      style: {
        ...themeStyle,
        // Use the Inter system stack — matches the website's brand,
        // gracefully falls back where Inter isn't loaded.
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif"
      },
      children: [
        /* @__PURE__ */ jsx(AnimatePresence, { children: !open && /* @__PURE__ */ jsxs(
          Motion.button,
          {
            initial: { opacity: 0, scale: 0.6, y: 20 },
            animate: { opacity: 1, scale: 1, y: 0 },
            exit: { opacity: 0, scale: 0.6, y: 20 },
            transition: { duration: 0.35, ease },
            whileHover: { scale: 1.06, y: -2 },
            whileTap: { scale: 0.94 },
            onClick: () => setOpen(true),
            "aria-label": "Open chat",
            style: {
              position: "fixed",
              right: 24,
              bottom: 24,
              zIndex: 9998,
              width: 58,
              height: 58,
              borderRadius: "50%",
              background: accent,
              color: "var(--primary-text)",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 10px 32px rgba(119,213,1,0.45), 0 2px 6px rgba(0,0,0,0.3)"
            },
            children: [
              /* @__PURE__ */ jsx(
                Motion.span,
                {
                  "aria-hidden": true,
                  animate: { scale: [1, 1.6], opacity: [0.45, 0] },
                  transition: { duration: 1.8, repeat: Infinity, ease: "easeOut" },
                  style: {
                    position: "absolute",
                    inset: 0,
                    borderRadius: "50%",
                    background: accent,
                    zIndex: -1
                  }
                }
              ),
              /* @__PURE__ */ jsx(MessageCircle, { size: 24, strokeWidth: 2.2 }),
              unread && /* @__PURE__ */ jsx(
                Motion.span,
                {
                  initial: { scale: 0 },
                  animate: { scale: 1 },
                  transition: { type: "spring", stiffness: 500, damping: 18 },
                  style: {
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: "#FF5C5C",
                    border: "2px solid var(--primary)"
                  }
                }
              )
            ]
          },
          "fab"
        ) }),
        /* @__PURE__ */ jsx(AnimatePresence, { children: open && /* @__PURE__ */ jsxs(
          Motion.div,
          {
            initial: { opacity: 0, y: 24, scale: 0.96 },
            animate: { opacity: 1, y: 0, scale: 1 },
            exit: { opacity: 0, y: 16, scale: 0.96 },
            transition: { duration: 0.32, ease },
            role: "dialog",
            "aria-label": "ProPrompt chat",
            className: "chatbot-panel",
            onDragEnter,
            onDragOver,
            onDragLeave,
            onDrop,
            onPaste,
            style: {
              position: "fixed",
              right: 24,
              bottom: 24,
              zIndex: 9999,
              width: 380,
              maxWidth: "calc(100vw - 32px)",
              height: 580,
              maxHeight: "calc(100vh - 48px)",
              background: panelBg,
              borderRadius: 20,
              border: "1px solid var(--border-md)",
              boxShadow: isDark ? "0 24px 80px rgba(0,0,0,0.55), 0 0 0 1px rgba(119,213,1,0.06)" : "0 24px 80px rgba(0,0,0,0.18)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              transformOrigin: "bottom right"
            },
            children: [
              /* @__PURE__ */ jsx(AnimatePresence, { children: dragOver && view === "chat" && /* @__PURE__ */ jsxs(
                Motion.div,
                {
                  initial: { opacity: 0 },
                  animate: { opacity: 1 },
                  exit: { opacity: 0 },
                  transition: { duration: 0.18 },
                  style: {
                    position: "absolute",
                    inset: 8,
                    borderRadius: 14,
                    border: "2px dashed var(--primary)",
                    background: isDark ? "rgba(119,213,1,0.07)" : "rgba(95,170,0,0.08)",
                    backdropFilter: "blur(6px)",
                    zIndex: 5,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 10,
                    pointerEvents: "none"
                  },
                  children: [
                    /* @__PURE__ */ jsx(
                      Motion.div,
                      {
                        animate: { y: [0, -4, 0] },
                        transition: { duration: 1.4, repeat: Infinity, ease: "easeInOut" },
                        style: {
                          width: 46,
                          height: 46,
                          borderRadius: 14,
                          background: "var(--primary-dim)",
                          color: "var(--primary)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          border: "1px solid var(--primary-border)"
                        },
                        children: /* @__PURE__ */ jsx(UploadCloud, { size: 22 })
                      }
                    ),
                    /* @__PURE__ */ jsx("div", { style: { fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }, children: "Drop to attach" }),
                    /* @__PURE__ */ jsx("div", { style: { fontSize: 12, color: "var(--text-muted)" }, children: "Images, video, audio, or documents" })
                  ]
                }
              ) }),
              /* @__PURE__ */ jsx(
                "div",
                {
                  style: {
                    position: "relative",
                    padding: "14px 14px 12px",
                    borderBottom: "1px solid var(--border)",
                    background: headerGradient
                  },
                  children: /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 10 }, children: [
                    view === "chat" ? /* @__PURE__ */ jsx(
                      "button",
                      {
                        onClick: () => setView("list"),
                        "aria-label": "View all chats",
                        style: {
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          background: "transparent",
                          border: "1px solid var(--border)",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          transition: "all 0.18s ease"
                        },
                        onMouseEnter: (e) => {
                          e.currentTarget.style.background = "var(--primary-dim)";
                          e.currentTarget.style.color = "var(--primary)";
                          e.currentTarget.style.borderColor = "var(--primary-border)";
                        },
                        onMouseLeave: (e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "var(--text-muted)";
                          e.currentTarget.style.borderColor = "var(--border)";
                        },
                        children: /* @__PURE__ */ jsx(MessagesSquare, { size: 15 })
                      }
                    ) : /* @__PURE__ */ jsx(
                      "button",
                      {
                        onClick: () => setView("chat"),
                        "aria-label": "Back to chat",
                        style: {
                          width: 34,
                          height: 34,
                          borderRadius: 10,
                          background: "transparent",
                          border: "1px solid var(--border)",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          transition: "all 0.18s ease"
                        },
                        onMouseEnter: (e) => {
                          e.currentTarget.style.background = "var(--primary-dim)";
                          e.currentTarget.style.color = "var(--primary)";
                          e.currentTarget.style.borderColor = "var(--primary-border)";
                        },
                        onMouseLeave: (e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "var(--text-muted)";
                          e.currentTarget.style.borderColor = "var(--border)";
                        },
                        children: /* @__PURE__ */ jsx(ArrowLeft, { size: 15 })
                      }
                    ),
                    view === "chat" ? /* @__PURE__ */ jsxs(Fragment, { children: [
                      /* @__PURE__ */ jsx(AgentAvatar, { size: 36, agent }),
                      /* @__PURE__ */ jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
                        /* @__PURE__ */ jsx(
                          "div",
                          {
                            style: {
                              fontSize: 14.5,
                              fontWeight: 700,
                              color: "var(--text-primary)",
                              letterSpacing: "-0.01em"
                            },
                            children: agent.name
                          }
                        ),
                        /* @__PURE__ */ jsx(
                          "div",
                          {
                            style: {
                              fontSize: 12,
                              color: "var(--text-muted)",
                              marginTop: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            },
                            children: activeChat?.title && activeChat.title !== "New chat" ? activeChat.title : agent.title
                          }
                        )
                      ] })
                    ] }) : /* @__PURE__ */ jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [
                      /* @__PURE__ */ jsx("div", { style: { fontSize: 14.5, fontWeight: 700, color: "var(--text-primary)" }, children: "Your chats" }),
                      /* @__PURE__ */ jsxs("div", { style: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 1 }, children: [
                        chats.length,
                        " ",
                        chats.length === 1 ? "conversation" : "conversations"
                      ] })
                    ] }),
                    view === "chat" && !activeChatIsEmpty && /* @__PURE__ */ jsx(
                      "button",
                      {
                        onClick: newChat,
                        "aria-label": "New chat",
                        title: "New chat",
                        style: {
                          width: 32,
                          height: 32,
                          borderRadius: 10,
                          background: "transparent",
                          border: "1px solid var(--border)",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transition: "all 0.18s ease"
                        },
                        onMouseEnter: (e) => {
                          e.currentTarget.style.background = "var(--primary-dim)";
                          e.currentTarget.style.color = "var(--primary)";
                          e.currentTarget.style.borderColor = "var(--primary-border)";
                        },
                        onMouseLeave: (e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "var(--text-muted)";
                          e.currentTarget.style.borderColor = "var(--border)";
                        },
                        children: /* @__PURE__ */ jsx(Plus, { size: 15 })
                      }
                    ),
                    /* @__PURE__ */ jsx(
                      "button",
                      {
                        onClick: () => setOpen(false),
                        "aria-label": "Close chat",
                        style: {
                          width: 32,
                          height: 32,
                          borderRadius: 10,
                          background: "transparent",
                          border: "1px solid var(--border)",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          transition: "all 0.18s ease"
                        },
                        onMouseEnter: (e) => {
                          e.currentTarget.style.background = "var(--primary-dim)";
                          e.currentTarget.style.color = "var(--text-primary)";
                          e.currentTarget.style.borderColor = "var(--primary-border)";
                        },
                        onMouseLeave: (e) => {
                          e.currentTarget.style.background = "transparent";
                          e.currentTarget.style.color = "var(--text-muted)";
                          e.currentTarget.style.borderColor = "var(--border)";
                        },
                        children: /* @__PURE__ */ jsx(X, { size: 16 })
                      }
                    )
                  ] })
                }
              ),
              /* @__PURE__ */ jsx(AnimatePresence, { mode: "wait", initial: false, children: view === "list" ? /* @__PURE__ */ jsx(
                ChatListView,
                {
                  chats,
                  activeChatId,
                  onSelect: switchChat,
                  onNew: newChat,
                  onDelete: deleteChat,
                  isDark,
                  canCreateNew: !chats.some((c) => !c.messages.some((m) => m.role === "user"))
                },
                "list-view"
              ) : /* @__PURE__ */ jsxs(
                Motion.div,
                {
                  initial: { opacity: 0, x: 20 },
                  animate: { opacity: 1, x: 0 },
                  exit: { opacity: 0, x: 20 },
                  transition: { duration: 0.24, ease },
                  style: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
                  children: [
                    /* @__PURE__ */ jsxs(
                      "div",
                      {
                        ref: scrollRef,
                        className: "chatbot-scroll",
                        style: {
                          flex: 1,
                          overflowY: "auto",
                          padding: "20px 18px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 12
                        },
                        children: [
                          activeChat?.messages.map((m) => {
                            if (m.role === "system" && m.kind === "lead-form") {
                              return /* @__PURE__ */ jsx(
                                Motion.div,
                                {
                                  initial: { opacity: 0 },
                                  animate: { opacity: 1 },
                                  transition: { duration: 0.3 },
                                  style: { display: "flex", justifyContent: "flex-start" },
                                  children: /* @__PURE__ */ jsx(LeadForm, { onSubmit: submitLead, isDark })
                                },
                                m.id
                              );
                            }
                            return /* @__PURE__ */ jsx(
                              MessageBubble,
                              {
                                msg: m,
                                isDark,
                                userInfo,
                                handoffConfig,
                                onWhatsappClick: (botMsg, destination) => analytics.whatsappClicked({
                                  chatId: activeChat?.id,
                                  conversationId: activeChat?.conversationId || null,
                                  messageId: botMsg.id,
                                  action: botMsg.action,
                                  destination
                                })
                              },
                              m.id
                            );
                          }),
                          typing && /* @__PURE__ */ jsx(
                            Motion.div,
                            {
                              initial: { opacity: 0, y: 6 },
                              animate: { opacity: 1, y: 0 },
                              transition: { duration: 0.25 },
                              style: { display: "flex", justifyContent: "flex-start" },
                              children: /* @__PURE__ */ jsx(
                                "div",
                                {
                                  style: {
                                    padding: "10px 14px",
                                    borderRadius: "18px 18px 18px 4px",
                                    background: isDark ? "rgba(255,255,255,0.04)" : "rgba(15,26,8,0.04)",
                                    border: "1px solid var(--border)"
                                  },
                                  children: /* @__PURE__ */ jsx(TypingDots, {})
                                }
                              )
                            }
                          ),
                          showSuggestions && /* @__PURE__ */ jsx(
                            Motion.div,
                            {
                              initial: { opacity: 0, y: 8 },
                              animate: { opacity: 1, y: 0 },
                              transition: { delay: 0.15, duration: 0.4, ease },
                              style: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 },
                              children: agent.suggestions.map((s, i) => /* @__PURE__ */ jsx(
                                Motion.button,
                                {
                                  initial: { opacity: 0, y: 6 },
                                  animate: { opacity: 1, y: 0 },
                                  transition: { delay: 0.2 + i * 0.06, duration: 0.3, ease },
                                  whileHover: { y: -1 },
                                  whileTap: { scale: 0.97 },
                                  onClick: () => send(s),
                                  style: {
                                    padding: "7px 12px",
                                    borderRadius: 999,
                                    background: "var(--primary-dim)",
                                    color: "var(--primary)",
                                    border: "1px solid var(--primary-border)",
                                    fontSize: 12.5,
                                    fontWeight: 500,
                                    cursor: "pointer",
                                    fontFamily: "inherit",
                                    transition: "background 0.2s ease, border-color 0.2s ease"
                                  },
                                  children: s
                                },
                                s
                              ))
                            }
                          )
                        ]
                      }
                    ),
                    /* @__PURE__ */ jsxs(
                      "form",
                      {
                        onSubmit,
                        style: {
                          padding: "12px 14px 14px",
                          borderTop: "1px solid var(--border)",
                          background: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.015)"
                        },
                        children: [
                          /* @__PURE__ */ jsx(AnimatePresence, { initial: false, children: pendingAttachments.length > 0 && /* @__PURE__ */ jsx(
                            Motion.div,
                            {
                              layout: true,
                              initial: { opacity: 0, height: 0 },
                              animate: { opacity: 1, height: "auto" },
                              exit: { opacity: 0, height: 0 },
                              transition: { duration: 0.22, ease },
                              style: { display: "flex", flexWrap: "wrap", gap: 8, paddingBottom: 10, overflow: "hidden" },
                              children: /* @__PURE__ */ jsx(AnimatePresence, { initial: false, children: pendingAttachments.map((att) => /* @__PURE__ */ jsx(
                                AttachmentTile,
                                {
                                  att,
                                  onRemove: removePending,
                                  isDark,
                                  compact: true
                                },
                                att.id
                              )) })
                            }
                          ) }),
                          /* @__PURE__ */ jsxs(
                            "div",
                            {
                              style: {
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                background: "var(--bg-card)",
                                border: "1px solid var(--border-md)",
                                borderRadius: 14,
                                padding: "6px",
                                transition: "border-color 0.2s ease, box-shadow 0.2s ease"
                              },
                              onFocus: (e) => {
                                e.currentTarget.style.borderColor = "var(--primary-border)";
                                e.currentTarget.style.boxShadow = "0 0 0 3px var(--primary-dim)";
                              },
                              onBlur: (e) => {
                                e.currentTarget.style.borderColor = "var(--border-md)";
                                e.currentTarget.style.boxShadow = "none";
                              },
                              children: [
                                /* @__PURE__ */ jsx(
                                  Motion.button,
                                  {
                                    type: "button",
                                    onClick: () => fileInputRef.current?.click(),
                                    whileHover: { scale: 1.06 },
                                    whileTap: { scale: 0.92 },
                                    "aria-label": "Attach files",
                                    disabled: pendingAttachments.length >= MAX_ATTACHMENTS,
                                    style: {
                                      width: 34,
                                      height: 34,
                                      borderRadius: 10,
                                      background: "transparent",
                                      color: "var(--text-muted)",
                                      border: "none",
                                      cursor: pendingAttachments.length >= MAX_ATTACHMENTS ? "not-allowed" : "pointer",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      flexShrink: 0,
                                      opacity: pendingAttachments.length >= MAX_ATTACHMENTS ? 0.4 : 1,
                                      transition: "background 0.15s ease, color 0.15s ease"
                                    },
                                    onMouseEnter: (e) => {
                                      if (pendingAttachments.length >= MAX_ATTACHMENTS) return;
                                      e.currentTarget.style.background = "var(--primary-dim)";
                                      e.currentTarget.style.color = "var(--primary)";
                                    },
                                    onMouseLeave: (e) => {
                                      e.currentTarget.style.background = "transparent";
                                      e.currentTarget.style.color = "var(--text-muted)";
                                    },
                                    children: /* @__PURE__ */ jsx(Paperclip, { size: 17 })
                                  }
                                ),
                                /* @__PURE__ */ jsx(
                                  "input",
                                  {
                                    ref: inputRef,
                                    type: "text",
                                    value: input,
                                    onChange: (e) => setInput(e.target.value),
                                    placeholder: "Type a message\u2026",
                                    "aria-label": "Message",
                                    style: {
                                      flex: 1,
                                      background: "transparent",
                                      border: "none",
                                      outline: "none",
                                      color: "var(--text-primary)",
                                      fontFamily: "inherit",
                                      fontSize: 14,
                                      fontWeight: 450,
                                      padding: "8px 6px"
                                    }
                                  }
                                ),
                                /* @__PURE__ */ jsx(
                                  Motion.button,
                                  {
                                    type: "submit",
                                    disabled: !canSend,
                                    whileHover: canSend ? { scale: 1.05 } : void 0,
                                    whileTap: canSend ? { scale: 0.92 } : void 0,
                                    "aria-label": "Send message",
                                    style: {
                                      width: 34,
                                      height: 34,
                                      borderRadius: 10,
                                      background: canSend ? accent : "var(--border)",
                                      color: canSend ? "var(--primary-text)" : "var(--text-dim)",
                                      border: "none",
                                      cursor: canSend ? "pointer" : "not-allowed",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      flexShrink: 0,
                                      transition: "background 0.2s ease, color 0.2s ease"
                                    },
                                    children: /* @__PURE__ */ jsx(ArrowUp, { size: 16, strokeWidth: 2.6 })
                                  }
                                )
                              ]
                            }
                          ),
                          /* @__PURE__ */ jsx(
                            "input",
                            {
                              ref: fileInputRef,
                              type: "file",
                              multiple: true,
                              onChange: (e) => {
                                addFiles(e.target.files);
                                e.target.value = "";
                              },
                              style: { display: "none" },
                              "aria-hidden": "true"
                            }
                          ),
                          /* @__PURE__ */ jsx(
                            "div",
                            {
                              style: {
                                fontSize: 10.5,
                                color: "var(--text-dim)",
                                textAlign: "center",
                                marginTop: 8,
                                letterSpacing: 0.2
                              },
                              children: "Powered by ProPrompt \xB7 drag, paste or attach files \xB7 Esc to close"
                            }
                          )
                        ]
                      }
                    )
                  ]
                },
                "chat-view"
              ) })
            ]
          },
          "panel"
        ) }),
        /* @__PURE__ */ jsx("style", { children: `
        .chatbot-scroll::-webkit-scrollbar { width: 6px; }
        .chatbot-scroll::-webkit-scrollbar-track { background: transparent; }
        .chatbot-scroll::-webkit-scrollbar-thumb { background: var(--border-md); border-radius: 3px; }
        .chatbot-scroll::-webkit-scrollbar-thumb:hover { background: var(--border-strong); }
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
      ` })
      ]
    }
  );
}
export {
  ChatAnalytics,
  Chatbot,
  DEFAULT_AGENT,
  ZaraClient,
  resolveAgentConfig
};
//# sourceMappingURL=index.mjs.map
