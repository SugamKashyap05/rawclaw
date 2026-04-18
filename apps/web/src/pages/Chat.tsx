import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AgentProfile, ChatStreamChunk, ToolResult } from '@rawclaw/shared';
import { api } from '../lib/api';
import { AUTH_TOKEN_KEY } from '../lib/auth';
import { ChatSidebar } from '../components/ChatSidebar';
import { ChatSkeleton } from '../components/chat/ChatSkeleton';
import { ConfirmationBanner } from '../components/ConfirmationBanner';
import { FiEdit2, FiRotateCw, FiDatabase, FiGlobe, FiHome, FiCopy, FiFolder, FiFileText, FiX, FiPlus, FiMessageSquare } from 'react-icons/fi';
import { WebSearchResult } from '../components/chat/WebSearchResult';
import { BrowserResult } from '../components/chat/BrowserResult';
import { FileResult } from '../components/chat/FileResult';
import { CodeResult } from '../components/chat/CodeResult';
import { TerminalResult } from '../components/chat/TerminalResult';
import { ProvenanceTrace } from '../components/chat/ProvenanceTrace';
import { FileBrowserPanel } from '../components/chat/FileBrowserPanel';
import { ChatAttachment, DocumentSelection, DocumentEditRequest, DocumentEditAction } from '@rawclaw/shared';
import { DocumentCanvas } from '../components/chat/DocumentCanvas';
import { ErrorCard } from '../components/chat/ErrorCard';

/** Max file content size to inline into prompt (2MB). Larger files are stored but truncated in prompt. */
const MAX_ATTACHMENT_PROMPT_CHARS = 2 * 1024 * 1024;

/** Max raw file size allowed for upload to platform (20MB) */
const MAX_RAW_FILE_BYTES = 20 * 1024 * 1024;

/** Number of bytes to sniff for binary detection */
const BIN_SNIFF_LIMIT = 2048;

class ChatErrorBoundary extends React.Component<
  { children: React.ReactNode; onReset?: () => void },
  { hasError: boolean; error: string | null }
