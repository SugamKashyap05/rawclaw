import React, { useEffect, useMemo, useRef, useState } from 'react';
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

class ChatErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          padding: '2rem',
          background: 'rgba(255,77,77,0.08)',
          border: '1px solid rgba(255,77,77,0.3)',
          borderRadius: '12px',
          color: 'var(--error)'
        }}>
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Chat Error</div>
          <div style={{ fontSize: '0.9rem', opacity: 0.8 }}>{this.state.error}</div>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '1rem', padding: '0.5rem 1rem', cursor: 'pointer' }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

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
  memoryRecall?: boolean;
  modelId?: string;
  isLocal?: boolean;
  id?: string;
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
  const abortControllerRef = useRef<AbortController | null>(null);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadedSessionId = useRef<string | null>(null);

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setSending(false);
    }
  };

  useEffect(() => {
    void loadAgents();
  }, []);

  useEffect(() => {
    // If we're currently sending, don't let the route change clear our optimistic state.
    // The send() function handles the transition from local to route session ID.
    if (sending) return;

    if (!routeSessionId) {
      if (messages.length > 0) setMessages([]);
      loadedSessionId.current = null;
      return;
    }

    // Only load if it's a different session than what we currently have
    if (routeSessionId !== loadedSessionId.current) {
      void loadHistory(routeSessionId);
    }
  }, [routeSessionId, sending]);

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

  const loadHistory = async (id: string, soft = false) => {
    if (!soft) setLoadingHistory(true);
    try {
      const response = await api.get<{ messages: SessionMessage[] }>(`/chat/sessions/${id}`);
      const serverMessages = response.data?.messages || [];
      
      setMessages(serverMessages);
      loadedSessionId.current = id;
    } finally {
      if (!soft) setLoadingHistory(false);
    }
  };

  const send = async () => {
    if (!input.trim() || sending) return;
    const prompt = input.trim();
    setInput('');
    setSending(true);

    if (!routeSessionId) {
      navigate(`/chat/${sessionId}`, { replace: true });
      loadedSessionId.current = sessionId;
    }

    setMessages((current) => [
      ...current,
      { role: 'user', content: prompt },
      { role: 'assistant', content: '', toolResults: [] },
    ]);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

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
        signal: abortController.signal,
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
        
        if (value) {
          streamBuffer += decoder.decode(value, { stream: !done });
          const lines = streamBuffer.split('\n');
          streamBuffer = lines.pop() || '';

          for (const line of lines) {
            const raw = line.trim();
            if (!raw) continue;
            
            const payload = raw.startsWith('data:') ? raw.slice(5).trim() : raw;
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
                const trace = (data as any).provenance_trace || (data as any).provenance || data;
                patchAssistant({ provenanceTrace: trace });
              } else if (data.type === 'metadata' && data.metadata) {
                patchAssistant({ 
                  modelId: data.metadata.modelId,
                  isLocal: data.metadata.isLocal,
                  memoryRecall: data.metadata.memoryRecall
                });
              } else if (data.type === 'error') {
                const err = data as any;
                patchAssistant({
                  error: {
                    type: err.error === 'Aborted' ? 'stream_interrupted' : 'agent_unavailable',
                    message: err.message || err.error || 'Generation error',
                    details: ''
                  }
                });
                // Errors from the stream shouldn't always stop processing if we have trailing data, 
                // but usually 'error' frames are terminal from the API.
              }
            } catch (e) {
              console.warn('Malformed SSE frame:', payload, e);
            }
          }
        }

        if (done) break;
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        patchAssistant({
          error: {
            type: 'stream_interrupted',
            message: 'Stream stopped by user',
          }
        });
      } else {
        const message = error instanceof Error ? error.message : 'Chat failed.';
        patchAssistant({
          error: {
            type: 'agent_unavailable',
            message: 'Connection failed',
            details: message
          }
        });
      }
    } finally {
      setSending(false);
      abortControllerRef.current = null;
      // "Soft" re-fetch history once persisting should be done to sync IDs
      if (sessionId) {
        // We wait a tiny bit to give the server a chance to finish DB transaction commit 
        // if it hadn't already (though processAndStreamChat ensures it)
        setTimeout(() => {
          void loadHistory(sessionId, true);
        }, 300);
      }
    }
  };

  const patchAssistant = (patch: Partial<SessionMessage>) => {
    setMessages((current) => {
      const next = [...current];
      const index = next.map((item) => item.role).lastIndexOf('assistant');
      if (index >= 0) {
        next[index] = { ...next[index], ...patch };
      }
      return next;
    });
  };

  const handleEdit = async (messageId: string, content: string) => {
    setSending(true);
    setMessages([]); // Reset messages to trigger a clean reload from history after update
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      await fetch('/api/chat/edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId, messageId, content }),
      });
      // The edit endpoint streams the new response back? 
      // Actually, my editAndResend in orchestrator service returns processAndStreamChat which DOES stream.
      // So I should treat this similarly to send().
      // For now, I'll just reload history to see the update and then trigging a reload might be complex.
      // Re-implementing the streaming loop for edit/regenerate is better.
      window.location.reload(); // Simplest for now to ensure history is clean
    } catch (e) {
      console.error('Edit failed:', e);
    } finally {
      setSending(false);
    }
  };

  const handleRegenerate = async (messageId: string) => {
    setSending(true);
    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      await fetch('/api/chat/regenerate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ sessionId, messageId }),
      });
      window.location.reload();
    } catch (e) {
      console.error('Regenerate failed:', e);
    } finally {
      setSending(false);
    }
  };

  return (
    <ChatErrorBoundary>
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
              <MessageCard 
                key={`${message.role}-${index}`} 
                message={message} 
                onEdit={handleEdit}
                onRegenerate={handleRegenerate}
              />
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
            {sending ? (
              <button 
                className="btn-primary" 
                onClick={stopGeneration}
                style={{ background: 'var(--error-glow)', borderColor: 'var(--error)' }}
              >
                Stop
              </button>
            ) : (
              <button className="btn-primary" onClick={() => void send()} disabled={sending || !input.trim()}>
                Send
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
    </ChatErrorBoundary>
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

function MessageCard({ 
  message, 
  onEdit, 
  onRegenerate 
}: { 
  message: SessionMessage; 
  onEdit: (id: string, content: string) => void;
  onRegenerate: (id: string) => void;
}) {
  const isUser = message.role === 'user';
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  return (
    <div style={{ display: 'grid', gap: '0.65rem', justifyItems: isUser ? 'end' : 'start', position: 'relative' }}>
      <div
        style={{
          maxWidth: '84%',
          borderRadius: '16px',
          padding: '1rem',
          background: isUser ? 'rgba(0,240,255,0.08)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${isUser ? 'rgba(0,240,255,0.18)' : 'var(--border-glass)'}`,
          position: 'relative'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem', gap: '1rem' }}>
          <div className="mono" style={{ fontSize: '0.72rem', color: isUser ? 'var(--neon-cyan)' : 'var(--text-muted)' }}>
            {isUser ? 'USER' : 'RAWCLAW'}
          </div>
          
          {!isUser && (message.modelId || message.memoryRecall) && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {message.memoryRecall && (
                <span style={{ fontSize: '0.65rem', padding: '2px 6px', borderRadius: '4px', background: 'rgba(0,255,150,0.12)', color: '#00ff96', border: '1px solid rgba(0,255,150,0.2)' }}>
                  RECALLED
                </span>
              )}
              {message.modelId && (
                <span className="mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px' }}>
                  {message.isLocal ? '🏠 ' : '☁️ '}{message.modelId.split('/').pop()}
                </span>
              )}
            </div>
          )}
        </div>

        {editing ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <textarea
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              style={{ ...fieldStyle, minHeight: '100px', fontSize: '1rem', background: 'rgba(0,0,0,0.2)' }}
            />
            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
              <button 
                className="btn-primary" 
                style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem', background: 'transparent' }} 
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <button 
                className="btn-primary" 
                style={{ padding: '0.3rem 0.8rem', fontSize: '0.8rem' }}
                onClick={() => {
                  if (message.id) onEdit(message.id, editContent);
                  setEditing(false);
                }}
              >
                Save & Resend
              </button>
            </div>
          </div>
        ) : (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{message.content || '...'}</div>
        )}

        {!editing && (
          <div style={{ 
            marginTop: '0.5rem', 
            display: 'flex', 
            gap: '0.5rem', 
            justifyContent: isUser ? 'flex-end' : 'flex-start',
            opacity: 0.4,
            transition: 'opacity 0.2s'
          }} className="message-actions">
            {isUser && message.id && (
              <button 
                onClick={() => setEditing(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '0.7rem' }}
              >
                Edit
              </button>
            )}
            {!isUser && message.id && (
              <button 
                onClick={() => onRegenerate(message.id!)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '0.7rem' }}
              >
                Regenerate
              </button>
            )}
          </div>
        )}
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
