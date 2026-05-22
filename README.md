# @proprompt/zara

Zara — the ProPrompt website chatbot. Drop-in React component used by both **proprompt-website** (marketing site) and **prompt-store** (in-app).

## Install

In either host app:

```bash
npm install git+https://github.com/blizzerand/proprompt-zara.git
```

To update later:

```bash
npm update @proprompt/zara
```

The `prepare` script rebuilds `dist/` on install, so you always get a fresh, host-bundler-friendly build.

## Use

```jsx
import { Chatbot } from '@proprompt/zara'

export default function App() {
  return (
    <>
      {/* … your app … */}
      <Chatbot
        theme="dark"
        user={currentUser}              // { email, name? } — optional, skips lead-form when set
        config={{
          agentApiUrl: 'https://agent-api.proprompt.store',
          agentId: 'proprompt',
          guestEmail: 'support@codedesign.app',
          whatsappNumber: '61490822287',
          whatsappPersonName: 'Marrin',
          ticketEndpoint: '',
          analyticsEndpoint: 'https://api.proprompt.store/chat-events',
          analyticsSource: 'proprompt-website',
        }}
      />
    </>
  )
}
```

### Props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `user` | `{ email, name? }` | `null` | When set, skips the in-chat lead-form and seeds analytics with this identity. Use for authenticated apps. |
| `theme` | `'dark' \| 'light'` | `'dark'` | Drives bubble / panel contrast. |
| `agent` | `object` | from `DEFAULT_AGENT` | Override `id`, `name`, `welcome`, `title`, `suggestions`, `avatarUrl`. |
| `config.agentApiUrl` | `string` | `https://agent-api.proprompt.store` | Where the WebSocket connects. |
| `config.agentId` | `string` | `proprompt` | Which agent on the platform Zara represents. |
| `config.guestEmail` | `string` | `support@codedesign.app` | Fallback identity for anonymous visitors. Must be a registered user on the platform. |
| `config.whatsappNumber` | `string` | `''` | Digits-only, including country code. Leave empty to hide the WhatsApp button. |
| `config.whatsappPersonName` | `string` | `'Marrin'` | Label on the WhatsApp button. |
| `config.ticketEndpoint` | `string` | `''` | Optional POST endpoint when a handoff is created. If empty, the payload is just logged. |
| `config.analyticsEndpoint` | `string` | `''` | Where chat events are streamed. If empty, analytics are disabled. |
| `config.analyticsSource` | `string` | `'proprompt-website'` | Identifier baked into every event so the backend can tell which surface a chat came from. |

### Advanced — direct access

```js
import { ZaraClient, ChatAnalytics, DEFAULT_AGENT, resolveAgentConfig } from '@proprompt/zara'
```

`ZaraClient` and `ChatAnalytics` are exported for hosts that want to build custom UIs on top of the same plumbing.

## Develop

```bash
git clone https://github.com/blizzerand/proprompt-zara
cd proprompt-zara
npm install
npm run dev     # rebuilds on every change
```

To test changes in a host app without publishing, use `npm link` or `npm pack` + local install.

## Architecture

- `src/Chatbot.jsx` — the floating chat panel UI
- `src/zaraClient.js` — WebSocket client to `agent-api.proprompt.store`
- `src/analytics.js` — chat-event stream client
- `src/zaraAgent.js` — agent identity defaults

All env-var coupling has been removed — every host-specific value flows in through props. Editing this repo updates both surfaces with one `npm update`.