> {
  constructor(props: { children: React.ReactNode; onReset?: () => void }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  reset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };
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
          <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>Chat Interface Error</div>
          <div style={{ fontSize: '0.9rem', opacity: 0.8, marginBottom: '1rem' }}>{this.state.error}</div>
          <button
            className="btn-primary"
            onClick={this.reset}
            style={{ padding: '0.5rem 1.2rem', fontSize: '0.85rem' }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

interface Props {
  selectedModel: string;
  temperature: number;
  top_p: number;
}

interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  attachments?: ChatAttachment[];
  tool_calls?: any[];
  toolResults?: ToolResult[];
  provenanceTrace?: ChatStreamChunk['provenance_trace'];
  citations?: Array<{ url: string; title?: string }>;
  memoryRecall?: boolean;
  modelId?: string;
  isLocal?: boolean;
  createdAt?: string | Date;
  durationMs?: number;
  id?: string;
  error?: {
    type:
      | 'agent_unavailable'
      | 'agent_error'
      | 'provider_routing_failed'
      | 'model_unavailable'
      | 'mcp_unavailable'
      | 'tool_failed'
      | 'stream_interrupted'
      | 'auth_failure'
      | 'request_too_large'
      | 'context_limit_exceeded'
      | 'unsupported_file_type';
    message: string;
    details?: string;
  };
}

function normalizeErrorType(errorCode?: string): NonNullable<SessionMessage['error']>['type'] {
  switch (errorCode) {
    case 'Aborted':
    case 'stream_interrupted':
      return 'stream_interrupted';
    case 'provider_routing_failed':
      return 'provider_routing_failed';
    case 'tool_failed':
      return 'tool_failed';
    case 'auth_failure':
      return 'auth_failure';
    case 'model_unavailable':
      return 'model_unavailable';
    case 'mcp_unavailable':
      return 'mcp_unavailable';
    case 'agent_error':
      return 'agent_error';
    case 'agent_unavailable':
      return 'agent_unavailable';
    case 'request_too_large':
    case 'context_limit_exceeded':
      return 'context_limit_exceeded';
    case 'unsupported_file_type':
      return 'unsupported_file_type';
    default:
      return 'agent_unavailable';
  }
}

/** Safely process a file for attachment. Handles binary detection and size limits. */
async function processFileForAttachment(file: File): Promise<{ attachment?: ChatAttachment; error?: string }> {
  // 1. Hard check on raw file size
  if (file.size > MAX_RAW_FILE_BYTES) {
    return { error: `"${file.name}" is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max allowed is 20MB.` };
  }

  const isDoc = file.type === 'application/pdf' || file.type.startsWith('image/');
  
  if (isDoc) {
    // 2. Read binary file as Base64 for ingestion
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = (e.target?.result as string).split(',')[1];
        resolve({
          attachment: {
            filename: file.name,
            size: file.size,
            type: file.type,
            content: base64, // Sent as b64 to API
          }
        });
      };
      reader.onerror = () => resolve({ error: `Failed to read "${file.name}"` });
      reader.readAsDataURL(file);
    });
  }

  // 3. Binary detection via null-byte sniffing for text files
  try {
    const chunk = file.slice(0, BIN_SNIFF_LIMIT);
    const buffer = await chunk.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) {
       if (bytes[i] === 0) {
         return { error: `"${file.name}" appears to be a binary file. RawClaw currently only supports text, PDF, and image attachments.` };
       }
    }
  } catch (e) {
    return { error: `Could not read "${file.name}" for analysis.` };
  }

  // 4. Read content as text
  try {
    const text = await file.text();
    let content = text;
    let isTruncated = false;
    
    // We store the full content up to 20MB in the state (sent to API), 
    // but we mark it if it exceeds the prompt limit for later brain-side budgeting.
    if (content.length > MAX_ATTACHMENT_PROMPT_CHARS) {
      isTruncated = true;
    }

    return {
      attachment: {
        filename: file.name,
        size: file.size,
        type: file.type,
        content,
        isTruncated,
      }
    };
  } catch (e) {
    return { error: `Failed to read text from "${file.name}". It may be encoded incorrectly.` };
  }
}

