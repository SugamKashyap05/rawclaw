#!/usr/bin/env node

import readline from 'node:readline/promises';
import { readFile } from 'node:fs/promises';
import { stdin as input, stdout as output } from 'node:process';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

const DEFAULT_API_BASE = process.env.RAWCLAW_API_URL || 'http://localhost:3000/api';
const DEFAULT_AUTH_SECRET = process.env.RAWCLAW_AUTH_SECRET || 'Kuki7816';
const DEFAULT_MODEL = process.env.RAWCLAW_CHAT_MODEL || 'ollama/qwen2.5:1.5b';
const DEFAULT_COMPLEXITY = process.env.RAWCLAW_CHAT_COMPLEXITY || 'medium';

function usage() {
  return `
RawClaw Chat CLI

Usage:
  node scripts/chat-cli.mjs [options]
  npm run chat:cli -- [options]

Options:
  --api-base <url>       API base URL (default: ${DEFAULT_API_BASE})
  --session <id>         Start with a specific chat session id
  --model <id>           Set the initial model id
  --agent <id>           Set the initial agent id
  --reviewer <id>        Set the initial output reviewer id
  --complexity <level>   low | medium | high (default: ${DEFAULT_COMPLEXITY})
  --message <text>       Send one message and exit
  --stdin                Read one message from stdin and exit
  --message-file <path>  Read one message from a file and exit
  --raw-events           Print all streamed events as JSON
  --quiet-tools          Hide tool call/result summaries
  --help                 Show this help

Interactive commands:
  /help                  Show command help
  /quit                  Exit
  /config                Show current session/model/agent settings
  /session <id>          Switch to an existing session id
  /new                   Generate and switch to a fresh session id
  /model <id>            Switch model
  /agent <id|none>       Switch agent
  /reviewer <id|none>    Switch reviewer
  /complexity <level>    Switch complexity
  /models                List available models
  /agents                List available agents
  /history [count]       Show persisted session messages (default: 8)
  /multiline             Paste multiple lines, finish with a single "." line
  /tools on|off          Show or hide tool events
  /raw on|off            Show or hide raw stream events
`.trim();
}

function parseArgs(argv) {
  const options = {
    apiBase: DEFAULT_API_BASE,
    sessionId: `cli-${randomUUID().slice(0, 8)}`,
    model: DEFAULT_MODEL,
    agentId: null,
    reviewerId: null,
    complexity: DEFAULT_COMPLEXITY,
    oneShotMessage: null,
    stdinMessage: false,
    messageFile: null,
    rawEvents: false,
    showTools: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--raw-events') {
      options.rawEvents = true;
      continue;
    }
    if (arg === '--quiet-tools') {
      options.showTools = false;
      continue;
    }
    if (arg === '--api-base') {
      options.apiBase = argv[++i] || options.apiBase;
      continue;
    }
    if (arg === '--session') {
      options.sessionId = argv[++i] || options.sessionId;
      continue;
    }
    if (arg === '--model') {
      options.model = argv[++i] || options.model;
      continue;
    }
    if (arg === '--agent') {
      options.agentId = argv[++i] || options.agentId;
      continue;
    }
    if (arg === '--reviewer') {
      options.reviewerId = argv[++i] || options.reviewerId;
      continue;
    }
    if (arg === '--complexity') {
      options.complexity = argv[++i] || options.complexity;
      continue;
    }
    if (arg === '--message') {
      options.oneShotMessage = argv[++i] || '';
      continue;
    }
    if (arg === '--stdin') {
      options.stdinMessage = true;
      continue;
    }
    if (arg === '--message-file') {
      options.messageFile = argv[++i] || null;
      continue;
    }
  }

  return options;
}

function formatLabel(label, value) {
  return `${label.padEnd(12)} ${value}`;
}

async function fetchJson(url, init = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}`);
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function getAuthHeaders(apiBase) {
  const envToken = process.env.RAWCLAW_TOKEN;
  if (envToken) {
    return {
      Authorization: `Bearer ${envToken}`,
      'Content-Type': 'application/json',
    };
  }

  const auth = await fetchJson(`${apiBase}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: DEFAULT_AUTH_SECRET }),
  });

  const token = auth?.access_token;
  if (!token) {
    throw new Error('Auth token response did not include access_token.');
  }

  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

