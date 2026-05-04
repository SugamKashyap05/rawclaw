import { ChatNluIntent } from '../contracts/chat';

export interface ChatNluIntentHeldOutFixture {
  phrase: string;
  intent: ChatNluIntent;
  description: string;
}

// Held-out fixtures intentionally vary wording from the catalog while keeping
// enough shared semantic tokens for deterministic Jaccard recall checks.
export const CHAT_NLU_INTENT_HELD_OUT_FIXTURES: ChatNluIntentHeldOutFixture[] = [
  { phrase: 'give a plain language answer', intent: 'conversation', description: 'plain explanation variant' },
  { phrase: 'help think through tradeoffs', intent: 'conversation', description: 'brainstorming variant' },
  { phrase: 'summarize this conversation so far', intent: 'conversation', description: 'conversation summary variant' },
  { phrase: 'respond in a conversational way', intent: 'conversation', description: 'conversation routing variant' },
  { phrase: 'talk through the approach casually', intent: 'conversation', description: 'casual discussion variant' },

  { phrase: 'find current sources model routing', intent: 'research', description: 'current sources variant' },
  { phrase: 'look up recent news topic', intent: 'research', description: 'news lookup variant' },
  { phrase: 'verify claim with sources', intent: 'research', description: 'verification variant' },
  { phrase: 'fetch official page summarize', intent: 'research', description: 'page fetch variant' },
  { phrase: 'find newer source release', intent: 'research', description: 'newer source variant' },

  { phrase: 'remember preference concise reports', intent: 'memory_capture', description: 'operator capture variant' },
  { phrase: 'remember mission local automation', intent: 'memory_capture', description: 'mission capture variant' },
  { phrase: 'remember this chat only', intent: 'memory_capture', description: 'session capture variant' },
  { phrase: 'save project goal memory', intent: 'memory_capture', description: 'project memory variant' },
  { phrase: 'capture mission note', intent: 'memory_capture', description: 'mission note variant' },

  { phrase: 'search memory operator preference', intent: 'memory_query', description: 'operator memory query variant' },
  { phrase: 'recall project goal memory', intent: 'memory_query', description: 'mission memory query variant' },
  { phrase: 'search memory chat routing', intent: 'memory_query', description: 'memory search variant' },
  { phrase: 'retrieve mission notes memory', intent: 'memory_query', description: 'mission retrieval variant' },
  { phrase: 'bring back earlier session notes', intent: 'memory_query', description: 'session recall variant' },

  { phrase: 'create task review plan', intent: 'task_create', description: 'task creation variant' },
  { phrase: 'remind check build later', intent: 'task_create', description: 'reminder variant' },
  { phrase: 'schedule follow up week task', intent: 'task_create', description: 'scheduled follow-up variant' },
  { phrase: 'turn discussion todo item', intent: 'task_create', description: 'todo conversion variant' },
  { phrase: 'track action item later', intent: 'task_create', description: 'action tracking variant' },

  { phrase: 'recommend next step strategy', intent: 'advisory', description: 'next-step variant' },
  { phrase: 'give strategic advice options', intent: 'advisory', description: 'strategy variant' },
  { phrase: 'brief current status blockers', intent: 'advisory', description: 'briefing variant' },
  { phrase: 'help prioritize work focus', intent: 'advisory', description: 'priority variant' },
  { phrase: 'identify blockers actions next', intent: 'advisory', description: 'blocker advice variant' },

  { phrase: 'write TypeScript helper function', intent: 'code_help', description: 'coding helper variant' },
  { phrase: 'explain code pattern clearly', intent: 'code_help', description: 'code explanation variant' },
  { phrase: 'design API endpoint structure', intent: 'code_help', description: 'API design variant' },
  { phrase: 'refactor React component cleanly', intent: 'code_help', description: 'component refactor variant' },
  { phrase: 'draft unit tests service', intent: 'code_help', description: 'test drafting variant' },

  { phrase: 'debug failing test now', intent: 'troubleshooting', description: 'test debug variant' },
  { phrase: 'fix broken behavior issue', intent: 'troubleshooting', description: 'bug fix variant' },
  { phrase: 'diagnose stack trace error', intent: 'troubleshooting', description: 'stack trace variant' },
  { phrase: 'repair failing workflow run', intent: 'troubleshooting', description: 'workflow repair variant' },
  { phrase: 'trace regression source', intent: 'troubleshooting', description: 'regression variant' },

  { phrase: 'rewrite selected paragraph clearly', intent: 'edit_request', description: 'rewrite selection variant' },
  { phrase: 'improve selected text wording', intent: 'edit_request', description: 'improve selection variant' },
  { phrase: 'shorten highlighted section copy', intent: 'edit_request', description: 'shorten selection variant' },
  { phrase: 'formalize sentence selection', intent: 'edit_request', description: 'formalization variant' },
  { phrase: 'clean selected copy tone', intent: 'edit_request', description: 'copy edit variant' },

  { phrase: 'use asana tool now', intent: 'tool_request', description: 'MCP tool variant' },
  { phrase: 'call notion integration tool', intent: 'tool_request', description: 'integration variant' },
  { phrase: 'run browser tool now', intent: 'tool_request', description: 'browser tool variant' },
  { phrase: 'invoke repository tool now', intent: 'tool_request', description: 'repository tool variant' },
  { phrase: 'trigger installed skill tool', intent: 'tool_request', description: 'skill tool variant' },

  { phrase: 'disable memory chat', intent: 'settings_control', description: 'memory setting variant' },
  { phrase: 'turn web search mode', intent: 'settings_control', description: 'web setting variant' },
  { phrase: 'change tool mode manual', intent: 'settings_control', description: 'tool mode variant' },
  { phrase: 'set permission ask every time', intent: 'settings_control', description: 'permission mode variant' },
  { phrase: 'update chat controls', intent: 'settings_control', description: 'controls update variant' },

  { phrase: 'do thing discussed earlier', intent: 'clarification_needed', description: 'ambiguous action variant' },
  { phrase: 'make better somehow please', intent: 'clarification_needed', description: 'ambiguous improvement variant' },
  { phrase: 'finish previous idea now', intent: 'clarification_needed', description: 'ambiguous continuation variant' },
  { phrase: 'use better option then', intent: 'clarification_needed', description: 'ambiguous option variant' },
  { phrase: 'take care of this request', intent: 'clarification_needed', description: 'ambiguous request variant' },

  { phrase: 'unknown future category display', intent: 'unknown', description: 'schema unknown variant' },
  { phrase: 'unsupported intent sample display', intent: 'unknown', description: 'unsupported intent variant' },
  { phrase: 'unrecognized routing category value', intent: 'unknown', description: 'routing unknown variant' },
  { phrase: 'schema fallback unknown state', intent: 'unknown', description: 'schema fallback variant' },
  { phrase: 'future schema intent unknown', intent: 'unknown', description: 'future schema variant' },
];
