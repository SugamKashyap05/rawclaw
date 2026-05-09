#!/usr/bin/env node

import readline from 'node:readline/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

const DEFAULT_API_BASE = process.env.RAWCLAW_API_URL || 'http://localhost:3000/api';
const DEFAULT_AUTH_SECRET = process.env.RAWCLAW_AUTH_SECRET || 'Kuki7816';
const DEFAULT_MODEL = process.env.RAWCLAW_CHAT_MODEL || 'ollama/gemma4:31b-cloud';
const DEFAULT_COMPLEXITY = process.env.RAWCLAW_CHAT_COMPLEXITY || 'medium';
const DEFAULT_BUILDER_MODE = process.env.RAWCLAW_APP_BUILDER_MODE || 'chat';
const DEFAULT_BUILDER_WORKSPACE = process.env.RAWCLAW_APP_BUILDER_WORKSPACE || 'default';

function createDefaultBuilderBrief() {
  return {
    workspaceId: DEFAULT_BUILDER_WORKSPACE,
    sourceType: 'generated',
    appType: 'web_app',
    controlMode: 'assist_only',
    templateId: null,
    titleOverride: null,
    sourcePath: null,
    prompt: null,
  };
}

function usage() {
  return `
RawClaw CLI

Usage:
  node scripts/chat-cli.mjs [options]
  npm run chat:cli -- [options]
  npm run app-builder:cli -- [options]

Options:
  --module <name>        chat | app-builder (default: chat)
  --api-base <url>       API base URL (default: ${DEFAULT_API_BASE})
  --session <id>         Start with a specific chat session id
  --model <id>           Set the initial model id
  --agent <id>           Set the initial agent id
  --reviewer <id>        Set the initial output reviewer id
  --complexity <level>   low | medium | high (default: ${DEFAULT_COMPLEXITY})
  --project <id>         App Builder project id
  --builder-mode <mode>  chat | workspace | console (default: ${DEFAULT_BUILDER_MODE})
  --workspace <id>       App Builder workspace id (default: ${DEFAULT_BUILDER_WORKSPACE})
  --builder-source <id>  generated | imported
  --app-type <id>        web_app | ai_tool
  --control-mode <id>    observe_only | assist_only | action_limited | full_control
  --template <id>        App Builder template id
  --title <text>         App Builder title override
  --source-path <path>   Source path for imported App Builder projects
  --message <text>       Send one message and exit
  --stdin                Read one message from stdin and exit
  --message-file <path>  Read one message from a file and exit
  --raw-events           Print all streamed events as JSON
  --quiet-tools          Hide tool call/result summaries
  --help                 Show this help

Interactive commands:
  Chat module:
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

  App Builder module:
  /help                  Show command help
  /quit                  Exit
  /config                Show current App Builder config
  /new                   Start a fresh App Builder draft
  /project <id|none>     Switch current App Builder project
  /projects [count]      List recent App Builder projects
  /templates             List available App Builder templates
  /brief                 Show current App Builder brief
  /briefset <k> <v>      Update brief field (workspaceId, sourceType, appType, controlMode, templateId, titleOverride, sourcePath)
  /mode <mode>           chat | workspace | console
  /history [count]       Show current builder conversation
  /runs [count]          List recent App Builder runs
  /preview               Show preview state for current project
  /approve               Approve the current project gate
  /phase <name>          Queue a builder phase
  /registry [count]      List App Registry records
  /compose               Open a temp draft in your editor and submit it
  /multiline             Legacy multiline paste mode, finish with a single "." line
`.trim();
}