async function streamChat(apiBase, headers, body, handlers) {
  const response = await fetch(`${apiBase}/chat/send`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '');
    throw new Error(`Chat request failed (${response.status}): ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';

    for (const chunk of chunks) {
      const lines = chunk
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'));

      if (!lines.length) {
        continue;
      }

      const payload = lines.map((line) => line.slice(5).trim()).join('\n');
      if (!payload) {
        continue;
      }

      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }

      await handlers.onEvent?.(event);
      if (event.type === 'done') {
        return;
      }
    }
  }
}

async function readAllStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function summarizeToolResult(toolResult) {
  const output = toolResult?.output;
  if (toolResult?.error) {
    return `error=${toolResult.error}`;
  }
  if (output && typeof output === 'object') {
    if (output.quality) return `quality=${output.quality}`;
    if (output.status) return `status=${output.status}`;
  }
  return 'ok';
}

function summarizeProvenance(provenance) {
  const metadata = provenance?.metadata || {};
  const stages = Object.keys(metadata.internalResearchStages || {});
  const routing = metadata.routingBinding || {};
  const parts = [];
  if (metadata.agentId) parts.push(`agent=${metadata.agentId}`);
  if (routing.bindingId) parts.push(`binding=${routing.bindingId}`);
  if (stages.length) parts.push(`stages=${stages.join(',')}`);
  return parts.join(' | ') || 'provenance captured';
}

function printCommandHelp() {
  console.log('\nCommands:');
  console.log('  /help                  Show this command help');
  console.log('  /quit                  Exit the CLI');
  console.log('  /config                Show current configuration');
  console.log('  /session <id>          Switch to an existing session');
  console.log('  /new                   Generate a new session id');
  console.log('  /model <id>            Switch the model');
  console.log('  /agent <id|none>       Switch the selected agent');
  console.log('  /reviewer <id|none>    Switch the output reviewer');
  console.log('  /complexity <level>    low | medium | high');
  console.log('  /models                List available models');
  console.log('  /agents                List available agents');
  console.log('  /history [count]       Show persisted session history');
  console.log('  /multiline             Paste multiple lines, end with a single "." line');
  console.log('  /tools on|off          Toggle tool event printing');
  console.log('  /raw on|off            Toggle raw event printing');
  console.log('');
}

function printConfig(state) {
  console.log('\nCurrent Chat CLI Config');
  console.log(formatLabel('API Base', state.apiBase));
  console.log(formatLabel('Session', state.sessionId));
  console.log(formatLabel('Model', state.model || '(default)'));
  console.log(formatLabel('Agent', state.agentId || '(none)'));
  console.log(formatLabel('Reviewer', state.reviewerId || '(none)'));
  console.log(formatLabel('Complexity', state.complexity || '(default)'));
  console.log(formatLabel('Show tools', state.showTools ? 'on' : 'off'));
  console.log(formatLabel('Raw events', state.rawEvents ? 'on' : 'off'));
  console.log('');
}

async function listModels(state) {
  const payload = await fetchJson(`${state.apiBase}/chat/models`, {
    headers: state.headers,
  });
  console.log('');
  for (const model of payload?.models || []) {
    console.log(`- ${model.id} (${model.provider})${model.name ? ` :: ${model.name}` : ''}`);
  }
  console.log('');
}

async function listAgents(state) {
  const payload = await fetchJson(`${state.apiBase}/agents`, {
    headers: state.headers,
  });
  console.log('');
  for (const agent of payload || []) {
    console.log(`- ${agent.id} :: ${agent.name}${agent.isDefault ? ' [default]' : ''}`);
  }
  console.log('');
}

async function showHistory(state, countText) {
  const count = Math.max(1, Number.parseInt(countText || '8', 10) || 8);
  const payload = await fetchJson(`${state.apiBase}/chat/sessions/${encodeURIComponent(state.sessionId)}`, {
    headers: state.headers,
  });
  const messages = (payload?.messages || []).slice(-count);
  console.log('');
  if (!messages.length) {
    console.log('(no persisted messages yet)\n');
    return;
  }
  for (const message of messages) {
    const role = String(message.role || 'unknown').padEnd(10);
    const content = String(message.content || '').replace(/\s+/g, ' ').trim();
    console.log(`[${role}] ${content.slice(0, 220)}${content.length > 220 ? '...' : ''}`);
  }
  console.log('');
}

async function sendMessage(state, text) {
  const request = {
    session_id: state.sessionId,
    messages: [{ role: 'user', content: text }],
    model: state.model,
    complexity: state.complexity,
    agent_id: state.agentId || undefined,
    output_reviewer_id: state.reviewerId || undefined,
    stream: true,
  };

  let assistantStarted = false;
  let assistantEndedWithNewline = false;
  let finalContent = '';

  await streamChat(state.apiBase, state.headers, request, {
    onEvent: async (event) => {
      if (state.rawEvents) {
        console.log(`\n[event] ${JSON.stringify(event, null, 2)}`);
      }

      if (event.type === 'content') {
        if (!assistantStarted) {
          process.stdout.write('\nassistant> ');
          assistantStarted = true;
        }
        const chunk = String(event.content || '');
        process.stdout.write(chunk);
        assistantEndedWithNewline = chunk.endsWith('\n');
        finalContent += chunk;
        return;
      }

      if (event.type === 'tool_call' && state.showTools) {
        if (assistantStarted && !assistantEndedWithNewline) {
          process.stdout.write('\n');
        }
        const toolCall = event.tool_call || {};
        console.log(`[tool-call] ${toolCall.name} ${JSON.stringify(toolCall.arguments || {})}`);
        assistantEndedWithNewline = true;
        return;
      }

      if (event.type === 'tool_result' && state.showTools) {
        if (assistantStarted && !assistantEndedWithNewline) {
          process.stdout.write('\n');
        }
        const toolResult = event.tool_result || {};
        console.log(`[tool-result] ${toolResult.tool_name} ${summarizeToolResult(toolResult)}`);
        assistantEndedWithNewline = true;
        return;
      }

      if (event.type === 'provenance') {
        if (assistantStarted && !assistantEndedWithNewline) {
          process.stdout.write('\n');
        }
        console.log(`[provenance] ${summarizeProvenance(event.provenance_trace || event.provenance || {})}`);
        assistantEndedWithNewline = true;
        return;
      }

      if (event.type === 'error') {
        if (assistantStarted && !assistantEndedWithNewline) {
          process.stdout.write('\n');
        }
        console.log(`[error] ${event.message || event.error || 'Unknown stream error'}`);
        assistantEndedWithNewline = true;
      }
    },
  });

  if (assistantStarted && !assistantEndedWithNewline) {
    process.stdout.write('\n');
  }

  return finalContent;
}

async function handleCommand(state, line) {
  const [command, ...rest] = line.trim().split(/\s+/);
  const value = rest.join(' ').trim();

  switch (command) {
    case '/help':
      printCommandHelp();
      return true;
    case '/quit':
    case '/exit':
      return false;
    case '/config':
      printConfig(state);
      return true;
    case '/session':
      if (!value) {
        console.log('Usage: /session <id>');
        return true;
      }
      state.sessionId = value;
      console.log(`Switched to session ${state.sessionId}`);
      return true;
    case '/new':
      state.sessionId = `cli-${randomUUID().slice(0, 8)}`;
      console.log(`Started new session ${state.sessionId}`);
      return true;
    case '/model':
      if (!value) {
        console.log('Usage: /model <id>');
        return true;
      }
      state.model = value;
      console.log(`Model set to ${state.model}`);
      return true;
    case '/agent':
      state.agentId = !value || value === 'none' ? null : value;
      console.log(`Agent set to ${state.agentId || '(none)'}`);
      return true;
    case '/reviewer':
      state.reviewerId = !value || value === 'none' ? null : value;
      console.log(`Reviewer set to ${state.reviewerId || '(none)'}`);
      return true;
    case '/complexity':
      if (!value) {
        console.log('Usage: /complexity <low|medium|high>');
        return true;
      }
      state.complexity = value;
      console.log(`Complexity set to ${state.complexity}`);
      return true;
    case '/models':
      await listModels(state);
      return true;
    case '/agents':
      await listAgents(state);
      return true;
    case '/history':
      await showHistory(state, rest[0]);
      return true;
    case '/multiline': {
      console.log('Paste your message. Finish with a single "." on its own line.\n');
      const lines = [];
      while (true) {
        const nextLine = await state.rl.question('... ');
        if (nextLine.trim() === '.') {
          break;
        }
        lines.push(nextLine);
      }
      const message = lines.join('\n').trim();
      if (!message) {
        console.log('No message captured.');
        return true;
      }
      try {
        await sendMessage(state, message);
      } catch (error) {
        console.error(`Chat failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return true;
    }
    case '/tools':
      state.showTools = value !== 'off';
      console.log(`Tool event printing ${state.showTools ? 'enabled' : 'disabled'}.`);
      return true;
    case '/raw':
      state.rawEvents = value === 'on';
      console.log(`Raw event printing ${state.rawEvents ? 'enabled' : 'disabled'}.`);
      return true;
    default:
      console.log(`Unknown command: ${command}. Use /help.`);
      return true;
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }

  const headers = await getAuthHeaders(options.apiBase);
  const state = {
    ...options,
    headers,
  };

  console.log('\nRawClaw Chat CLI');
  console.log('Streaming through the full API chat pipeline.');
  printConfig(state);

  if (state.oneShotMessage) {
    await sendMessage(state, state.oneShotMessage);
    return;
  }

  if (state.messageFile) {
    const message = await readFile(state.messageFile, 'utf8');
    await sendMessage(state, message);
    return;
  }

  if (state.stdinMessage) {
    const message = (await readAllStdin()).trim();
    if (!message) {
      throw new Error('No stdin message content was provided.');
    }
    await sendMessage(state, message);
    return;
  }

  printCommandHelp();

  const rl = readline.createInterface({ input, output });
  state.rl = rl;
  try {
    while (true) {
      const line = (await rl.question('you> ')).trim();
      if (!line) {
        continue;
      }

      if (line.startsWith('/')) {
        const shouldContinue = await handleCommand(state, line);
        if (!shouldContinue) {
          break;
        }
        continue;
      }

      try {
        await sendMessage(state, line);
      } catch (error) {
        console.error(`Chat failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