export default function Chat({ selectedModel, temperature, top_p }: Props) {
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
  const isNewChatNavigating = useRef(false);

  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activeSelection, setActiveSelection] = useState<DocumentSelection | null>(null);


  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setSending(false);
    }
  };

  useEffect(() => {
    const handleGlobalEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && sending) {
        stopGeneration();
      }
    };
    window.addEventListener('keydown', handleGlobalEsc);
    return () => window.removeEventListener('keydown', handleGlobalEsc);
  }, [sending]);

  useEffect(() => {
    void loadAgents();
  }, []);

  useEffect(() => {
    // If we're currently sending or just navigated from a new chat, 
    // don't let the route change clear our optimistic state.
    if (sending || isNewChatNavigating.current) return;

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
      
      if (soft) {
        setMessages((current) => {
          // Rule: During active optimistic or newly-created session flow, 
          // do not let stale or empty history responses overwrite newer local state.
          // Reconcile only when the fetched history is at least as complete as the local thread state.
          if (current.length > 1 && serverMessages.length === 0) {
            console.warn('Suppressed empty history fetch over existing thread');
            return current;
          }

          // If we are currently sending/streaming, we favor local state until the stream is done,
          // unless the server has clearly "caught up" or gone ahead (e.g. multi-device sync)
          if (sending && serverMessages.length <= current.length) {
            return current;
          }

          if (serverMessages.length >= current.length) {
            // Reconcile IDs if possible to prevent flicker during "soft" reloads
            return serverMessages.map((sMsg, idx) => {
              const localMsg = current[idx];
              if (localMsg && localMsg.role === sMsg.role && !sMsg.id && localMsg.id) {
                return { ...sMsg, id: localMsg.id };
              }
              return sMsg;
            });
          }

          return current;
        });
      } else {
        setMessages(serverMessages);
      }
      loadedSessionId.current = id;
    } finally {
      if (!soft) setLoadingHistory(false);
    }
  };

  const consumeStream = async (reader: ReadableStreamDefaultReader<Uint8Array>) => {
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
                memoryRecall: data.metadata.memoryRecall,
                durationMs: data.metadata.durationMs,
              });
            } else if (data.type === 'error') {
              const err = data as any;
              patchAssistant({
                error: {
                  type: normalizeErrorType(err.error),
                  message: err.message || err.error || 'Generation error',
                  details: ''
                }
              });
            }
          } catch (e) {
            console.warn('Malformed SSE frame:', payload, e);
          }
        }
      }

      if (done) break;
    }
  };

  const send = async (explicitEditRequest?: DocumentEditRequest) => {
    if ((!input.trim() && !explicitEditRequest) || sending) return;
    const prompt = input.trim() || `[Edit] ${explicitEditRequest?.action}`;
    if (!explicitEditRequest) setInput('');
    setSending(true);

    if (!routeSessionId) {
      isNewChatNavigating.current = true;
      navigate(`/chat/${sessionId}`, { replace: true });
      loadedSessionId.current = sessionId;
      
      // Reset the skip ref after a short delay to allow for DOM/Route propagation
      setTimeout(() => {
        isNewChatNavigating.current = false;
      }, 500);
    }

    const currentAttachments = [...attachments];
    if (!explicitEditRequest) setAttachments([]);

    setMessages((current) => [
      ...current,
      { role: 'user', content: prompt, attachments: currentAttachments.length > 0 ? currentAttachments : undefined },
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
          messages: [{ role: 'user', content: prompt, attachments: currentAttachments.length > 0 ? currentAttachments : undefined }],
          model: isComplexity ? undefined : selectedModel,
          complexity: isComplexity ? selectedModel.split(':')[1] : undefined,
          temperature,
          top_p,
          stream: true,
          agent_id: selectedAgentId || undefined,
          selection: !explicitEditRequest ? (activeSelection || undefined) : undefined,
          editRequest: explicitEditRequest,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || `Chat request failed with status ${response.status}`);
      }

      if (!response.body) throw new Error('No response body from chat stream.');
      await consumeStream(response.body.getReader());
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
        const lowerMsg = message.toLowerCase();
        let errorType: NonNullable<SessionMessage['error']>['type'] = 'agent_unavailable';
        let errorLabel = 'Connection failed';
        if (lowerMsg.includes('entity too large') || lowerMsg.includes('413') || lowerMsg.includes('payload too large')) {
          errorType = 'request_too_large';
          errorLabel = 'Request too large';
        } else if (lowerMsg.includes('provider') || lowerMsg.includes('routing')) {
          errorType = 'provider_routing_failed';
        }
        patchAssistant({
          error: {
            type: errorType,
            message: errorLabel,
            details: message
          }
        });
      }
    } finally {
      setSending(false);
      abortControllerRef.current = null;
      setActiveSelection(null);
      // Immediate deterministic sync once persistence is confirmed by stream end
      if (sessionId) {
        void loadHistory(sessionId, true);
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
    if (sending) return;
    setSending(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Truncate local state to the message being edited and replace its content
    setMessages((current) => {
      const index = current.findIndex((m) => m.id === messageId);
      if (index === -1) return current;
      const truncated = current.slice(0, index + 1);
      truncated[index] = { ...truncated[index], content };
      return [...truncated, { role: 'assistant', content: '', toolResults: [] }];
    });

    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const isComplexity = selectedModel.startsWith('complexity:');
      const response = await fetch('/api/chat/edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sessionId,
          messageId,
          content,
          model: isComplexity ? undefined : selectedModel,
          complexity: isComplexity ? selectedModel.split(':')[1] : undefined,
          temperature,
          top_p,
          agentId: selectedAgentId || undefined,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error(await response.text());
      if (response.body) await consumeStream(response.body.getReader());
    } catch (e: any) {
      console.error('Edit failed:', e);
      patchAssistant({
        error: {
          type: e.name === 'AbortError'
            ? 'stream_interrupted'
            : normalizeErrorType((e as any).error),
          message: e.message || 'Edit failed',
        }
      });
    } finally {
      setSending(false);
      abortControllerRef.current = null;
      if (sessionId) void loadHistory(sessionId, true);
    }
  };

  const handleRegenerate = async (messageId: string) => {
    if (sending) return;
    setSending(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Truncate local state to the assistant message being regenerated (which follows a user message)
    // Actually, messageId passed here is for the assistant response.
    setMessages((current) => {
      const index = current.findIndex((m) => m.id === messageId);
      if (index === -1) return current;
      const truncated = current.slice(0, index);
      return [...truncated, { role: 'assistant', content: '', toolResults: [] }];
    });

    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const isComplexity = selectedModel.startsWith('complexity:');
      const response = await fetch('/api/chat/regenerate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sessionId,
          messageId,
          model: isComplexity ? undefined : selectedModel,
          complexity: isComplexity ? selectedModel.split(':')[1] : undefined,
          temperature,
          top_p,
          agentId: selectedAgentId || undefined,
        }),
        signal: abortController.signal,
      });

      if (!response.ok) throw new Error(await response.text());
      if (response.body) await consumeStream(response.body.getReader());
    } catch (e: any) {
      console.error('Regenerate failed:', e);
      patchAssistant({
        error: {
          type: e.name === 'AbortError'
            ? 'stream_interrupted'
            : normalizeErrorType((e as any).error),
          message: e.message || 'Regeneration failed',
        }
      });
    } finally {
      setSending(false);
      abortControllerRef.current = null;
      if (sessionId) void loadHistory(sessionId, true);
    }
  };

  return (
    <ChatErrorBoundary onReset={() => {
      // Re-initialize state that might have caused the error
      void loadAgents();
      if (routeSessionId) void loadHistory(routeSessionId);
    }}>
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 220px)', gap: '1rem', position: 'relative' }}>
      <ChatSidebar />

      {/* Main Chat Area */}
      <div 
        className="glass-card" 
        style={{ 
          flex: 1, 
          display: 'flex', 
          flexDirection: 'column', 
          minWidth: 0,
          position: 'relative',
          border: isDragging ? '2px dashed var(--neon-cyan)' : undefined,
          background: isDragging ? 'rgba(0, 240, 255, 0.05)' : undefined,
        }}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        onDrop={async (e) => {
          e.preventDefault();
          setIsDragging(false);
          setAttachmentError(null);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files = Array.from(e.dataTransfer.files);
            for (const file of files) {
              const result = await processFileForAttachment(file);
              if (result.error) {
                setAttachmentError(result.error);
              } else if (result.attachment) {
                setAttachments(prev => [...prev, result.attachment!]);
              }
            }
          }
        }}
      >
        <div style={{ paddingBottom: '1rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.25rem' }}>
              <h1 style={{ fontSize: '1.6rem', margin: 0 }}>Chat</h1>
              {routeSessionId && (
                <span className="mono" style={{ 
                  fontSize: '0.65rem', 
                  color: 'var(--text-muted)', 
                  padding: '2px 8px', 
                  borderRadius: '10px', 
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid var(--border-glass)'
                }}>
                  {routeSessionId}
                </span>
              )}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
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
            <button 
              className="btn-secondary" 
              onClick={() => setShowWorkspace(!showWorkspace)}
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: showWorkspace ? 'rgba(0, 240, 255, 0.1)' : undefined }}
            >
              <FiFolder /> Workspace
            </button>
          </div>
        </div>

        <ConfirmationBanner sessionId={sessionId} />

        <div ref={scrollRef} className="custom-scrollbar" style={{ flex: 1, overflow: 'auto', display: 'grid', gap: '1rem', paddingRight: '0.25rem' }}>
          {loadingHistory && messages.length === 0 ? <ChatSkeleton /> : null}

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
                onViewDocument={setActiveDocumentId}
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
          
          {attachments.length > 0 && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {attachments.map((att, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '6px',
                  background: 'rgba(0, 240, 255, 0.1)',
                  border: '1px solid rgba(0, 240, 255, 0.2)',
                  padding: '4px 8px',
                  borderRadius: '16px',
                  fontSize: '0.8rem'
                }}>
                  <FiFileText size={12} style={{ color: 'var(--neon-cyan)' }} />
                  <span style={{ maxWidth: '120px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {att.filename}
                  </span>
                  <button 
                    onClick={() => setAttachments(prev => prev.filter((_, idx) => idx !== i))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: 0 }}
                  >
                    <FiX size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {attachmentError && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '6px 12px', marginBottom: '8px',
              background: 'rgba(255, 77, 77, 0.1)',
              border: '1px solid rgba(255, 77, 77, 0.3)',
              borderRadius: '8px',
              color: 'var(--error)',
              fontSize: '0.85rem'
            }}>
              <span>{attachmentError}</span>
              <button 
                onClick={() => setAttachmentError(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error)', display: 'flex', padding: 0 }}
              >
                <FiX size={14} />
              </button>
            </div>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', position: 'relative' }}>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: '0.7rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', border: '1px solid var(--border-glass)' }} title="Attach local file">
              <FiPlus size={20} />
              <input 
                type="file" 
                multiple
                style={{ display: 'none' }}
                onChange={async (e) => {
                  setAttachmentError(null);
                  if (e.target.files) {
                    const files = Array.from(e.target.files);
                    for (const file of files) {
                      const result = await processFileForAttachment(file);
                      if (result.error) {
                        setAttachmentError(result.error);
                      } else if (result.attachment) {
                        setAttachments(prev => [...prev, result.attachment!]);
                      }
                    }
                  }
                  e.target.value = ''; // reset so same file can trigger again
                }} 
              />
            </label>
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

        {showWorkspace && (
          <FileBrowserPanel 
            onClose={() => setShowWorkspace(false)} 
            onAttach={(att) => setAttachments(prev => [...prev, att])}
          />
        )}

        {activeDocumentId && (
          <DocumentCanvas 
            documentId={activeDocumentId} 
            onClose={() => setActiveDocumentId(null)}
            onSelect={(selection) => {
              setActiveSelection({ ...selection, documentId: activeDocumentId! });
            }}
            activeSelection={activeSelection}
            editSuggestion={
              (() => {
                const assistantMsgs = messages.filter(m => m.role === 'assistant');
                if (!assistantMsgs.length) return null;
                const lastMsg = assistantMsgs[assistantMsgs.length - 1];
                const match = lastMsg.content.match(/<edit_suggestion>([\s\S]*?)<\/edit_suggestion>/);
                return match ? match[1].trim() : null;
              })()
            }
            onAcceptEdit={() => {
              // In a real app we'd save this to the backend
              // For now we just dismiss the selection
              setActiveSelection(null);
            }}
            onRejectEdit={() => setActiveSelection(null)}
          />
        )}
      </div>

    {activeSelection && (
      <div 
        style={{
          position: 'fixed',
          bottom: '120px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'rgba(10, 15, 25, 0.95)',
          backdropFilter: 'blur(10px)',
          border: '1px solid var(--neon-cyan)',
          borderRadius: '12px',
          padding: '12px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          zIndex: 1000,
          boxShadow: '0 8px 32px rgba(0, 240, 255, 0.15)',
          minWidth: '320px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <FiMessageSquare style={{ color: 'var(--neon-cyan)' }} />
            <span style={{ fontSize: '0.85rem', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--text-primary)' }}>
              Selected: "{activeSelection.text}"
            </span>
          </div>
          <button 
            onClick={() => setActiveSelection(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
          >
            <FiX size={16} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
          {['rewrite', 'improve', 'shorten', 'formalize'].map((action) => (
            <button
              key={action}
              onClick={() => {
                const request: DocumentEditRequest = {
                  documentId: activeSelection.documentId,
                  selectedText: activeSelection.text,
                  contextBefore: activeSelection.contextBefore,
                  contextAfter: activeSelection.contextAfter,
                  action: action as DocumentEditAction,
                };
                void send(request);
              }}
              style={{
                background: 'rgba(0, 240, 255, 0.1)',
                border: '1px solid rgba(0, 240, 255, 0.3)',
                color: 'var(--neon-cyan)',
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'capitalize'
              }}
            >
              {action}
            </button>
          ))}
        </div>
      </div>
    )}
    </ChatErrorBoundary>
  );
}

function getErrorMessage(type: string): string {
  switch (type) {
    case 'agent_unavailable':
      return 'Agent Service Unavailable';
    case 'agent_error':
      return 'Agent Error';
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
    case 'request_too_large':
      return 'Attachment Too Large';
    case 'context_limit_exceeded':
      return 'Context Limit Exceeded';
    case 'unsupported_file_type':
      return 'Unsupported File Type';
    default:
      return 'Error';
    }
}

function MessageCard({ 
  message, 
  onEdit, 
  onRegenerate,
  onViewDocument
}: { 
  message: SessionMessage; 
  onEdit: (id: string, content: string) => void;
  onRegenerate: (id: string) => void;
  onViewDocument: (id: string) => void;
}) {
  const isUser = message.role === 'user';
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editContent, setEditContent] = useState(message.content);

  const formatTime = (date?: string | Date) => {
    if (!date) return '';
    const d = new Date(date);
    const now = new Date();
    
    // Normalize to start of day for comparison
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const msgTime = d.getTime();

    const timeStr = new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
    }).format(d);

    if (msgTime >= startOfToday) {
      return `Today at ${timeStr}`;
    } else if (msgTime >= startOfYesterday) {
      return `Yesterday at ${timeStr}`;
    } else {
      const dateStr = new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: now.getFullYear() === d.getFullYear() ? undefined : 'numeric'
      }).format(d);
      return `${dateStr} at ${timeStr}`;
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

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
          <div className="mono" style={{ fontSize: '0.65rem', color: isUser ? 'var(--neon-cyan)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {isUser ? 'USER' : 'RAWCLAW'}
            <span style={{ opacity: 0.5, fontWeight: 400 }}>{formatTime(message.createdAt)}</span>
          </div>
          
          {!isUser && (message.modelId || message.memoryRecall) && (
            <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
              {message.memoryRecall && (
                <span style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.65rem', 
                  padding: '2px 8px', 
                  borderRadius: '10px', 
                  background: 'rgba(0,255,150,0.08)', 
                  color: '#00ff96', 
                  border: '1px solid rgba(0,255,150,0.2)',
                  fontWeight: 600,
                  letterSpacing: '0.02em'
                }}>
                  <FiDatabase size={10} />
                  RECALLED
                </span>
              )}
              {message.modelId && (
                <span className="mono" style={{ 
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.65rem', 
                  color: 'var(--text-muted)', 
                  background: 'rgba(255,255,255,0.05)', 
                  padding: '2px 8px', 
                  borderRadius: '10px',
                  border: '1px solid var(--border-glass)'
                }}>
                  {message.isLocal ? <FiHome size={10} /> : <FiGlobe size={10} />}
                  {message.modelId.split('/').pop()}
                  {message.durationMs && (
                    <span style={{ marginLeft: '0.3rem', opacity: 0.6, borderLeft: '1px solid currentColor', paddingLeft: '0.4rem' }}>
                      {(message.durationMs / 1000).toFixed(1)}s
                    </span>
                  )}
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
        ) : message.content ? (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
            {message.content.includes('<edit_suggestion>') ? (
              <>
                {message.content.replace(/<edit_suggestion>[\s\S]*?<\/edit_suggestion>/g, '')}
                <div style={{ 
                  marginTop: '0.5rem', 
                  padding: '8px 12px', 
                  background: 'rgba(0, 255, 150, 0.1)', 
                  border: '1px solid rgba(0, 255, 150, 0.3)',
                  borderRadius: '6px',
                  color: '#00ff96',
                  fontSize: '0.8rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px'
                }}>
                  <FiEdit2 size={12} />
                  Document Edit Suggested — Preview above
                </div>
              </>
            ) : (
              message.content
            )}
          </div>
        ) : !message.error ? (
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, opacity: 0.5 }}>...</div>
        ) : null}

        {!editing && message.attachments && message.attachments.length > 0 && (
          <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {message.attachments.map((att, idx) => (
                <div key={idx} style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  background: att.extractionFailed ? 'rgba(255, 77, 77, 0.05)' : 'rgba(255, 255, 255, 0.05)',
                  border: att.extractionFailed ? '1px solid rgba(255, 77, 77, 0.3)' : '1px solid var(--border-glass)',
                  padding: '4px 8px',
                  borderRadius: '8px',
                  fontSize: '0.75rem',
                  color: att.extractionFailed ? 'var(--error)' : 'var(--text-secondary)'
                }}>
                  <FiFileText size={12} />
                  <span>{att.filename}</span>
                  {att.documentId && (
                    <button 
                      onClick={() => onViewDocument(att.documentId!)}
                      style={{
                        background: 'var(--neon-cyan)',
                        color: 'var(--bg-deep)',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '2px 6px',
                        fontSize: '0.65rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        marginLeft: '0.4rem'
                      }}
                    >
                      VIEW
                    </button>
                  )}
                  {att.isTruncated && (
                    <span style={{ 
                      color: '#ff9d00', 
                      background: 'rgba(255,157,0,0.1)', 
                      padding: '1px 5px', 
                      borderRadius: '4px', 
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      border: '1px solid rgba(255,157,0,0.3)'
                    }}>
                      TRUNCATED
                    </span>
                  )}
                  {att.extractionFailed && (
                    <span style={{ 
                      color: 'var(--error)', 
                      background: 'rgba(255,77,77,0.1)', 
                      padding: '1px 5px', 
                      borderRadius: '4px', 
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      border: '1px solid rgba(255,77,77,0.3)'
                    }}>
                      FAILED
                    </span>
                  )}
                  {att.size && <span style={{ opacity: 0.5 }}>({(att.size / 1024).toFixed(1)} KB)</span>}
                </div>
              ))}
            </div>
            {message.attachments?.some(a => a.extractionError) && (
              <div style={{ fontSize: '0.75rem', color: 'var(--error)', opacity: 0.8, paddingLeft: '0.5rem' }}>
                Note: Some attachments could not be processed fully. Raw content was used if available.
              </div>
            )}
          </div>
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
                title="Edit message"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <FiEdit2 size={12} /> <span style={{ fontSize: '0.7rem' }}>Edit</span>
              </button>
            )}
            {!isUser && message.id && (
              <button 
                onClick={() => onRegenerate(message.id!)}
                title="Regenerate response"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
              >
                <FiRotateCw size={12} /> <span style={{ fontSize: '0.7rem' }}>Regenerate</span>
              </button>
            )}
            {!isUser && message.content && (
              <button 
                onClick={handleCopy}
                title="Copy message"
                style={{ 
                  background: 'none', 
                  border: 'none', 
                  cursor: 'pointer', 
                  color: copied ? 'var(--neon-cyan)' : 'inherit', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.3rem',
                  transition: 'color 0.2s'
                }}
              >
                <FiCopy size={12} /> 
                <span style={{ fontSize: '0.7rem' }}>{copied ? 'Copied!' : 'Copy'}</span>
              </button>
            )}
          </div>
        )}
      </div>

      {message.error ? (
        <ErrorCard 
          type={message.error.type}
          message={getErrorMessage(message.error.type)}
          details={message.error.message + (message.error.details ? `\n${message.error.details}` : '')}
          onRetry={!isUser && message.id ? () => onRegenerate(message.id!) : undefined}
        />
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
