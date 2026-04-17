import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AgentProfile, ChatStreamChunk, ToolResult } from '@rawclaw/shared';
import { api } from '../lib/api';
import { AUTH_TOKEN_KEY } from '../lib/auth';
import { ChatSidebar } from '../components/ChatSidebar';
import { ConfirmationBanner } from '../components/ConfirmationBanner';
import { WebSearchResult } from '../components/chat/WebSearchResult';
import { BrowserResult } from '../components/chat/BrowserResult';
import { FileResult } from '../components/chat/FileResult';
import { CodeResult } from '../components/chat/CodeResult';
import { TerminalResult } from '../components/chat/TerminalResult';
import { ProvenanceTrace } from '../components/chat/ProvenanceTrace';

interface Props {
  selectedModel: string;
}

interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: any[];
  toolResults?: ToolResult[];
  provenanceTrace?: ChatStreamChunk['provenance_trace'];
  citations?: Array<{ url: string; title?: string }>;
  error?: {
    type: 'agent_unavailable' | 'model_unavailable' | 'mcp_unavailable' | 'tool_failed' | 'stream_interrupted' | 'auth_failure';
    message: string;
    details?: string;
  };
}

export default function Chat({ selectedModel }: Props) {
  const { sessionId: routeSessionId } = useParams();
  const navigate = useNavigate();
  const [localSessionId] = useState(() => cryptoRandom());
  const sessionId = routeSessionId || localSessionId;

  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [input, setInput] = useState('');
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [sending, setSending] = useState(false);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void loadAgents();
  }, []);

  useEffect(() => {
    if (!routeSessionId) {
      setMessages([]);
      return;
    }
    void loadHistory(routeSessionId);
  }, [routeSessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) || null,
    [agents, selectedAgentId],
  );

  const loadAgents = async () => {
    const response = await api.get<AgentProfile[]>('/agents');
    setAgents(response.data);
    const defaultAgent = response.data.find((agent) => agent.isDefault);
    if (defaultAgent) setSelectedAgentId(defaultAgent.id);
  };

  const loadHistory = async (id: string) => {
    setLoadingHistory(true);
    try {
      const response = await api.get<{ messages: SessionMessage[] }>(`/chat/sessions/${id}`);
      setMessages(response.data?.messages || []);
    } finally {
      setLoadingHistory(false);
    }
  };

  const send = async () => {
    if (!input.trim() || sending) return;
    const prompt = input.trim();
    setInput('');
    setSending(true);

    if (!routeSessionId) navigate(`/chat/${sessionId}`, { replace: true });

    setMessages((current) => [
      ...current,
      { role: 'user', content: prompt },
      { role: 'assistant', content: '', toolResults: [] },
    ]);

    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const isComplexity = selectedModel.startsWith('complexity:');
      const response = await fetch('/api/chat/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          session_id: sessionId,
          messages: [{ role: 'user', content: prompt }],
          model: isComplexity ? undefined : selectedModel,
          complexity: isComplexity ? selectedModel.split(':')[1] : undefined,
          stream: true,
          agent_id: selectedAgentId || undefined,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Chat request failed with status ${response.status}`);
      }

      if (!response.body) throw new Error('No response body from chat stream.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      const toolResults: ToolResult[] = [];
      let streamBuffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split('\n');
        streamBuffer = lines.pop() || '';

        for (const line of lines) {
          const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
          if (!payload) continue;

          try {
            const data = JSON.parse(payload) as ChatStreamChunk;
            if (data.type === 'content' && data.content) {
              assistantText += data.content;
              patchAssistant({ content: assistantText });
            } else if (data.type === 'tool_result' && data.tool_result) {
              toolResults.push(data.tool_result);
              patchAssistant({ toolResults: [...toolResults] });
            } else if (data.type === 'provenance') {
              patchAssistant({ provenanceTrace: data.provenance_trace });
            } else if (data.type === 'error') {
              patchAssistant({
                content: '',
                error: {
                  type: 'agent_unavailable',
                  message: data.error || 'Unknown failure',
                  details: ''
                }
              });
            }
          } catch {
            // Ignore malformed SSE frames.
          }
        }
      }

      if (streamBuffer.trim()) {
        const payload = streamBuffer.startsWith('data:') ? streamBuffer.slice(5).trim() : streamBuffer.trim();
        if (payload) {
          try {
            const data = JSON.parse(payload) as ChatStreamChunk;
            if (data.type === 'content' && data.content) {
              assistantText += data.content;
              patchAssistant({ content: assistantText });
            } else if (data.type === 'tool_result' && data.tool_result) {
              toolResults.push(data.tool_result);
              patchAssistant({ toolResults: [...toolResults] });
            } else if (data.type === 'provenance') {
              patchAssistant({ provenanceTrace: data.provenance_trace });
            } else if (data.type === 'error') {
              patchAssistant({
                content: '',
                error: {
                  type: 'agent_unavailable',
                  message: data.error || 'Unknown failure',
                  details: ''
                }
              });
            }
          } catch {
            // Ignore malformed trailing frame.
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chat failed.';
      patchAssistant({
        content: '',
        error: {
          type: 'agent_unavailable',
          message: 'Connection failed',
          details: message
        }
      });
    } finally {
      setSending(false);
    }
  };

  const patchAssistant = (patch: Partial<SessionMessage>) => {
    setMessages((current) => {
      const next = [...current];
      const index = next.map((item) => item.role).lastIndexOf('assistant');
      if (index >= 0) next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 220px)', gap: '1rem' }}>
      <ChatSidebar />

      <div className="glass-card" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <div style={{ paddingBottom: '1rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: '1.6rem', marginBottom: '0.25rem' }}>Chat</h1>
            <div style={{ color: 'var(--text-secondary)' }}>
              Stream responses, inspect tool executions, and switch agent profiles mid-conversation.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', minWidth: '320px' }}>
            <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)} style={fieldStyle}>
              <option value="">No agent override</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <ConfirmationBanner sessionId={sessionId} />

        <div ref={scrollRef} className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', display: 'grid', gap: '1rem', paddingRight: '0.25rem' }}>
          {loadingHistory ? <div style={{ color: 'var(--text-muted)' }}>Loading history...</div> : null}

          {!loadingHistory && messages.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: '3rem 0', textAlign: 'center' }}>
              Start a conversation to activate the full chat, tool, and memory pipeline.
            </div>
          ) : (
            messages.map((message, index) => (
              <MessageCard key={`${message.role}-${index}`} message={message} />
            ))
          )}
        </div>

        <div style={{ paddingTop: '1rem', marginTop: '1rem', borderTop: '1px solid var(--border-glass)' }}>
          {selectedAgent ? (
            <div style={{ marginBottom: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Active agent: <strong>{selectedAgent.name}</strong>
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={3}
              placeholder="Ask RawClaw to search, browse, run tools, or reason through a task..."
              style={{ ...fieldStyle, resize: 'vertical', minHeight: '84px' }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button className="btn-primary" onClick={() => void send()} disabled={sending || !input.trim()}>
              {sending ? 'Streaming...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getErrorMessage(type: string): string {
  switch (type) {
    case 'agent_unavailable':
      return 'Agent Service Unavailable';
    case 'model_unavailable':
      return 'Model Provider Unavailable';
    case 'mcp_unavailable':
      return 'Tool System Unavailable';
    case 'tool_failed':
      return 'Tool Execution Failed';
    case 'stream_interrupted':
      return 'Stream Interrupted';
    case 'auth_failure':
      return 'Authentication Failed';
    case 'provider_routing_failed':
      return 'Provider Routing Failed';
    default:
      return 'Error';
  }
}

function MessageCard({ message }: { message: SessionMessage }) {
  const isUser = message.role === 'user';

  return (
    <div style={{ display: 'grid', gap: '0.65rem', justifyItems: isUser ? 'end' : 'start' }}>
      <div
        style={{
          maxWidth: '84%',
          borderRadius: '16px',
          padding: '1rem',
          background: isUser ? 'rgba(0,240,255,0.08)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${isUser ? 'rgba(0,240,255,0.18)' : 'var(--border-glass)'}`,
        }}
      >
        <div className="mono" style={{ fontSize: '0.72rem', color: isUser ? 'var(--neon-cyan)' : 'var(--text-muted)', marginBottom: '0.45rem' }}>
          {isUser ? 'USER' : 'RAWCLAW'}
        </div>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{message.content || '...'}</div>
      </div>

      {message.error ? (
        <div style={{
          width: '100%',
          marginTop: '0.8rem',
          padding: '1rem',
          background: 'rgba(255,77,77,0.08)',
          border: '1px solid rgba(255,77,77,0.3)',
          borderRadius: '12px',
          color: 'var(--error)'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
            {getErrorMessage(message.error.type)}
          </div>
          <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>
            {message.error.message}
            {message.error.details && (
              <>
                <br />
                {message.error.details}
              </>
            )}
          </div>
        </div>
      ) : null}

      {!isUser && message.toolResults && message.toolResults.length > 0 ? (
        <div style={{ width: '100%', display: 'grid', gap: '0.8rem' }}>
          {message.toolResults.map((result, index) => (
            <ToolResultRenderer key={`${result.tool_name}-${index}`} result={result} />
          ))}
        </div>
      ) : null}

      {!isUser && message.provenanceTrace ? <ProvenanceTrace trace={message.provenanceTrace} /> : null}
    </div>
  );
}

function ToolResultRenderer({ result }: { result: ToolResult }) {
  const name = result.tool_name.toLowerCase();
  if (name.includes('search')) return <WebSearchResult result={result} />;
  if (name.includes('browser') || name.includes('fetch') || name.includes('navigate')) return <BrowserResult result={result} />;
  if (name.includes('file')) return <FileResult result={result} />;
  if (name.includes('python') || name.includes('code')) return <CodeResult result={result} />;
  if (name.includes('shell') || name.includes('terminal') || name.includes('bash') || name.includes('command')) {
    return <TerminalResult result={result} />;
  }

  return (
    <div className="glass-card" style={{ padding: '1rem' }}>
      <div className="mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.74rem', marginBottom: '0.45rem' }}>
        {result.tool_name}
      </div>
      <pre className="custom-scrollbar" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
        {JSON.stringify(result.output ?? result.error ?? result.input, null, 2)}
      </pre>
    </div>
  );
}

const fieldStyle = {
  width: '100%',
  padding: '0.8rem 0.9rem',
  borderRadius: '12px',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
};

function cryptoRandom() {
  return `session-${Math.random().toString(36).slice(2, 10)}`;
}