function parseArgs(argv) {
  const options = {
    module: 'chat',
    apiBase: DEFAULT_API_BASE,
    sessionId: `cli-${randomUUID().slice(0, 8)}`,
    model: DEFAULT_MODEL,
    agentId: null,
    reviewerId: null,
    complexity: DEFAULT_COMPLEXITY,
    projectId: null,
    builderMode: DEFAULT_BUILDER_MODE,
    builderDraftId: `builder-${randomUUID().slice(0, 8)}`,
    builderBrief: createDefaultBuilderBrief(),
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
    if (arg === '--module') {
      options.module = argv[++i] || options.module;
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
    if (arg === '--project') {
      options.projectId = argv[++i] || options.projectId;
      continue;
    }
    if (arg === '--builder-mode') {
      options.builderMode = argv[++i] || options.builderMode;
      continue;
    }
    if (arg === '--workspace') {
      options.builderBrief.workspaceId = argv[++i] || options.builderBrief.workspaceId;
      continue;
    }
    if (arg === '--builder-source') {
      options.builderBrief.sourceType = argv[++i] || options.builderBrief.sourceType;
      continue;
    }
    if (arg === '--app-type') {
      options.builderBrief.appType = argv[++i] || options.builderBrief.appType;
      continue;
    }
    if (arg === '--control-mode') {
      options.builderBrief.controlMode = argv[++i] || options.builderBrief.controlMode;
      continue;
    }
    if (arg === '--template') {
      options.builderBrief.templateId = argv[++i] || options.builderBrief.templateId;
      continue;
    }
    if (arg === '--title') {
      options.builderBrief.titleOverride = argv[++i] || options.builderBrief.titleOverride;
      continue;
    }
    if (arg === '--source-path') {
      options.builderBrief.sourcePath = argv[++i] || options.builderBrief.sourcePath;
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

function truncate(text, max = 140) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function printSection(title) {
  console.log(`\n${title}`);
}

function formatTimestamp(value) {
  if (!value) return '(unknown)';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function parseBuilderValue(raw, nullable = false) {
  if (nullable && (raw === 'null' || raw === 'none')) return null;
  return raw;
}

function resetBuilderState(state, overrides = {}) {
  state.projectId = overrides.projectId ?? null;
  state.builderDraftId = overrides.builderDraftId ?? `builder-${randomUUID().slice(0, 8)}`;
  state.builderMode = overrides.builderMode ?? DEFAULT_BUILDER_MODE;
  state.builderBrief = {
    ...createDefaultBuilderBrief(),
    ...overrides.builderBrief,
  };
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

async function fetchBuilderConversation(state) {
  const params = new URLSearchParams();
  if (state.projectId) params.set('projectId', state.projectId);
  else params.set('draftId', state.builderDraftId);
  params.set('mode', state.builderMode);
  const payload = await fetchJson(`${state.apiBase}/app-builder/conversations?${params.toString()}`, {
    headers: state.headers,
  });
  return payload?.conversation || null;
}

async function fetchBuilderBrief(state) {
  const params = new URLSearchParams();
  if (state.projectId) params.set('projectId', state.projectId);
  else params.set('draftId', state.builderDraftId);
  const payload = await fetchJson(`${state.apiBase}/app-builder/brief?${params.toString()}`, {
    headers: state.headers,
  });
  return payload?.brief || null;
}

async function updateBuilderBrief(state, patch) {
  const params = new URLSearchParams();
  if (state.projectId) params.set('projectId', state.projectId);
  else params.set('draftId', state.builderDraftId);
  const payload = await fetchJson(`${state.apiBase}/app-builder/brief?${params.toString()}`, {
    method: 'PATCH',
    headers: state.headers,
    body: JSON.stringify(patch),
  });
  state.builderBrief = payload?.brief || state.builderBrief;
  return state.builderBrief;
}

async function listBuilderProjects(state) {
  const payload = await fetchJson(`${state.apiBase}/app-builder/projects`, {
    headers: state.headers,
  });
  return payload?.projects || [];
}

async function listBuilderTemplates(state) {
  const payload = await fetchJson(`${state.apiBase}/app-builder/templates`, {
    headers: state.headers,
  });
  return payload?.templates || [];
}

async function fetchBuilderProjectDetail(state, projectId = state.projectId) {
  if (!projectId) return null;
  const payload = await fetchJson(`${state.apiBase}/app-builder/projects/${encodeURIComponent(projectId)}`, {
    headers: state.headers,
  });
  return payload?.detail || null;
}

async function fetchBuilderRuns(state, projectId = state.projectId) {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  const payload = await fetchJson(`${state.apiBase}/app-builder/runs${suffix}`, {
    headers: state.headers,
  });
  return payload?.runs || [];
}

async function fetchBuilderPreview(state, projectId = state.projectId) {
  if (!projectId) return null;
  const payload = await fetchJson(`${state.apiBase}/app-builder/projects/${encodeURIComponent(projectId)}/preview`, {
    headers: state.headers,
  });
  return payload?.preview || null;
}

async function approveBuilderProject(state) {
  if (!state.projectId) {
    throw new Error('No App Builder project is selected.');
  }
  const payload = await fetchJson(`${state.apiBase}/app-builder/projects/${encodeURIComponent(state.projectId)}/approval`, {
    method: 'POST',
    headers: state.headers,
    body: JSON.stringify({
      reviewer: 'chat-cli',
      notes: `Approved from App Builder CLI on ${new Date().toISOString()}.`,
      controlMode: state.builderBrief.controlMode || undefined,
    }),
  });
  return payload?.detail || null;
}

async function queueBuilderPhase(state, phase, requestPayload = null) {
  if (!state.projectId) {
    throw new Error('No App Builder project is selected.');
  }
  const payload = await fetchJson(`${state.apiBase}/app-builder/projects/${encodeURIComponent(state.projectId)}/runs`, {
    method: 'POST',
    headers: state.headers,
    body: JSON.stringify({ phase, requestPayload }),
  });
  return payload?.run || null;
}

async function listBuilderRegistry(state) {
  const payload = await fetchJson(`${state.apiBase}/app-builder/registry`, {
    headers: state.headers,
  });
  return payload?.records || [];
}

async function sendBuilderMessage(state, text) {
  const payload = await fetchJson(`${state.apiBase}/app-builder/assistant/messages`, {
    method: 'POST',
    headers: state.headers,
    body: JSON.stringify({
      message: text,
      draftId: state.builderDraftId,
      projectId: state.projectId,
      mode: state.builderMode,
      brief: state.builderBrief,
    }),
  });
  const response = payload?.response;
  if (!response) {
    throw new Error('App Builder assistant response was empty.');
  }
  state.builderDraftId = response.draftId || state.builderDraftId;
  state.projectId = response.projectId || state.projectId;
  state.builderMode = response.preferredMode || state.builderMode;
  state.builderBrief = response.brief || state.builderBrief;
  printBuilderAssistantResponse(response);
  return response;
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

async function composeInEditor(initialContent = '') {
  const tempDir = await mkdtemp(join(tmpdir(), 'rawclaw-app-builder-'));
  const draftPath = join(tempDir, 'builder-draft.md');
  const seed = initialContent || [
    '# App Builder Draft',
    '',
    'Describe the app you want, the key workflows, control requirements, and any constraints.',
    '',
  ].join('\n');

  await writeFile(draftPath, seed, 'utf8');

  const preferredEditor = process.env.VISUAL || process.env.EDITOR || 'notepad.exe';
  const useShell = Boolean(process.env.VISUAL || process.env.EDITOR);

  await new Promise((resolve, reject) => {
    const child = spawn(preferredEditor, [draftPath], {
      stdio: 'inherit',
      shell: useShell,
      windowsHide: false,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 || preferredEditor.toLowerCase().includes('notepad')) {
        resolve();
        return;
      }
      reject(new Error(`Editor exited with code ${code}`));
    });
  });

  try {
    return (await readFile(draftPath, 'utf8')).trim();
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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

function printChatCommandHelp() {
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

function printBuilderCommandHelp() {
  console.log('\nApp Builder Commands:');
  console.log('  /help                         Show this command help');
  console.log('  /quit                         Exit the CLI');
  console.log('  /config                       Show current builder configuration');
  console.log('  /new                          Start a fresh builder draft');
  console.log('  /project <id|none>            Switch the active builder project');
  console.log('  /projects [count]             List recent builder projects');
  console.log('  /templates                    List available builder templates');
  console.log('  /brief                        Show the current builder brief');
  console.log('  /briefset <field> <value>     Update a brief field');
  console.log('  /mode <chat|workspace|console> Switch builder assistant mode');
  console.log('  /history [count]              Show current builder conversation messages');
  console.log('  /runs [count]                 Show recent builder runs');
  console.log('  /preview                      Show preview state for current project');
  console.log('  /approve                      Approve the current project');
  console.log('  /phase <name>                 Queue a builder phase');
  console.log('  /registry [count]             Show recent registry records');
  console.log('  /compose                      Open a temp draft in your editor and submit it');
  console.log('  /multiline                    Legacy multiline paste mode');
  console.log('');
}

function printBuilderConfig(state) {
  console.log('\nCurrent App Builder CLI Config');
  console.log(formatLabel('API Base', state.apiBase));
  console.log(formatLabel('Project', state.projectId || '(draft)'));
  console.log(formatLabel('Draft', state.builderDraftId));
  console.log(formatLabel('Mode', state.builderMode));
  console.log(formatLabel('Workspace', state.builderBrief.workspaceId || 'default'));
  console.log(formatLabel('Source', state.builderBrief.sourceType || 'generated'));
  console.log(formatLabel('App type', state.builderBrief.appType || 'web_app'));
  console.log(formatLabel('Control', state.builderBrief.controlMode || 'assist_only'));
  console.log(formatLabel('Template', state.builderBrief.templateId || '(auto)'));
  console.log(formatLabel('Title', state.builderBrief.titleOverride || '(infer)'));
  console.log(formatLabel('Source path', state.builderBrief.sourcePath || '(none)'));
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
  const correlationId = `rc-cli-${randomUUID().slice(0, 8)}`;
  const request = {
    session_id: state.sessionId,
    correlation_id: correlationId,
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

async function syncBuilderState(state) {
  try {
    const brief = await fetchBuilderBrief(state);
    if (brief) {
      state.builderBrief = brief;
    }
  } catch {
    // Keep local defaults if the draft or project has not been initialized yet.
  }
}

function printBuilderProjectSummary(detail) {
  if (!detail?.project) {
    return;
  }
  printSection('Project');
  console.log(formatLabel('Name', detail.project.name));
  console.log(formatLabel('Status', detail.project.status));
  console.log(formatLabel('Type', detail.project.appType));
  console.log(formatLabel('Control', detail.project.controlMode));
  console.log(formatLabel('Template', detail.project.templateId || '(auto)'));
  console.log(formatLabel('Managed path', detail.project.managedPath || '(pending)'));
  console.log(formatLabel('Deploy path', detail.project.deployPath || '(not deployed)'));
  if (detail.latestValidation) {
    console.log(formatLabel('Validation', detail.latestValidation.ok ? 'passed' : 'needs fixes'));
  }
}

function printBuilderBrief(state) {
  printSection('Builder Brief');
  console.log(formatLabel('Draft', state.builderDraftId));
  console.log(formatLabel('Project', state.projectId || '(draft only)'));
  console.log(formatLabel('Workspace', state.builderBrief.workspaceId || 'default'));
  console.log(formatLabel('Source', state.builderBrief.sourceType || 'generated'));
  console.log(formatLabel('App type', state.builderBrief.appType || 'web_app'));
  console.log(formatLabel('Control', state.builderBrief.controlMode || 'assist_only'));
  console.log(formatLabel('Template', state.builderBrief.templateId || '(auto)'));
  console.log(formatLabel('Title', state.builderBrief.titleOverride || '(infer from prompt)'));
  console.log(formatLabel('Source path', state.builderBrief.sourcePath || '(none)'));
  console.log(formatLabel('Prompt', truncate(state.builderBrief.prompt || '(empty)', 200)));
  console.log(formatLabel('Updated', state.builderBrief.updatedAt || '(local draft)'));
  console.log('');
}

function printBuilderConversation(conversation, countText) {
  const count = Math.max(1, Number.parseInt(countText || '8', 10) || 8);
  printSection(`Conversation :: ${conversation?.title || 'Builder Chat'}`);
  const messages = (conversation?.messages || []).slice(-count);
  if (!messages.length) {
    console.log('(no builder messages yet)\n');
    return;
  }
  for (const message of messages) {
    const role = String(message.role || 'system').padEnd(10);
    const tone = message.tone && message.tone !== 'default' ? ` :: ${message.tone}` : '';
    const meta = message.meta ? ` :: ${message.meta}` : '';
    console.log(`[${role}] ${truncate(message.content, 220)}${tone}${meta}`);
  }
  console.log('');
}

function printBuilderProjects(projects, countText) {
  const count = Math.max(1, Number.parseInt(countText || '8', 10) || 8);
  printSection(`Projects (${projects.length})`);
  const items = projects.slice(0, count);
  if (!items.length) {
    console.log('(no builder projects yet)\n');
    return;
  }
  for (const project of items) {
    console.log(
      `- ${project.id} :: ${project.name} :: ${project.status} :: ${project.appType} :: ${project.controlMode} :: updated ${formatTimestamp(project.updatedAt)}`,
    );
  }
  console.log('');
}

function printBuilderTemplates(templates) {
  printSection(`Templates (${templates.length})`);
  if (!templates.length) {
    console.log('(no templates available)\n');
    return;
  }
  for (const template of templates) {
    const commands = (template.validationCommands || []).map((command) => command.id).join(', ') || 'none';
    console.log(`- ${template.id} :: ${template.name}`);
    console.log(`  ${template.appType} :: stack=${template.starterStack} :: deploy=${template.deployTargets.join(', ')}`);
    console.log(`  validation=${commands}`);
    console.log(`  ${truncate(template.description, 180)}`);
  }
  console.log('');
}

function printBuilderRuns(runs, countText) {
  const count = Math.max(1, Number.parseInt(countText || '8', 10) || 8);
  printSection(`Runs (${runs.length})`);
  const items = runs.slice(0, count);
  if (!items.length) {
    console.log('(no builder runs yet)\n');
    return;
  }
  for (const run of items) {
    const summary = run.summary ? ` :: ${truncate(run.summary, 120)}` : '';
    const error = run.error ? ` :: error=${truncate(run.error, 100)}` : '';
    console.log(`- ${run.id} :: ${run.phase} :: ${run.status}${summary}${error}`);
  }
  console.log('');
}

function printBuilderPreview(preview) {
  printSection('Preview');
  if (!preview) {
    console.log('(no preview data available)\n');
    return;
  }
  console.log(formatLabel('Status', preview.status));
  console.log(formatLabel('Title', preview.title));
  console.log(formatLabel('Summary', preview.summary));
  console.log(formatLabel('URL', preview.url || '(not available)'));
  console.log(formatLabel('Project path', preview.projectPath || '(not available)'));
  console.log(formatLabel('Tab', preview.currentTab || '(auto)'));
  console.log(formatLabel('Tabs', (preview.availableTabs || []).join(', ') || '(none)'));
  if (preview.logs?.length) {
    printSection('Preview Logs');
    for (const line of preview.logs.slice(-8)) {
      console.log(`- ${line}`);
    }
  }
  console.log('');
}

function printBuilderRegistry(records, countText) {
  const count = Math.max(1, Number.parseInt(countText || '8', 10) || 8);
  printSection(`Registry (${records.length})`);
  const items = records.slice(0, count);
  if (!items.length) {
    console.log('(no registered apps yet)\n');
    return;
  }
  for (const record of items) {
    console.log(
      `- ${record.appId} :: ${record.status} :: health=${record.healthStatus || 'unknown'} :: version=${record.version} :: endpoint=${record.controlEndpoint}`,
    );
  }
  console.log('');
}

function printBuilderDetail(detail) {
  if (!detail) {
    console.log('(no project detail available)\n');
    return;
  }
  printBuilderProjectSummary(detail);
  if (detail.approvalGate) {
    printSection('Approval Gate');
    console.log(formatLabel('Required', detail.approvalGate.required ? 'yes' : 'no'));
    console.log(formatLabel('Approved', detail.approvalGate.approved ? 'yes' : 'no'));
    console.log(formatLabel('Reviewer', detail.approvalGate.reviewer || '(pending)'));
    console.log(formatLabel('Reviewed at', detail.approvalGate.reviewedAt || '(pending)'));
    console.log(formatLabel('Notes', detail.approvalGate.notes || '(none)'));
  }
  if (detail.artifacts?.length) {
    printSection('Artifacts');
    for (const artifact of detail.artifacts.slice(0, 8)) {
      console.log(`- ${artifact.kind} :: ${artifact.stage} :: ${artifact.label} :: ${formatTimestamp(artifact.updatedAt)}`);
    }
  }
  if (detail.registryRecords?.length) {
    printSection('Registry Records');
    for (const record of detail.registryRecords.slice(0, 4)) {
      console.log(`- ${record.appId} :: ${record.status} :: ${record.controlEndpoint}`);
    }
  }
  console.log('');
}

function printBuilderAssistantResponse(response) {
  printSection('builder>');
  console.log(response?.assistantReply?.content || '(no assistant reply)');
  if (response?.responseKind) {
    console.log(`\n[mode] ${response.responseKind}`);
  }
  if (response?.researchSummary) {
    console.log(`\n[research] ${response.researchSummary}`);
  }
  if (response?.provenanceSummary) {
    console.log(`\n[provenance] ${response.provenanceSummary}`);
  }
  if (response?.queuedRuns?.length) {
    printSection('Queued Runs');
    for (const run of response.queuedRuns) {
      console.log(`- ${run.phase} :: ${run.id} :: ${run.status}`);
    }
  }
  if (response?.suggestedActions?.length) {
    printSection('Suggested Actions');
    for (const action of response.suggestedActions) {
      const label = action.phase ? `${action.label} (${action.phase})` : action.label;
      console.log(`- ${label}`);
    }
  }
  if (response?.preview?.url || response?.preview?.summary) {
    printSection('Preview');
    console.log(response.preview.url || response.preview.summary);
  }
  if (response?.detail) {
    printBuilderProjectSummary(response.detail);
  }
  console.log('');
}

async function handleCommand(state, line) {
  const [command, ...rest] = line.trim().split(/\s+/);
  const value = rest.join(' ').trim();

  switch (command) {
    case '/help':
      printChatCommandHelp();
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

async function handleBuilderCommand(state, line) {
  const [command, ...rest] = line.trim().split(/\s+/);
  const value = rest.join(' ').trim();

  switch (command) {
    case '/help':
      printBuilderCommandHelp();
      return true;
    case '/quit':
    case '/exit':
      return false;
    case '/config':
      printBuilderConfig(state);
      return true;
    case '/new':
      resetBuilderState(state, {
        builderBrief: {
          ...createDefaultBuilderBrief(),
          workspaceId: state.builderBrief.workspaceId || DEFAULT_BUILDER_WORKSPACE,
        },
      });
      console.log(`Started new builder draft ${state.builderDraftId}`);
      return true;
    case '/project':
      if (!value) {
        console.log('Usage: /project <id|none>');
        return true;
      }
      if (value === 'none') {
        resetBuilderState(state, {
          builderBrief: {
            ...state.builderBrief,
            prompt: null,
          },
        });
        console.log(`Detached from project. New builder draft ${state.builderDraftId}`);
        return true;
      }
      state.projectId = value;
      await syncBuilderState(state);
      printBuilderDetail(await fetchBuilderProjectDetail(state));
      return true;
    case '/projects':
      printBuilderProjects(await listBuilderProjects(state), rest[0]);
      return true;
    case '/templates':
      printBuilderTemplates(await listBuilderTemplates(state));
      return true;
    case '/brief':
      await syncBuilderState(state);
      printBuilderBrief(state);
      return true;
    case '/briefset': {
      const field = rest[0];
      const rawFieldValue = rest.slice(1).join(' ').trim();
      if (!field || !rawFieldValue) {
        console.log('Usage: /briefset <field> <value>');
        return true;
      }
      const fieldOptions = {
        workspaceId: { nullable: false },
        sourceType: { nullable: false },
        appType: { nullable: false },
        controlMode: { nullable: false },
        templateId: { nullable: true },
        titleOverride: { nullable: true },
        sourcePath: { nullable: true },
        prompt: { nullable: true },
      };
      if (!(field in fieldOptions)) {
        console.log(`Unknown brief field: ${field}`);
        return true;
      }
      const nextValue = parseBuilderValue(rawFieldValue, fieldOptions[field].nullable);
      await updateBuilderBrief(state, { [field]: nextValue });
      console.log(`Updated brief field ${field} -> ${nextValue ?? '(null)'}`);
      return true;
    }
    case '/mode':
      if (!value) {
        console.log('Usage: /mode <chat|workspace|console>');
        return true;
      }
      state.builderMode = value;
      console.log(`Builder mode set to ${state.builderMode}`);
      return true;
    case '/history':
      printBuilderConversation(await fetchBuilderConversation(state), rest[0]);
      return true;
    case '/runs':
      printBuilderRuns(await fetchBuilderRuns(state), rest[0]);
      return true;
    case '/preview':
      if (!state.projectId) {
        console.log('No App Builder project is selected.');
        return true;
      }
      printBuilderPreview(await fetchBuilderPreview(state));
      return true;
    case '/approve':
      printBuilderDetail(await approveBuilderProject(state));
      return true;
    case '/phase':
      if (!value) {
        console.log('Usage: /phase <plan|generate|integrate|validate|deploy|register|import|adapter-generate|export|control-test|rollback>');
        return true;
      }
      {
        const run = await queueBuilderPhase(state, value);
        printSection('Queued Phase');
        console.log(`- ${run.id} :: ${run.phase} :: ${run.status}`);
        console.log('');
      }
      return true;
    case '/registry':
      printBuilderRegistry(await listBuilderRegistry(state), rest[0]);
      return true;
    case '/compose': {
      try {
        const seed = state.builderBrief?.prompt || '';
        const message = await composeInEditor(seed);
        if (!message) {
          console.log('No builder draft content was submitted.');
          return true;
        }
        await sendBuilderMessage(state, message);
      } catch (error) {
        console.error(`Builder compose failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return true;
    }
    case '/multiline': {
      console.log('Paste your builder prompt. Finish with a single "." on its own line.\n');
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
        console.log('No builder prompt captured.');
        return true;
      }
      try {
        await sendBuilderMessage(state, message);
      } catch (error) {
        console.error(`Builder request failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      return true;
    }
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

  if (state.module !== 'chat' && state.module !== 'app-builder') {
    throw new Error(`Unsupported module "${state.module}". Use "chat" or "app-builder".`);
  }

  if (state.module === 'app-builder') {
    console.log('\nRawClaw App Builder CLI');
    console.log('Driving the App Builder assistant and builder runtime directly from terminal.');
    await syncBuilderState(state);
    printBuilderConfig(state);

    if (state.oneShotMessage) {
      await sendBuilderMessage(state, state.oneShotMessage);
      return;
    }

    if (state.messageFile) {
      const message = await readFile(state.messageFile, 'utf8');
      await sendBuilderMessage(state, message);
      return;
    }

    if (state.stdinMessage) {
      const message = (await readAllStdin()).trim();
      if (!message) {
        throw new Error('No stdin message content was provided.');
      }
      await sendBuilderMessage(state, message);
      return;
    }

    printBuilderCommandHelp();
  } else {
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

    printChatCommandHelp();
  }

  const rl = readline.createInterface({ input, output });
  state.rl = rl;
  try {
    while (true) {
      const prompt = state.module === 'app-builder' ? 'builder> ' : 'you> ';
      const line = (await rl.question(prompt)).trim();
      if (!line) {
        continue;
      }

      if (line.startsWith('/')) {
        const shouldContinue =
          state.module === 'app-builder' ? await handleBuilderCommand(state, line) : await handleCommand(state, line);
        if (!shouldContinue) {
          break;
        }
        continue;
      }

      try {
        if (state.module === 'app-builder') {
          await sendBuilderMessage(state, line);
        } else {
          await sendMessage(state, line);
        }
      } catch (error) {
        const label = state.module === 'app-builder' ? 'Builder request failed' : 'Chat failed';
        console.error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
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
