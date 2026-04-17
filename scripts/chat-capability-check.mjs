const API_BASE = process.env.RAWCLAW_API_URL || 'http://localhost:3000/api';

async function main() {
  const summary = {
    apiBase: API_BASE,
    startedAt: new Date().toISOString(),
    checks: {},
  };

  const token = await getToken();
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  const mcpHealth = await apiGet('/mcp/health', authHeaders).catch((error) => ({ error: error.message }));
  summary.checks.mcpHealth = mcpHealth;

  const modelsPayload = await apiGet('/chat/models', authHeaders);
  const model = chooseModel(modelsPayload.models || []);
  summary.checks.selectedModel = model;

  const plainSessionId = `verify-plain-${Date.now()}`;
  const plain = await runChat({
    sessionId: plainSessionId,
    model,
    message: 'Reply with exactly PLAIN_OK and nothing else.',
    headers: authHeaders,
  });
  summary.checks.plainChat = plain;

  const invalidModel = await runChat({
    sessionId: `verify-invalid-${Date.now()}`,
    model: 'ollama/definitely-missing-model',
    message: 'Reply with exactly INVALID_MODEL_OK and nothing else.',
    headers: authHeaders,
  });
  summary.checks.invalidModelRouting = invalidModel;

  const tempAgent = await apiPost(
    '/agents',
    {
      name: `verify-agent-${Date.now()}`,
      description: 'Temporary verification agent',
      systemPrompt: 'You are a verification agent. Reply with exactly AGENT_OK and nothing else.',
      isDefault: false,
    },
    authHeaders,
  );

  summary.checks.createdAgent = { id: tempAgent.id, name: tempAgent.name };

  const agentSessionId = `verify-agent-session-${Date.now()}`;
  const agentChat = await runChat({
    sessionId: agentSessionId,
    model,
    message: 'Reply with exactly AGENT_OK and nothing else.',
    agentId: tempAgent.id,
    headers: authHeaders,
  });
  summary.checks.selectedAgentChat = agentChat;

  const plainHistory = await apiGet(`/chat/sessions/${plainSessionId}`, authHeaders).catch((error) => ({ error: error.message }));
  const agentHistory = await apiGet(`/chat/sessions/${agentSessionId}`, authHeaders).catch((error) => ({ error: error.message }));

  summary.checks.plainHistory = inspectHistory(plainHistory);
  summary.checks.agentHistory = inspectHistory(agentHistory);

  await apiDelete(`/agents/${tempAgent.id}`, authHeaders).catch(() => null);

  const failures = [];
  if (!plain.ok) failures.push('plain chat failed');
  if (!agentChat.ok) failures.push('selected-agent chat failed');
  if (!summary.checks.plainHistory.ok) failures.push('plain history normalization failed');
  if (!summary.checks.agentHistory.ok) failures.push('agent history normalization failed');

  summary.failures = failures;
  summary.finishedAt = new Date().toISOString();

  console.log(JSON.stringify(summary, null, 2));

  if (failures.length) {
    process.exitCode = 1;
  }
}

async function getToken() {
  const response = await fetch(`${API_BASE}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: '' }),
  });
  if (!response.ok) {
    throw new Error(`Token request failed: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.access_token;
}

async function apiGet(path, headers) {
  const response = await fetch(`${API_BASE}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function apiPost(path, body, headers) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`POST ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function apiDelete(path, headers) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'DELETE',
    headers,
  });
  if (!response.ok) {
    throw new Error(`DELETE ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function chooseModel(models) {
  const preferred = [
    'ollama/qwen2.5:1.5b',
    'ollama/phi3:3.8b',
    'ollama/llama3.2:3b',
    'ollama/llama3.2:latest',
    'ollama/llama3:8b',
  ];
  for (const candidate of preferred) {
    if (models.some((model) => model.id === candidate)) {
      return candidate;
    }
  }
  const firstOllama = models.find((model) => String(model.id || '').startsWith('ollama/'));
  return firstOllama?.id || models[0]?.id;
}

async function runChat({ sessionId, model, message, agentId, headers }) {
  const response = await fetch(`${API_BASE}/chat/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      session_id: sessionId,
      messages: [{ role: 'user', content: message }],
      model,
      stream: true,
      agent_id: agentId,
    }),
  });

  if (!response.ok) {
    return {
      ok: false,
      httpStatus: response.status,
      httpBody: await response.text(),
      content: '',
      errors: [],
      events: [],
    };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return { ok: false, content: '', errors: ['missing stream body'], events: [] };
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const errors = [];
  const events = [];

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
      if (!payload) continue;
      try {
        const data = JSON.parse(payload);
        events.push(data.type || 'unknown');
        if (data.type === 'content' && typeof data.content === 'string') {
          content += data.content;
        }
        if (data.type === 'error') {
          errors.push(data);
        }
      } catch (error) {
        errors.push({ type: 'parse_error', message: String(error), payload });
      }
    }
  }

  if (buffer.trim()) {
    const payload = buffer.startsWith('data:') ? buffer.slice(5).trim() : buffer.trim();
    if (payload) {
      try {
        const data = JSON.parse(payload);
        events.push(data.type || 'unknown');
        if (data.type === 'content' && typeof data.content === 'string') {
          content += data.content;
        }
        if (data.type === 'error') {
          errors.push(data);
        }
      } catch (error) {
        errors.push({ type: 'parse_error', message: String(error), payload });
      }
    }
  }

  return {
    ok: errors.length === 0 && content.trim().length > 0,
    content: content.trim(),
    errors,
    events,
  };
}

function inspectHistory(sessionPayload) {
  if (!sessionPayload || sessionPayload.error) {
    return { ok: false, reason: sessionPayload?.error || 'missing payload' };
  }

  const messages = Array.isArray(sessionPayload.messages) ? sessionPayload.messages : [];
  const assistant = [...messages].reverse().find((message) => message.role === 'assistant');
  if (!assistant) {
    return { ok: false, reason: 'no assistant message in session history', messagesCount: messages.length };
  }

  const checks = {
    toolResultsIsString: typeof assistant.toolResults === 'string',
    provenanceTraceIsString: typeof assistant.provenanceTrace === 'string',
    citationsIsString: typeof assistant.citations === 'string',
  };

  return {
    ok: !checks.toolResultsIsString && !checks.provenanceTraceIsString && !checks.citationsIsString,
    messagesCount: messages.length,
    assistantPreview: String(assistant.content || '').slice(0, 120),
    checks,
  };
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: true, message: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
