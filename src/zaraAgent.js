// Zara — UI defaults. Hosts can override these via the <Chatbot config>
// prop (see Chatbot.jsx). Everything here is just sensible defaults so the
// component "just works" out of the box.

export const DEFAULT_AGENT = {
  id: 'proprompt',
  name: 'Zara',
  title: 'ProPrompt Website Support',
  welcome:
    "Hi — I'm Zara, your guide to ProPrompt. Tell me what you're trying to fix in your business and I'll point you to the right AI employee. We've got 23+ specialists ready, and you can spin one up in a 14-day free trial — no card needed.",
  suggestions: [
    'What are AI Employees?',
    'How does pricing work?',
    'Which agent should I start with?',
    'How do I start the 14-day trial?',
  ],
  // Avatar lives on agent-api by default; can be overridden via config.
  avatarUrl:
    'https://agent-api.proprompt.store/static/agent_images/proprompt_small_b0ed2d76',
}

// Resolve the runtime agent config by merging host overrides with the defaults.
export function resolveAgentConfig(overrides = {}) {
  return {
    ...DEFAULT_AGENT,
    ...overrides,
    suggestions: overrides.suggestions || DEFAULT_AGENT.suggestions,
  }
}
