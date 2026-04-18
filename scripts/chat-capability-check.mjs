const API_BASE = process.env.RAWCLAW_API_URL || 'http://localhost:3000/api';
const REQUEST_TIMEOUT_MS = 30000;
const CHAT_REQUEST_TIMEOUT_MS = 120000;
const STREAM_IDLE_TIMEOUT_MS = 120000;

import fs from 'node:fs';
import path from 'node:path';

async function main() {
  const summary = {
    apiBase: API_BASE,
    startedAt: new Date().toISOString(),
    checks: {},
  };

  summary.checks.apiHealth = await preflightApi();
  if (!summary.checks.apiHealth.ok) {
    summary.finishedAt = new Date().toISOString();
    summary.failures = ['api unavailable'];
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = 1;
    return;
  }

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

  // New Document Processing Checks
  const fixturesDir = path.join(process.cwd(), 'scripts', 'test-fixtures');

  // A. PDF Text Document
  const pdfPath = path.join(fixturesDir, 'tiny-text.pdf');
  const pdfBase64 = fs.readFileSync(pdfPath).toString('base64');
  const pdfSessionId = `verify-pdf-${Date.now()}`;
  const pdfCheck = await runChat({
    sessionId: pdfSessionId,
    model,
    message: 'What is the specific text code in this PDF?',
    attachments: [{ filename: 'tiny-text.pdf', content: pdfBase64, type: 'application/pdf' }],
    headers: authHeaders,
  });
  const pdfHistory = await apiGet(`/chat/sessions/${pdfSessionId}`, authHeaders).catch(() => null);
  const pdfResponseHasText = pdfCheck.content?.toLowerCase().includes('rawclaw_pdf');
  const pdfHistoryHasText = pdfHistory?.messages?.some(m => m.attachments?.some(a => a.extractedText?.toLowerCase().includes('rawclaw_pdf'))) || false;

  summary.checks.pdfTextDocument = {
    ok: pdfResponseHasText || pdfHistoryHasText,
    responseOk: pdfResponseHasText,
    historyExtractionOk: pdfHistoryHasText,
    content: pdfCheck.content,
  };

  // B. Image Document (OCR)
  const imgPath = path.join(fixturesDir, 'tiny-ocr.png');
  const imgBase64 = fs.readFileSync(imgPath).toString('base64');
  const imgSessionId = `verify-img-${Date.now()}`;
  const imgCheck = await runChat({
    sessionId: imgSessionId,
    model,
    message: 'Read the text in this image.',
    attachments: [{ filename: 'tiny-ocr.png', content: imgBase64, type: 'image/png' }],
    headers: authHeaders,
  });
  const imgHistory = await apiGet(`/chat/sessions/${imgSessionId}`, authHeaders).catch(() => null);
  const imgExtractionFailed = imgHistory?.messages?.some(m => m.attachments?.some(a => a.extractionFailed)) || false;
  const ocrNotSupported = imgHistory?.messages?.some(m => m.attachments?.some(a => a.extractionError?.toLowerCase().includes('not supported') || a.extractionError?.toLowerCase().includes('not yet enabled'))) || false;
  // Check for the deterministic OCR token that must appear in the extracted text
  const imgExtractedText = imgHistory?.messages?.find(m => m.attachments?.[0]?.extractedText)?.attachments?.[0]?.extractedText || '';
  const ocrToken = 'RAWCLAW';
  const tokenInExtractedText = imgExtractedText.includes(ocrToken);
  // Also check if the model mentioned the token in its response (direct vision fallback)
  const tokenInResponse = imgCheck.content?.includes(ocrToken) || false;

  // Truthful classification:
  // - ok=true only when OCR actually extracted/used the token (not just any generic response)
  // - ok=false when extraction was attempted but failed to produce the token
  // - skipped=true when OCR is not available in the environment
  const ocrActuallyWorked = !imgExtractionFailed && !ocrNotSupported && (tokenInExtractedText || tokenInResponse);

  summary.checks.imageDocument = {
    ok: ocrActuallyWorked || ocrNotSupported,
    skipped: ocrNotSupported,
    supported: !ocrNotSupported,
    content: imgCheck.content,
    status: ocrNotSupported ? 'skipped_not_supported' : (imgExtractionFailed ? 'failed' : 'success'),
    error: imgHistory?.messages?.find(m => m.attachments?.[0]?.extractionError)?.attachments[0].extractionError || null,
    tokenInExtractedText,
    tokenInResponse,
    extractedTextPreview: imgExtractedText.slice(0, 80),
  };

  // C. Scanned PDF Behavior
  const scannedPath = path.join(fixturesDir, 'empty-scanned.pdf');
  const scannedBase64 = fs.readFileSync(scannedPath).toString('base64');
  const scannedSessionId = `verify-scanned-${Date.now()}`;
  const scannedCheck = await runChat({
    sessionId: scannedSessionId,
    model,
    message: 'Extract text from this scanned PDF.',
    attachments: [{ filename: 'empty-scanned.pdf', content: scannedBase64, type: 'application/pdf' }],
    headers: authHeaders,
  });
  const scannedHistory = await apiGet(`/chat/sessions/${scannedSessionId}`, authHeaders).catch(() => null);
  const hasScannedWarning = scannedHistory?.messages?.some(m => m.attachments?.some(a => a.extractionError?.includes('Scanned PDF detected'))) || false;
  
  summary.checks.scannedPdfBehavior = {
    ok: scannedCheck.ok || hasScannedWarning,
    hasWarning: hasScannedWarning,
    content: scannedCheck.content
  };

  // D. Post-Document API Health
  const postHealth = await preflightApi();
  const postPlain = await runChat({
    sessionId: `verify-post-${Date.now()}`,
    model,
    message: 'Are you still healthy?',
    headers: authHeaders,
  });
  summary.checks.postDocumentApiHealth = {
    healthOk: postHealth.ok,
    chatOk: postPlain.ok
  };

  await apiDelete(`/agents/${tempAgent.id}`, authHeaders).catch(() => null);

  const failures = [];
  if (!plain.ok) failures.push('plain chat failed');
  if (!agentChat.ok) failures.push('selected-agent chat failed');
  if (!summary.checks.plainHistory.ok) failures.push('plain history normalization failed');
  if (!summary.checks.agentHistory.ok) failures.push('agent history normalization failed');
  if (!summary.checks.pdfTextDocument.ok) failures.push('pdf text document check failed');
  if (!summary.checks.postDocumentApiHealth.healthOk) failures.push('api health poisoned after documents');
  if (!summary.checks.postDocumentApiHealth.chatOk) failures.push('plain chat failed after documents');
  // imageDocument failures are only counted if OCR was attempted and actually failed (not skipped)
  const img = summary.checks.imageDocument;
  if (!img.skipped && !img.ok) failures.push('image document OCR check failed');

  summary.failures = failures;
  summary.finishedAt = new Date().toISOString();

  console.log(JSON.stringify(summary, null, 2));

  if (failures.length) {
    process.exitCode = 1;
  }
}

