import { useState, useRef, useEffect } from 'react';
import { ChatStreamChunk, ToolResult } from '@rawclaw/shared';
import { ConfirmationBanner } from '../components/ConfirmationBanner';
import { FiChevronDown, FiChevronUp, FiClock, FiBox, FiTool } from 'react-icons/fi';

interface Props {
  selectedModel: string;
}

interface MessageWithTools {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  name?: string;
  toolResults?: ToolResult[];
  provenanceTrace?: any;
}

export default function Chat({ selectedModel }: Props) {
  const [messages, setMessages] = useState<MessageWithTools[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId] = useState(() => Math.random().toString(36).substring(7));

  const historyRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    historyRef.current?.scrollTo({
      top: historyRef.current.scrollHeight,
      behavior: 'smooth'
    });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage: MessageWithTools = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsStreaming(true);

    const assistantMessage: MessageWithTools = {
      role: 'assistant',
      content: '',
      toolResults: [],
    };
    setMessages(prev => [...prev, assistantMessage]);

    try {
      const isComplexity = selectedModel.startsWith('complexity:');
      const payload = {
        session_id: sessionId,
        messages: [{ role: 'user', content: input }],
        model: isComplexity ? undefined : selectedModel,
        complexity: isComplexity ? selectedModel.split(':')[1] : undefined,
        stream: true
      };

      const response = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedContent = '';
      const toolResults: ToolResult[] = [];
      let provenanceTrace: any = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.trim()) continue;

          // Handle SSE format
          const jsonStr = line.startsWith('data: ') ? line.replace('data: ', '') : line;
          if (!jsonStr) continue;

          try {
            const data: ChatStreamChunk = JSON.parse(jsonStr);

            if (data.type === 'content' && data.content) {
              accumulatedContent += data.content;
              setMessages(prev => {
                const newMessages = [...prev];
                const last = newMessages[newMessages.length - 1];
                if (last && last.role === 'assistant') {
                  last.content = accumulatedContent;
                }
                return newMessages;
              });
            } else if (data.type === 'tool_result' && data.tool_result) {
              toolResults.push(data.tool_result);
              setMessages(prev => {
                const newMessages = [...prev];
                const last = newMessages[newMessages.length - 1];
                if (last && last.role === 'assistant') {
                  last.toolResults = [...toolResults];
                }
                return newMessages;
              });
            } else if (data.type === 'provenance') {
              provenanceTrace = (data as any).provenance_trace;
              setMessages(prev => {
                const newMessages = [...prev];
                const last = newMessages[newMessages.length - 1];
                if (last && last.role === 'assistant') {
                  last.provenanceTrace = provenanceTrace;
                }
                return newMessages;
              });
            } else if (data.type === 'done') {
              setIsStreaming(false);
            } else if (data.type === 'error') {
              setMessages(prev => {
                const newMessages = [...prev];
                const last = newMessages[newMessages.length - 1];
                if (last && last.role === 'assistant') {
                  last.content = `Error: ${data.error || 'Unknown error'}`;
                }
                return newMessages;
              });
              setIsStreaming(false);
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } catch (err) {
      console.error('Chat error', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Error: Failed to connect to agent.',
      }]);
      setIsStreaming(false);
    }
  };

  return (
    <>
      <div className="chat-container">
        <ConfirmationBanner sessionId={sessionId} />
        <div className="chat-history" ref={historyRef}>
          {messages.length === 0 && (
            <div className="empty-state">
              <h2>Welcome to RawClaw</h2>
              <p>Your local-first AI companion. How can I help you today?</p>
            </div>
          )}
          {messages.map((msg, idx) => (
            <MessageBlock key={idx} message={msg} isStreaming={isStreaming && idx === messages.length - 1} />
          ))}
        </div>

        <div className="chat-input-area">
          <textarea
            className="chat-input"
            placeholder="Type your message... (Shift + Enter for new line)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            disabled={isStreaming}
            rows={1}
          />
          <button
            className="chat-send"
            onClick={handleSend}
            disabled={isStreaming || !input.trim()}
          >
            {isStreaming ? '...' : 'Send'}
          </button>
        </div>
      </div>

      <style>{`
        .chat-container {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 80px);
          max-width: 900px;
          margin: 0 auto;
          padding: 1rem;
        }
        .chat-history {
          flex: 1;
          overflow-y: auto;
          padding: 1rem;
          background: var(--panel-bg);
          border-radius: 16px;
          border: 1px solid var(--glass-border);
          margin-bottom: 1rem;
        }
        .empty-state {
          text-align: center;
          padding: 4rem 2rem;
          color: var(--text-muted);
        }
        .empty-state h2 {
          margin-bottom: 0.5rem;
        }
        .msg-wrapper {
          margin-bottom: 1.5rem;
        }
        .msg-header {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-bottom: 0.25rem;
        }
        .msg-user .msg-header { text-align: right; }
        .msg-user .msg-content {
          background: linear-gradient(135deg, var(--accent-cyan), #0088aa);
          color: var(--bg-dark);
          margin-left: auto;
        }
        .msg-assistant .msg-content {
          background: rgba(255, 255, 255, 0.05);
        }
        .msg-content {
          max-width: 80%;
          padding: 1rem;
          border-radius: 12px;
          white-space: pre-wrap;
          word-break: break-word;
        }
        .msg-user .msg-content { margin-left: auto; }
        .msg-assistant .msg-content { margin-right: auto; }

        .tool-results {
          margin-top: 1rem;
        }
        .tool-result-card {
          background: rgba(0, 0, 0, 0.2);
          border-radius: 8px;
          margin-bottom: 0.5rem;
          overflow: hidden;
        }
        .tool-result-card.error {
          border-left: 3px solid var(--error-red);
        }
        .tool-result-card.success {
          border-left: 3px solid var(--success-green);
        }
        .tool-result-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 0.75rem 1rem;
          cursor: pointer;
        }
        .tool-result-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-weight: 500;
        }
        .tool-duration {
          font-size: 0.75rem;
          color: var(--text-muted);
          font-weight: normal;
        }
        .tool-result-status {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .status-success { color: var(--success-green); font-size: 0.75rem; }
        .status-error { color: var(--error-red); font-size: 0.75rem; }
        .sandbox-badge {
          color: var(--accent-cyan);
          font-size: 0.75rem;
        }
        .tool-result-body {
          padding: 1rem;
          background: rgba(0, 0, 0, 0.3);
        }
        .tool-result-section {
          margin-bottom: 0.75rem;
        }
        .tool-result-section:last-child { margin-bottom: 0; }
        .tool-result-label {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-bottom: 0.25rem;
        }
        .tool-result-body pre {
          margin: 0;
          font-size: 0.75rem;
          overflow-x: auto;
        }

        .provenance-section {
          margin-top: 0.75rem;
        }
        .provenance-toggle {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          background: transparent;
          border: none;
          color: var(--text-muted);
          cursor: pointer;
          font-size: 0.75rem;
          padding: 0.5rem;
        }
        .provenance-toggle:hover {
          color: var(--accent-cyan);
        }

        .provenance-timeline {
          background: rgba(0, 0, 0, 0.2);
          padding: 1rem;
          border-radius: 8px;
          margin-top: 0.5rem;
        }
        .trace-header {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin-bottom: 0.75rem;
        }
        .trace-header code {
          color: var(--accent-cyan);
        }
        .trace-steps {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }
        .trace-step {
          display: flex;
          gap: 0.75rem;
        }
        .step-marker {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--accent-cyan);
          margin-top: 0.35rem;
          flex-shrink: 0;
        }
        .step-tool_call .step-marker { background: var(--warning-amber); }
        .step-tool_result .step-marker { background: var(--success-green); }
        .step-error .step-marker { background: var(--error-red); }
        .step-content {
          flex: 1;
          font-size: 0.75rem;
        }
        .step-header {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 0.25rem;
        }
        .step-type {
          color: var(--text-muted);
          text-transform: uppercase;
          font-size: 0.625rem;
        }
        .step-tool {
          color: var(--accent-cyan);
        }
        .step-time {
          color: var(--text-muted);
          margin-left: auto;
        }
        .step-summary {
          color: var(--text-muted);
          font-size: 0.625rem;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .chat-input-area {
          display: flex;
          gap: 1rem;
          align-items: flex-end;
        }
        .chat-input {
          flex: 1;
          background: var(--panel-bg);
          border: 1px solid var(--glass-border);
          border-radius: 12px;
          padding: 1rem;
          color: var(--text-primary);
          font-size: 1rem;
          resize: none;
          min-height: 48px;
          max-height: 200px;
        }
        .chat-input:focus {
          outline: none;
          border-color: var(--accent-cyan);
        }
        .chat-send {
          background: var(--accent-cyan);
          color: var(--bg-dark);
          border: none;
          border-radius: 12px;
          padding: 1rem 2rem;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s;
        }
        .chat-send:hover:not(:disabled) {
          background: var(--accent-cyan-dark);
        }
        .chat-send:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </>
  );
}

function MessageBlock({ message, isStreaming }: { message: MessageWithTools; isStreaming: boolean }) {
  const [showTrace, setShowTrace] = useState(false);

  return (
    <div className={`msg-wrapper msg-${message.role}`}>
      <div className="msg-header">
        {message.role === 'user' ? 'You' : 'RawClaw'}
      </div>
      <div className="msg-content">
        {message.content || (isStreaming ? '...' : '')}
      </div>

      {message.toolResults && message.toolResults.length > 0 && (
        <div className="tool-results">
          {message.toolResults.map((result, idx) => (
            <ToolResultCard key={idx} result={result} />
          ))}
        </div>
      )}

      {message.provenanceTrace && (
        <div className="provenance-section">
          <button
            className="provenance-toggle"
            onClick={() => setShowTrace(!showTrace)}
          >
            <FiClock /> View Trace
            {showTrace ? <FiChevronUp /> : <FiChevronDown />}
          </button>
          {showTrace && (
            <ProvenanceTimeline trace={message.provenanceTrace} />
          )}
        </div>
      )}
    </div>
  );
}

function ToolResultCard({ result }: { result: ToolResult }) {
  const [expanded, setExpanded] = useState(false);
  const hasError = !!result.error;

  return (
    <div className={`tool-result-card ${hasError ? 'error' : 'success'}`}>
      <div
        className="tool-result-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="tool-result-title">
          <FiTool />
          <span>{result.tool_name}</span>
          <span className="tool-duration">{result.duration_ms.toFixed(0)}ms</span>
        </div>
        <div className="tool-result-status">
          {hasError ? (
            <span className="status-error">Error</span>
          ) : (
            <span className="status-success">Success</span>
          )}
          {result.sandboxed && (
            <span className="sandbox-badge"><FiBox /></span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="tool-result-body">
          <div className="tool-result-section">
            <div className="tool-result-label">Input</div>
            <pre>{JSON.stringify(result.input, null, 2)}</pre>
          </div>
          <div className="tool-result-section">
            <div className="tool-result-label">{hasError ? 'Error' : 'Output'}</div>
            <pre>{hasError ? result.error : JSON.stringify(result.output, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

function ProvenanceTimeline({ trace }: { trace: any }) {
  return (
    <div className="provenance-timeline">
      <div className="trace-header">
        Run ID: <code>{trace.run_id}</code>
      </div>
      <div className="trace-steps">
        {trace.steps.map((step: any, idx: number) => (
          <div key={idx} className={`trace-step step-${step.step_type}`}>
            <div className="step-marker" />
            <div className="step-content">
              <div className="step-header">
                <span className="step-type">{step.step_type}</span>
                {step.tool_name && <span className="step-tool">{step.tool_name}</span>}
                <span className="step-time">{step.duration_ms}ms</span>
              </div>
              {step.input_summary && (
                <div className="step-summary">{step.input_summary}</div>
              )}
              {step.sandboxed && (
                <span className="sandbox-badge"><FiBox /> sandboxed</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}