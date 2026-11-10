// Rendering Zara's replies: the small subset of markdown it writes, without
// a markdown library (the widget runs inside two host apps and stays light).

// Zara's markdown isn't always perfectly formed — the LLM occasionally
// backslash-escapes brackets, swaps in fullwidth characters, or inserts
// odd spacing around link syntax. Normalise the common quirks here so
// the inline link parser below sees clean ASCII markdown.
export function normalizeBotMarkdown(text) {
  return String(text || '')
    .replace(/\\([[\]()])/g, '$1')           // \[ \] \( \) → [ ] ( )
    .replace(/[［【〔]/g, '[')                  // fullwidth → ASCII brackets
    .replace(/[］】〕]/g, ']')
    .replace(/（/g, '(').replace(/）/g, ')')   // fullwidth → ASCII parens
    .replace(/\]\s+\(/g, '](')                // [x] (y) → [x](y)
    .replace(/ /g, ' ')                  // NBSP → space
    .replace(/[​-‏﻿]/g, '')    // strip zero-width chars
}

// The inline markdown Zara writes: [text](url) links, bare URLs, **bold** /
// __bold__, *italic* / _italic_ and `code`. Bold and italic text can hold
// links. Italic needs a space (or the start of a line) before its marker so
// words like snake_case are left alone. No lookbehind: older Safari would
// reject the whole bundle.
const INLINE_SOURCE = [
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/.source,          // 1 label, 2 url
  /(https?:\/\/[^\s)<>"*]+)/.source,                      // 3 bare url
  /\*\*([^*]+?)\*\*/.source,                              // 4 bold
  /__([^_]+?)__/.source,                                  // 5 bold
  /`([^`\n]+)`/.source,                                   // 6 code
  /(^|[\s(])[*_]([^*_\n]+?)[*_](?=[\s).,!?:;]|$)/.source, // 7 lead, 8 italic
].join('|')

const linkStyle = {
  color: '#77D501',
  textDecoration: 'underline',
  textUnderlineOffset: 2,
  textDecorationThickness: 1,
  wordBreak: 'break-word',
}

// Returns strings and elements to render inside a <p> or <li>.
export function renderInline(text, keyPrefix = 'i') {
  const re = new RegExp(INLINE_SOURCE, 'gm') // fresh per call: this recurses
  const out = []
  let lastIndex = 0
  let n = 0
  let match
  while ((match = re.exec(text)) !== null) {
    const [whole, mdLabel, mdUrl, bareUrl, bold1, bold2, code, italicLead, italic] = match
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index))
    const key = `${keyPrefix}-${n++}`
    if (mdUrl || bareUrl) {
      const url = mdUrl || bareUrl
      out.push(
        <a key={key} href={url} target="_blank" rel="noopener noreferrer" style={linkStyle}>
          {mdLabel ? renderInline(mdLabel, key) : url}
        </a>
      )
    } else if (bold1 !== undefined || bold2 !== undefined) {
      out.push(<strong key={key} style={{ fontWeight: 700 }}>{renderInline(bold1 ?? bold2, key)}</strong>)
    } else if (code !== undefined) {
      out.push(
        <code key={key} style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.92em',
          background: 'rgba(255,255,255,0.08)', borderRadius: 4, padding: '1px 4px',
        }}>{code}</code>
      )
    } else if (italic !== undefined) {
      if (italicLead) out.push(italicLead)
      out.push(<em key={key}>{renderInline(italic, key)}</em>)
    }
    lastIndex = match.index + whole.length
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex))
  return out
}

const BULLET_RE = /^\s*[-*•]\s+(.*)$/
const NUMBERED_RE = /^\s*(\d+)[.)]\s+(.*)$/
const HEADING_RE = /^\s*#{1,6}\s+(.*)$/
const RULE_RE = /^\s*([-*_])\1{2,}\s*$/

// Paragraphs, bullet and numbered lists (also when a list follows a line of
// text in the same paragraph), headings shown as bold lines, and inline
// markdown inside each.
export function ChatMessageText({ children }) {
  const lines = normalizeBotMarkdown(children).split('\n')
  const nodes = []
  let text = []
  let list = null // { ordered, start, items }
  let n = 0

  const flushText = () => {
    if (!text.length) return
    const key = `p-${n++}`
    nodes.push(
      <p key={key} style={{ margin: '0 0 8px', lineHeight: 1.5, whiteSpace: 'pre-line' }}>
        {renderInline(text.join('\n'), key)}
      </p>
    )
    text = []
  }
  const flushList = () => {
    if (!list) return
    const key = `l-${n++}`
    const Tag = list.ordered ? 'ol' : 'ul'
    nodes.push(
      <Tag key={key} start={list.ordered ? list.start : undefined} style={{ margin: '4px 0 8px', paddingLeft: 20 }}>
        {list.items.map((item, i) => (
          <li key={`${key}-${i}`} style={{ margin: '2px 0', lineHeight: 1.5 }}>
            {renderInline(item, `${key}-${i}`)}
          </li>
        ))}
      </Tag>
    )
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim() || RULE_RE.test(line)) {
      // A blank line (or a --- rule) ends the paragraph; a list may carry on.
      flushText()
      continue
    }
    const bullet = BULLET_RE.exec(line)
    const numbered = !bullet && NUMBERED_RE.exec(line)
    if (bullet || numbered) {
      flushText()
      const ordered = !!numbered
      if (list && list.ordered !== ordered) flushList()
      if (!list) list = { ordered, start: numbered ? Number(numbered[1]) : 1, items: [] }
      list.items.push(bullet ? bullet[1] : numbered[2])
      continue
    }
    flushList()
    const heading = HEADING_RE.exec(line)
    if (heading) {
      flushText()
      const key = `h-${n++}`
      nodes.push(
        <p key={key} style={{ margin: '0 0 6px', lineHeight: 1.45, fontWeight: 700 }}>
          {renderInline(heading[1], key)}
        </p>
      )
      continue
    }
    text.push(line)
  }
  flushText()
  flushList()

  return <>{nodes}</>
}