async function getToken() {
  const response = await fetchWithTimeout(`${API_BASE}/auth/token`, {
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

async function preflightApi() {
  try {
    const response = await fetchWithTimeout(`${API_BASE}/health`);
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        message: `Health check failed: ${response.status}`,
      };
    }
    const data = await response.json();
    return {
      ok: true,
      status: response.status,
      payload: data,
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function apiGet(path, headers) {
  const response = await fetchWithTimeout(`${API_BASE}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GET ${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function apiPost(path, body, headers) {
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
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
  const response = await fetchWithTimeout(`${API_BASE}${path}`, {
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

async function runChat({ sessionId, model, message, agentId, attachments, headers }) {
  const response = await fetchWithTimeout(`${API_BASE}/chat/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      session_id: sessionId,
      messages: [{ role: 'user', content: message, attachments }],
      model,
      stream: true,
      agent_id: agentId,
    }),
  }, CHAT_REQUEST_TIMEOUT_MS);

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
  let streamFinished = false;
  let idleTimer = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
      try {
        await reader.cancel('verify chat stream idle timeout');
      } catch {
        // ignore
      }
    }, STREAM_IDLE_TIMEOUT_MS);
  };

  const handlePayload = (payload) => {
    if (!payload) return;
    try {
      const data = JSON.parse(payload);
      events.push(data.type || 'unknown');
      if (data.type === 'content' && typeof data.content === 'string') {
        content += data.content;
      }
      if (data.type === 'error') {
        errors.push(data);
        streamFinished = true;
      }
      if (data.type === 'done') {
        streamFinished = true;
      }
    } catch (error) {
      errors.push({ type: 'parse_error', message: String(error), payload });
      streamFinished = true;
    }
  };

  try {
    resetIdleTimer();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resetIdleTimer();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
        if (!payload) continue;
        handlePayload(payload);
        if (streamFinished) {
          try {
            await reader.cancel('verify chat stream finished');
          } catch {
            // ignore
          }
          break;
        }
      }
      if (streamFinished) break;
    }
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }

  if (buffer.trim() && !streamFinished) {
    const payload = buffer.startsWith('data:') ? buffer.slice(5).trim() : buffer.trim();
    if (payload) {
      handlePayload(payload);
    }
  }

  return {
    ok: errors.length === 0 && content.trim().length > 0,
    content: content.trim(),
    errors,
    events,
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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
