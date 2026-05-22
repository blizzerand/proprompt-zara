// Public API for @proprompt/zara
//
// Hosts mount <Chatbot /> with their own config:
//
//   import { Chatbot } from '@proprompt/zara'
//
//   <Chatbot
//     theme="dark"
//     user={currentUser}   // { email, name? } — skips lead form when set
//     config={{
//       agentApiUrl: 'https://agent-api.proprompt.store',
//       agentId: 'proprompt',
//       guestEmail: 'support@codedesign.app',
//       whatsappNumber: '61490822287',
//       whatsappPersonName: 'Marrin',
//       ticketEndpoint: '',
//       analyticsEndpoint: 'https://api.proprompt.store/chat-events',
//       analyticsSource: 'proprompt-website',
//     }}
//   />
//
// For advanced use cases (custom UI on top of the same backend), the
// ZaraClient and ChatAnalytics classes are exported too.

export { default as Chatbot } from './Chatbot'
export { ZaraClient } from './zaraClient'
export { ChatAnalytics } from './analytics'
export { DEFAULT_AGENT, resolveAgentConfig } from './zaraAgent'
