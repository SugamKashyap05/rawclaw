#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const apiBase = process.env.RAWCLAW_API_URL || 'http://localhost:3000/api';
const authSecret = process.env.RAWCLAW_AUTH_SECRET || 'Kuki7816';

const querySets = {
  simple_chat: [
    'Say hello in one sentence.',
    'Summarize what you can do in two bullets.',
    'What is 12 plus 30?',
    'Rewrite this sentence more clearly: the build is failing because tests are red.',
    'Give me a short checklist for debugging a local service.',
    'Explain SSE in one paragraph.',
    'What does a correlation ID help with?',
  ],
  memory_recall: [
    'Remember this canary baseline note: synthetic memory probe.',
    'What memory note did I just ask you to remember?',
    'Summarize any remembered preference for this session.',
    'Do you have previous context for this benchmark session?',
    'Recall the canary baseline note if available.',
    'What should I verify before canary?',
  ],
  web_research: [
    'Search for the latest RawClaw canary readiness note in available context.',
    'Find current information about Bengal election 2026 winner.',
    'Search for current OpenAI API changelog headline.',
    'Look up the latest IPL points table summary.',
    'Find recent news about Ollama release notes.',
    'Search for current ChromaDB documentation update.',
    'Find latest Redis stable version headline.',
  ],
};

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

async function fetchJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

async function authHeaders() {
  if (process.env.RAWCLAW_TOKEN) {
    return {
      Authorization: `Bearer ${process.env.RAWCLAW_TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    };
  }
  const payload = await fetchJson(`${apiBase}/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ secret: authSecret }),
  });
  return {
    Authorization: `Bearer ${payload.access_token}`,
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
}

async function runQuery(headers, lane, query, index) {
  const sessionId = `baseline-${lane}-${index}-${randomUUID().slice(0, 8)}`;
  const startedAt = performance.now();
  let firstTokenMs = null;
  let toolLatencyMs = null;
  let researchCompletionMs = null;
  let streamCompletionMs = null;
  let sawTool = false;

  const response = await fetch(`${apiBase}/chat/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      session_id: sessionId,
      correlation_id: `rc-baseline-${randomUUID().slice(0, 8)}`,
      messages: [{ role: 'user', content: query }],
      stream: true,
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Chat request failed (${response.status}): ${await response.text().catch(() => '')}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const payloadLine = chunk.split('\n').find((line) => line.trim().startsWith('data:'));
      if (!payloadLine) continue;
      let event = null;
      try {
        event = JSON.parse(payloadLine.replace(/^data:\s*/, ''));
      } catch {
        continue;
      }
      const elapsed = Math.round(performance.now() - startedAt);
      if (event.type === 'content' && firstTokenMs === null) firstTokenMs = elapsed;
      if ((event.type === 'tool_call' || event.type === 'tool_result') && !sawTool) {
        sawTool = true;
        toolLatencyMs = elapsed;
      }
      if ((event.type === 'sources' || event.type === 'provenance') && researchCompletionMs === null) {
        researchCompletionMs = elapsed;
      }
      if (event.type === 'done' || event.type === 'error') {
        streamCompletionMs = elapsed;
        return {
          lane,
          query,
          sessionId,
          first_token_ms: firstTokenMs,
          tool_latency_ms: toolLatencyMs,
          research_completion_ms: researchCompletionMs,
          stream_completion_ms: streamCompletionMs,
          terminal_type: event.type,
          error: event.error || null,
        };
      }
    }
  }
  streamCompletionMs = Math.round(performance.now() - startedAt);
  return { lane, query, sessionId, first_token_ms: firstTokenMs, tool_latency_ms: toolLatencyMs, research_completion_ms: researchCompletionMs, stream_completion_ms: streamCompletionMs, terminal_type: 'closed' };
}

async function main() {
  const headers = await authHeaders();
  const queries = Object.entries(querySets).flatMap(([lane, values]) => values.map((query, index) => ({ lane, query, index }))).slice(0, 20);
  const results = [];
  for (const item of queries) {
    console.log(`[BASELINE] ${item.lane}: ${item.query}`);
    results.push(await runQuery(headers, item.lane, item.query, item.index));
  }
  const completed = results.filter((item) => typeof item.stream_completion_ms === 'number');
  const output = {
    created_at: new Date().toISOString(),
    api_base: apiBase,
    sample_count: results.length,
    p50_stream_completion_ms: percentile(completed.map((item) => item.stream_completion_ms), 50),
    p95_stream_completion_ms: percentile(completed.map((item) => item.stream_completion_ms), 95),
    results,
  };
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const outputPath = join(repoRoot, 'benchmarks', `baseline-${stamp}.json`);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`[BASELINE_RESULT] ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
