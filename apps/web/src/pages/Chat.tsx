import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AdvisoryEvent, AgentProfile, ChatControlState, ChatNluIntent, ChatStreamChunk, CoworkerActivityFrame, COWORKER_WORK_STORY_TEMPLATES, MemoryEvent, PermissionMode, PreferredWebMode, ReviewEvent, SettingsPayload, ToolInfo, ToolResult, ToolUseMode, WorkflowState, SystemStatusSnapshot } from '@rawclaw/shared';
import { api } from '../lib/api';
import { AUTH_TOKEN_KEY } from '../lib/auth';
import { ChatSidebar } from '../components/ChatSidebar';
import { ChatSkeleton } from '../components/chat/ChatSkeleton';
// DEPRECATED: ConfirmationBanner kept as fallback; replaced by PendingConfirmationsPanel
// import { ConfirmationBanner } from '../components/ConfirmationBanner';
import { PendingConfirmationsPanel } from '../components/chat/PendingConfirmationsPanel';
import { TaskRunPanel } from '../components/chat/TaskRunPanel';
import { useSystemPoller } from '../hooks/useSystemPoller';
import { 
  FiEdit2, FiRotateCw, FiDatabase, FiGlobe, FiHome, 
  FiCopy, FiFolder, FiFileText, FiX, FiPlus, 
  FiMessageSquare, FiSquare, FiEye, FiAlertTriangle, FiActivity, FiShield,
  FiChevronDown, FiChevronUp, FiCpu, FiUser
} from 'react-icons/fi';
import { WebSearchResult } from '../components/chat/WebSearchResult';
import { BrowserResult } from '../components/chat/BrowserResult';
import { FileResult } from '../components/chat/FileResult';
import { CodeResult } from '../components/chat/CodeResult';
import { TerminalResult } from '../components/chat/TerminalResult';
import { GenericToolCard } from '../components/chat/GenericToolCard';
import { ToolResultCard } from '../components/chat/ToolResultCard';
import { ProvenanceTrace } from '../components/chat/ProvenanceTrace';
import { WorkStoryCard } from '../components/chat/WorkStoryCard';
import { InitialAnalysisCard } from '../components/chat/InitialAnalysisCard';
import { buildSearchAttemptMeta } from '../components/chat/researchUiSummary';
import { FileBrowserPanel } from '../components/chat/FileBrowserPanel';
import { ChatAttachment, DocumentSelection, DocumentEditRequest, DocumentEditAction } from '@rawclaw/shared';
import { DocumentCanvas } from '../components/chat/DocumentCanvas';
import { ErrorCard } from '../components/chat/ErrorCard';
import { InterruptedBanner } from '../components/chat/InterruptedBanner';
import { modelShortName, resolveAgentLabel, summarizeMemoryEvents } from '../components/chat/messageMetadataUtils';
import { hexToRgba, resolveAgentAccent } from '../components/chat/agentVisuals';
import { isUserFacingToolResult } from '../components/chat/toolVisibility';
import { processFileForAttachment } from '../lib/chat-attachments';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  systemStatus: SystemStatusSnapshot;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  attachments?: ChatAttachment[];
  tool_calls?: any[];
  toolResults?: ToolResult[];
  provenanceTrace?: ChatStreamChunk['provenanceTrace'];
  citations?: Array<{ url: string; title?: string }>;
  memoryRecall?: boolean;
  agentId?: string;
  modelId?: string;
  streamStatus?: 'completed' | 'incomplete' | 'failed';
  sourceChipAgentId?: string;
  sourceChipModelId?: string;
  isLocal?: boolean;
  createdAt?: string | Date;
  durationMs?: number;
  runIds?: string[];
  promptPackId?: string;
  promptVersionHash?: string;
  reviewerPromptVersionHash?: string;
  workflowPromptIds?: string[];
  reviewEvents?: ReviewEvent[];
  workflowState?: WorkflowState;
  memoryEvents?: MemoryEvent[];
  advisoryEvents?: AdvisoryEvent[];
  coworkerActivityFrame?: CoworkerActivityFrame;
  transformTrace?: any;
  id?: string;
  thinking?: string;
  harnessLogs?: any[];
  approvalRequired?: { reason: string; complexity?: string };
  isDeepResearch?: boolean;
  error?: {
    type:
      | 'agent_unavailable'
      | 'agent_error'
      | 'stream_failed'
      | 'provider_routing_failed'
      | 'model_unavailable'
      | 'mcp_unavailable'
      | 'tool_failed'
      | 'stream_interrupted'
      | 'stream_timeout'
      | 'execution_timeout'
      | 'turn_limit_reached'
      | 'sequential_thinking_limit_reached'
      | 'auth_failure'
      | 'request_too_large'
      | 'context_limit_exceeded'
      | 'unsupported_file_type';
    message: string;
    details?: string;
  };
  retryState?: {
    mode: 'retrying' | 'manual';
    attempt: number;
    maxAttempts: number;
  };
}

type SessionErrorType = NonNullable<SessionMessage['error']>['type'];

interface ParsedChatErrorPayload {
  status: number;
  error?: string;
  message: string;
  details?: string;
  retryable?: boolean;
}

interface ChatSessionPayload {
  messages: SessionMessage[];
  chatControls?: ChatControlState;
}

interface SkillRuntimeStatus {
  installedPluginBundles?: string[];
}

const DEFAULT_CHAT_CONTROLS: ChatControlState = {
  planMode: false,
  preferredWebMode: 'auto',
  toolUseMode: 'auto',
  permissionMode: 'workspace_default',
  selectedPlugins: [],
  selectedTools: [],
};

const NLU_CORRECTION_OPTIONS: Array<{ label: string; intent: ChatNluIntent }> = [
  { label: 'Chat', intent: 'conversation' },
  { label: 'Research', intent: 'research' },
  { label: 'Memory', intent: 'memory_query' },
  { label: 'Task', intent: 'task_create' },
  { label: 'Advisory', intent: 'advisory' },
  { label: 'Code/Troubleshoot', intent: 'troubleshooting' },
  { label: 'Edit', intent: 'edit_request' },
];

function normalizeAssistantDisplayText(content?: string): string {
  if (!content) return '';

  let normalized = content
    .replace(/<\/think>/gi, '')
    .replace(/<\/thinking>/gi, '')
    .replace(/<think>/gi, '')
    .replace(/<thinking>/gi, '')
    .replace(/<\/?skill_[a-z0-9-]+>/gi, '')
    .replace(/<\/?skill>/gi, '');

  normalized = normalized.replace(
    /^\s*>?\s*(?:\{[\s\S]*?"(?:tool|args|thought)"[\s\S]*?\}\s*)+/i,
    '',
  );

  const transcriptMatch = normalized.match(/<turn\|>|<\|(?:user|assistant|system|model)\|>|\|>(?:user|assistant|model)|<start_of_turn>|<end_of_turn>/i);
  if (transcriptMatch?.index !== undefined) {
    normalized = normalized.slice(0, transcriptMatch.index);
  }

  const rawLeakMatch = normalized.match(/>?\s*(?:\{"name":|>\{"tool":|>sequential_thinking\{|<\/skill>|<tool_code>|<invoke|minimax:tool_call)/i);
  if (rawLeakMatch?.index !== undefined) {
    normalized = normalized.slice(0, rawLeakMatch.index);
  }

  normalized = normalized
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\bIam(?=[A-Z])/g, 'I am ')
    .replace(/\bIve(?=[A-Z])/g, "I've ")
    .replace(/\bIll(?=[A-Z])/g, "I'll ")
    .replace(/\bId(?=[A-Z])/g, "I'd ")
    .replace(/\bYouve(?=[A-Z])/g, "You've ")
    .replace(/\bYoure(?=[A-Z])/g, "You're ")
    .replace(/\bDont(?=[A-Z])/g, "Don't ")
    .replace(/\bCant(?=[A-Z])/g, "Can't ")
    .replace(/\bWont(?=[A-Z])/g, "Won't ")
    .replace(/([,:;!?])([A-Za-z])/g, '$1 $2');

  normalized = collapseRepeatedAssistantContent(normalized);

  const alphaCount = (normalized.match(/[A-Za-z]/g) || []).length;
  const whitespaceCount = (normalized.match(/\s/g) || []).length;
  if (alphaCount >= 40 && whitespaceCount / Math.max(alphaCount, 1) < 0.08) {
    const boundaryWords = [
      'including', 'answering', 'questions', 'information', 'repository', 'workspace',
      'favorite', 'summary', 'provide', 'assist', 'variety', 'latest', 'results',
      'because', 'about', 'would', 'could', 'should', 'with', 'your', 'just', 'know',
      'this', 'that', 'have', 'from', 'into', 'task', 'agent', 'search', 'read',
      'list', 'help', 'what', 'mind', 'can', 'you', 'for', 'the', 'and',
    ];
    for (const word of boundaryWords) {
      const regex = new RegExp(`(?<=[A-Za-z])(${word})(?=[A-Za-z])`, 'gi');
      normalized = normalized.replace(regex, ' $1 ');
    }
    normalized = normalized
      .replace(/\bI(?=[a-z]{4,})/g, 'I ')
      .replace(/\bYou(?=[a-z]{4,})/g, 'You ')
      .replace(/\bYour(?=[a-z]{4,})/g, 'Your ');
  }

  return normalized.replace(/[ \t]{2,}/g, ' ').trim();
}

function buildFallbackWorkStory(message: Pick<SessionMessage, 'content' | 'toolResults' | 'streamStatus' | 'error'>): string {
  const visibleResult = (message.toolResults || [])[0];
  if (
    message.streamStatus === 'failed'
    || message.error?.type === 'stream_failed'
    || message.error?.type === 'agent_error'
  ) {
    const toolLabel = visibleResult?.tool_name?.replace(/^skill_/, '').replace(/_/g, ' ') || 'the response';
    return COWORKER_WORK_STORY_TEMPLATES.degraded(toolLabel, 'the response could not be delivered cleanly');
  }
  if (message.streamStatus === 'incomplete' || message.error?.type === 'stream_interrupted') {
    const toolLabel = visibleResult?.tool_name?.replace(/^skill_/, '').replace(/_/g, ' ') || 'the request';
    return COWORKER_WORK_STORY_TEMPLATES.degraded(toolLabel, 'the connection was interrupted');
  }
  if (visibleResult?.tool_name) {
    const toolLabel = visibleResult.tool_name.replace(/^skill_/, '').replace(/_/g, ' ');
    return COWORKER_WORK_STORY_TEMPLATES.degraded(toolLabel, 'the final normalized activity frame was unavailable');
  }
  return COWORKER_WORK_STORY_TEMPLATES.direct;
}

export function buildFallbackActivityFrame(
  message: Pick<
    SessionMessage,
    'content' | 'toolResults' | 'streamStatus' | 'error' | 'agentId' | 'sourceChipAgentId' | 'modelId' | 'sourceChipModelId' | 'isLocal' | 'workflowState'
  >,
  agents: AgentProfile[],
): CoworkerActivityFrame | undefined {
  const hasVisibleToolResults = Boolean((message.toolResults || []).length);
  if (message.streamStatus === 'failed' && !hasVisibleToolResults) {
    return undefined;
  }

  const sourceAgentId = message.sourceChipAgentId || message.agentId;
  const sourceModelId = message.sourceChipModelId || message.modelId;
  const sourceLabel = resolveAgentLabel(sourceAgentId, agents) || (sourceAgentId ? 'Assistant' : 'RawClaw');
  const sourceModelLabel = modelShortName(sourceModelId);
  const degradedCount = (message.toolResults || []).filter((result) => {
    const output = (result.output || {}) as Record<string, any>;
    return Boolean(result.error) || String(output.evidenceStatus || '').toLowerCase() === 'degraded';
  }).length;

  return {
    visibilityState: 'degraded',
    responseMode: message.streamStatus === 'incomplete' ? 'interrupted' : (message.content.trim() ? 'partial' : 'error'),
    workStory: buildFallbackWorkStory(message),
    lane: message.workflowState?.assistantLane || null,
    confidenceState: message.workflowState?.confidenceState || null,
    source: {
      agentId: sourceAgentId,
      agentLabel: sourceLabel,
      modelId: sourceModelId,
      modelLabel: sourceModelLabel,
      isLocal: message.isLocal,
    },
    evidenceSummary: {
      total: (message.toolResults || []).length,
      degraded: degradedCount,
      failed: (message.toolResults || []).filter((result) => Boolean(result.error)).length,
      strongestSource: null,
      sourceCount: 0,
    },
  };
}

function collapseRepeatedAssistantContent(content: string): string {
  let collapsed = content.replace(/(.{50,180}?)(?:\s+\1){2,}/gis, '$1 ...');

  const words = collapsed.split(/\s+/).filter(Boolean);
  if (words.length < 40) return collapsed;

  const maxWindow = Math.min(24, Math.floor(words.length / 3));
  for (let size = maxWindow; size >= 10; size--) {
    const tail = words.slice(-size).join(' ').toLowerCase();
    if (tail.length < 60) continue;

    const body = words.slice(0, -size).join(' ').toLowerCase();
    const firstIndex = body.indexOf(tail);
    if (firstIndex === -1) continue;

    const secondIndex = body.indexOf(tail, firstIndex + tail.length);
    if (secondIndex === -1) continue;

    return `${words.slice(0, -size).join(' ')} ...`;
  }

  return collapsed;
}

export function parseEditSuggestion(content?: string): { suggestion: string | null; textContent: string } {
  if (!content) return { suggestion: null, textContent: '' };
  
  const match = content.match(/<edit_suggestion>([\s\S]*?)<\/edit_suggestion>/);
  if (!match) return { suggestion: null, textContent: content };

  let suggestion = match[1].trim();

  // Strip markdown fences if the model wrapped the suggestion in them
  if (suggestion.startsWith('```') && suggestion.endsWith('```')) {
    const firstNewline = suggestion.indexOf('\n');
    const lastNewline = suggestion.lastIndexOf('\n');
    if (firstNewline !== -1 && lastNewline !== -1 && firstNewline < lastNewline) {
      suggestion = suggestion.slice(firstNewline + 1, lastNewline).trim();
    } else {
      // Just stripped the exact fences if it was single line or similar
      suggestion = suggestion.replace(/^```[a-z]*\n?/, '').replace(/\n?```$/, '');
    }
  }

  // Strip JSON wrapper if it tried to output structured JSON
  if (suggestion.startsWith('{') && suggestion.endsWith('}')) {
    try {
      const parsed = JSON.parse(suggestion);
      if (parsed.text) suggestion = String(parsed.text);
      else if (parsed.suggestion) suggestion = String(parsed.suggestion);
      else if (parsed.replacement) suggestion = String(parsed.replacement);
      else if (parsed.editedText) suggestion = String(parsed.editedText);
    } catch {
      // Not valid JSON, ignore
    }
  }

  const textContent = content.replace(/<edit_suggestion>[\s\S]*?<\/edit_suggestion>/g, '').trim();
  return { suggestion, textContent };
}

export function normalizeErrorType(errorCode?: string): NonNullable<SessionMessage['error']>['type'] {
  switch (errorCode) {
    case 'Aborted':
    case 'stream_interrupted':
      return 'stream_interrupted';
    case 'stream_error':
    case 'stream_failed':
      return 'stream_failed';
    case 'stream_timeout':
      return 'stream_timeout';
    case 'execution_timeout':
      return 'execution_timeout';
    case 'turn_limit_reached':
      return 'turn_limit_reached';
    case 'sequential_thinking_limit_reached':
      return 'sequential_thinking_limit_reached';
    case 'provider_routing_failed':
      return 'provider_routing_failed';
    case 'tool_failed':
      return 'tool_failed';
    case 'auth_failure':
      return 'auth_failure';
    case 'provider_http_error':
    case 'provider_offline':
    case 'provider_exception':
    case 'model_unavailable':
      return 'model_unavailable';
    case 'mcp_unavailable':
      return 'mcp_unavailable';
    case 'generator_error':
    case 'gateway_error':
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
      return 'agent_error';
  }
}

function getErrorDetailLabel(type: NonNullable<SessionMessage['error']>['type'], rawMessage?: string): string {
  switch (type) {
    case 'stream_failed':
      return 'Something went wrong while sending the response. Your message was received - please try again.';
    case 'model_unavailable':
      return 'The selected model could not complete this request. Check your model settings or switch models.';
    case 'provider_routing_failed':
      return 'RawClaw could not find a working model route for this request.';
    case 'stream_timeout':
    case 'execution_timeout':
      return rawMessage || 'The request took too long to finish.';
    default:
      return rawMessage || 'Generation error';
  }
}

function isLikelyNetworkFailure(value: string): boolean {
  return [
    'failed to fetch',
    'networkerror',
    'network error',
    'load failed',
    'econnrefused',
    'connection refused',
    'socket hang up',
    'agent unavailable',
    'agent service unavailable',
  ].some((fragment) => value.includes(fragment));
}

function isLikelyStreamFailure(value: string): boolean {
  return [
    'stream_error',
    'stream_failed',
    'emission_transformer',
    'sending the response',
    'chat stream',
    'client-visible event',
    'activity frame',
    'sse',
  ].some((fragment) => value.includes(fragment));
}

async function parseChatErrorResponse(response: Response): Promise<ParsedChatErrorPayload> {
  const contentType = response.headers.get('content-type') || '';
  let rawText = '';
  let payload: Record<string, unknown> | null = null;

  if (contentType.includes('application/json')) {
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
  } else {
    rawText = await response.text();
    if (rawText) {
      try {
        payload = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        payload = null;
      }
    }
  }

  if (!rawText && !payload) {
    rawText = await response.text().catch(() => '');
  }

  return {
    status: response.status,
    error: typeof payload?.error === 'string' ? payload.error : undefined,
    message:
      typeof payload?.message === 'string'
        ? payload.message
        : rawText || `Chat request failed with status ${response.status}`,
    details: typeof payload?.details === 'string' ? payload.details : undefined,
    retryable: typeof payload?.retryable === 'boolean' ? payload.retryable : undefined,
  };
}

function mapCaughtChatError(error: unknown): NonNullable<SessionMessage['error']> {
  if ((error as any)?.name === 'AbortError') {
    return {
      type: 'stream_interrupted',
      message: 'Stream stopped by user',
    };
  }

  const code = typeof (error as any)?.error === 'string' ? String((error as any).error) : undefined;
  const status = typeof (error as any)?.status === 'number' ? Number((error as any).status) : undefined;
  const message = error instanceof Error ? error.message : String((error as any)?.message || 'Chat failed.');
  const details = typeof (error as any)?.details === 'string' ? (error as any).details : undefined;
  const combined = `${code || ''} ${message || ''} ${details || ''}`.toLowerCase();

  let type: SessionErrorType = 'agent_error';
  let userMessage = message || 'Chat failed.';

  if (combined.includes('entity too large') || combined.includes('413') || combined.includes('payload too large')) {
    type = 'request_too_large';
    userMessage = 'Request too large';
  } else if (status === 401 || status === 403 || combined.includes('auth_failure')) {
    type = 'auth_failure';
    userMessage = 'Authentication failed';
  } else if (combined.includes('turn_limit_reached') || combined.includes('maximum reasoning turns')) {
    type = 'turn_limit_reached';
    userMessage = 'Reasoning limit reached';
  } else if (combined.includes('sequential_thinking_limit_reached') || combined.includes('sequential thinking turns')) {
    type = 'sequential_thinking_limit_reached';
    userMessage = 'Reasoning limit reached';
  } else if (combined.includes('stream_timeout') || combined.includes('stream timed out')) {
    type = 'stream_timeout';
  } else if (combined.includes('execution_timeout') || combined.includes('timed out after')) {
    type = 'execution_timeout';
  } else if (
    combined.includes('provider_http_error')
    || combined.includes('provider_offline')
    || combined.includes('provider_exception')
    || combined.includes('ollama returned')
    || combined.includes('does not support chat')
    || combined.includes('does not support tools')
    || combined.includes('selected model failed')
    || combined.includes('model returned an error')
  ) {
    type = 'model_unavailable';
    userMessage = 'The selected model could not complete this request. Check your model settings or switch models.';
  } else if (combined.includes('provider') || combined.includes('routing')) {
    type = 'provider_routing_failed';
    userMessage = 'RawClaw could not find a working model route for this request.';
  } else if (isLikelyNetworkFailure(combined)) {
    type = 'agent_unavailable';
    userMessage = 'Agent is unreachable. Please wait and retry.';
  } else if (code === 'stream_error' || code === 'stream_failed' || isLikelyStreamFailure(combined)) {
    type = 'stream_failed';
  } else if (status && status >= 400 && status < 500 && !code) {
    type = 'agent_error';
  } else if (code) {
    type = normalizeErrorType(code);
  }

  return {
    type,
    message: userMessage,
    ...(details ? { details } : {}),
  };
}

function normalizeChatControls(controls?: Partial<ChatControlState> | null): ChatControlState {
  return {
    planMode: Boolean(controls?.planMode),
    preferredWebMode: controls?.preferredWebMode || 'auto',
    toolUseMode: controls?.toolUseMode || 'auto',
    permissionMode: controls?.permissionMode || 'workspace_default',
    selectedPlugins: Array.isArray(controls?.selectedPlugins) ? controls.selectedPlugins : [],
    selectedTools: Array.isArray(controls?.selectedTools) ? controls.selectedTools : [],
  };
}

function isBrowserToolInfo(tool: ToolInfo): boolean {
  const name = tool.name.toLowerCase();
  const tags = (tool.capability_tags || []).map((tag) => tag.toLowerCase());
  const description = (tool.description || '').toLowerCase();
  return (
    name.startsWith('browser_') ||
    tags.some((tag) => ['browser', 'ui', 'localhost', 'playwright'].includes(tag)) ||
    description.includes('browser') ||
    description.includes('localhost')
  );
}

function getToolGroup(tool: ToolInfo): 'built_in' | 'mcp' | 'plugin' {
  if (isBrowserToolInfo(tool)) return 'plugin';
  if (tool.name.includes(':')) return 'mcp';
  return 'built_in';
}

export default function Chat({ selectedModel, temperature, top_p, systemStatus: _systemStatus }: Props) {
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
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const loadedSessionId = useRef<string | null>(null);
  const isNewChatNavigating = useRef(false);

  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [showComposerMenu, setShowComposerMenu] = useState(false);
  const [toolInventory, setToolInventory] = useState<ToolInfo[]>([]);
  const [availablePluginBundles, setAvailablePluginBundles] = useState<string[]>([]);
  const [workspaceDefaults, setWorkspaceDefaults] = useState<ChatControlState>(DEFAULT_CHAT_CONTROLS);
  const [chatControls, setChatControls] = useState<ChatControlState>(DEFAULT_CHAT_CONTROLS);
  const [controlMessage, setControlMessage] = useState<string | null>(null);
  const [pendingNluOverride, setPendingNluOverride] = useState<{ intent: ChatNluIntent } | null>(null);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(null);
  const [activeSelection, setActiveSelection] = useState<DocumentSelection | null>(null);
  const [showTasks, setShowTasks] = useState(false);

  // Centralized system poller - replaces scattered useEffect intervals
  const {
    pendingConfirmations,
    recentRuns,
    refresh: refreshPoller 
  } = useSystemPoller(sessionId, 3000);

  const hasRunningRun = useMemo(() => recentRuns.some(r => r.status === 'running'), [recentRuns]);
  const currentInputCount = input.length;
  const currentTokenEstimate = Math.max(0, Math.ceil(input.trim().length / 4));

  // Auto-expand task panel when background work starts
  useEffect(() => {
    if (hasRunningRun) {
      setShowTasks(true);
    }
  }, [hasRunningRun]);


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
    void loadChatControlsRuntime();
  }, []);

  useEffect(() => {
    // If we're currently sending or just navigated from a new chat, 
    // don't let the route change clear our optimistic state.
    if (sending || isNewChatNavigating.current) return;

    if (!routeSessionId) {
      if (messages.length > 0) setMessages([]);
      setChatControls(workspaceDefaults);
      loadedSessionId.current = null;
      return;
    }

    // Only load if it's a different session than what we currently have
    if (routeSessionId !== loadedSessionId.current) {
      void loadHistory(routeSessionId);
    }
  }, [routeSessionId, sending, workspaceDefaults]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!routeSessionId) return;
    void persistChatControls(chatControls);
  }, [routeSessionId]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) || null,
    [agents, selectedAgentId],
  );

  const sessionParticipants = useMemo(() => {
    const seen = new Set<string>();
    return messages.reduce<Array<{ agentId: string; label: string; anchorId: string; accent: string }>>((items, message, index) => {
      if (message.role !== 'assistant') return items;
      const agentId = message.sourceChipAgentId || message.agentId || 'main';
      if (seen.has(agentId)) return items;
      seen.add(agentId);
      items.push({
        agentId,
        label: resolveAgentLabel(agentId, agents) || 'RawClaw',
        anchorId: `assistant-message-${index}`,
        accent: resolveAgentAccent(agentId),
      });
      return items;
    }, []);
  }, [agents, messages]);

  const toolGroups = useMemo(() => ({
    built_in: toolInventory.filter((tool) => getToolGroup(tool) === 'built_in'),
    mcp: toolInventory.filter((tool) => getToolGroup(tool) === 'mcp'),
    plugin: toolInventory.filter((tool) => getToolGroup(tool) === 'plugin'),
  }), [toolInventory]);

  const activeControlChips = useMemo(() => {
    const chips: string[] = [];
    if (chatControls.planMode) chips.push('Plan mode');
    if (chatControls.preferredWebMode && chatControls.preferredWebMode !== 'auto') {
      const labelMap: Record<PreferredWebMode, string> = {
        auto: 'Auto web',
        search: 'Web: Search',
        read_page: 'Web: Read page',
        browser: 'Web: Browser',
      };
      chips.push(labelMap[chatControls.preferredWebMode]);
    }
    if (chatControls.toolUseMode && chatControls.toolUseMode !== 'auto') {
      const toolUseLabels: Record<ToolUseMode, string> = {
        auto: 'Tools: Auto',
        limited: 'Tools: Limited',
        manual: 'Tools: Manual',
      };
      chips.push(toolUseLabels[chatControls.toolUseMode]);
    }
    if (chatControls.permissionMode && chatControls.permissionMode !== 'workspace_default') {
      const permissionLabels: Record<PermissionMode, string> = {
        ask_every_time: 'Permissions: Ask',
        allow_safe_tools: 'Permissions: Safe',
        workspace_default: 'Permissions: Default',
      };
      chips.push(permissionLabels[chatControls.permissionMode]);
    }
    if ((chatControls.selectedPlugins || []).length > 0) {
      chips.push(`Plugins: ${chatControls.selectedPlugins!.length}`);
    }
    if ((chatControls.selectedTools || []).length > 0) {
      chips.push(`Tools: ${chatControls.selectedTools!.length}`);
    }
    return chips;
  }, [chatControls]);

  const loadAgents = async () => {
    try {
      const response = await api.get<AgentProfile[]>('/agents');
      setAgents(response.data);
      setAgentsError(null);
      setSelectedAgentId((current) => {
        if (current && response.data.some((agent) => agent.id === current)) {
          return current;
        }
        const defaultAgent = response.data.find((agent) => agent.isDefault);
        return defaultAgent?.id || '';
      });
    } catch (loadError) {
      console.error('Failed to load agents', loadError);
      setAgents([]);
      setSelectedAgentId('');
      setAgentsError('Agent profiles are temporarily unavailable.');
    }
  };

  const loadChatControlsRuntime = async () => {
    try {
      const [settingsResponse, toolsResponse, skillsStatusResponse] = await Promise.all([
        api.get<SettingsPayload>('/settings'),
        api.get<{ tools: ToolInfo[] }>('/tools/info'),
        api.get<SkillRuntimeStatus>('/skills/status'),
      ]);
      const defaults = normalizeChatControls(settingsResponse.data?.settings?.chatDefaults || DEFAULT_CHAT_CONTROLS);
      setWorkspaceDefaults(defaults);
      setChatControls((current) => normalizeChatControls({
        ...defaults,
        ...current,
        selectedPlugins: current.selectedPlugins?.length ? current.selectedPlugins : defaults.selectedPlugins,
        selectedTools: current.selectedTools?.length ? current.selectedTools : defaults.selectedTools,
      }));
      setToolInventory(toolsResponse.data?.tools || []);
      setAvailablePluginBundles(skillsStatusResponse.data?.installedPluginBundles || []);
    } catch (error) {
      console.error('Failed to load chat controls runtime', error);
    }
  };

  const persistChatControls = async (nextControls: ChatControlState) => {
    if (!routeSessionId) return;
    try {
      await api.post(`/chat/sessions/${routeSessionId}/preferences`, nextControls);
    } catch (error) {
      console.error('Failed to persist chat controls', error);
    }
  };

  const updateChatControls = (patch: Partial<ChatControlState>) => {
    setChatControls((current) => {
      const next = normalizeChatControls({
        ...current,
        ...patch,
        selectedPlugins: patch.selectedPlugins ?? current.selectedPlugins,
        selectedTools: patch.selectedTools ?? current.selectedTools,
      });
      void persistChatControls(next);
      return next;
    });
  };

  const toggleSelectedValue = (currentValues: string[] | undefined, value: string): string[] => {
    const values = currentValues || [];
    return values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];
  };

  const saveCurrentControlsAsWorkspaceDefaults = async () => {
    try {
      const response = await api.post<SettingsPayload>('/settings', {
        settings: {
          chatDefaults: chatControls,
        },
      });
      const defaults = normalizeChatControls(response.data.settings.chatDefaults);
      setWorkspaceDefaults(defaults);
      setControlMessage('Saved current chat controls as workspace defaults.');
      window.setTimeout(() => setControlMessage(null), 2500);
    } catch (error) {
      console.error('Failed to save workspace chat defaults', error);
      setControlMessage('Could not save workspace defaults right now.');
      window.setTimeout(() => setControlMessage(null), 2500);
    }
  };

  const loadHistory = async (id: string, soft = false) => {
    if (!soft) setLoadingHistory(true);
    try {
      const response = await api.get<ChatSessionPayload>(`/chat/sessions/${id}`);
      const serverMessages = (response.data?.messages || []).map((message) => (
        message.role === 'assistant'
          ? { ...message, content: normalizeAssistantDisplayText(message.content) }
          : message
      ));
      
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
      setChatControls((current) => normalizeChatControls(response.data?.chatControls || current || workspaceDefaults));
      loadedSessionId.current = id;
    } finally {
      if (!soft) setLoadingHistory(false);
    }
  };

  const handleAttachmentSelection = async (fileList: FileList | null) => {
    setAttachmentError(null);
    if (!fileList) return;
    const files = Array.from(fileList);
    for (const file of files) {
      const result = await processFileForAttachment(file);
      if (result.error) {
        setAttachmentError(result.error);
      } else if (result.attachment) {
        setAttachments((prev) => [...prev, result.attachment!]);
      }
    }
  };

  const consumeStream = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    options: { replaceOnFirstContent?: boolean; clearRecoveryOnFirstContent?: boolean } = {},
  ): Promise<{ state: 'done' | 'error' | 'incomplete'; assistantText: string; errorType?: NonNullable<SessionMessage['error']>['type'] }> => {
    const decoder = new TextDecoder();
    let assistantText = '';
    const toolCalls: any[] = [];
    const toolResults: ToolResult[] = [];
    let streamBuffer = '';
    let sawDoneEvent = false;
    let sawContent = false;
    let sawActivityFrame = false;
    while (true) {
      const { value, done } = await reader.read();
      
      if (value) {
        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split('\n');
        // Keep the last, potentially incomplete line in the buffer
        streamBuffer = lines.pop() || '';

        for (const line of lines) {
          const raw = line.trim();
          if (!raw) continue;
          
          // SSE data: prefix check
          const payload = raw.startsWith('data: ') ? raw.slice(6).trim() : 
                         (raw.startsWith('data:') ? raw.slice(5).trim() : raw);
          if (!payload) continue;

          try {
            const data = JSON.parse(payload) as ChatStreamChunk;
            
            if (data.type === 'content') {
              const sanitizedContent = normalizeAssistantDisplayText(data.content || '');
              if (!sanitizedContent) {
                continue;
              }
              if (!sawContent && options.replaceOnFirstContent) {
                assistantText = sanitizedContent;
              } else {
                assistantText += sanitizedContent;
              }
              sawContent = true;
              patchAssistant({
                content: assistantText,
                streamStatus: 'completed',
                ...(options.clearRecoveryOnFirstContent ? { retryState: undefined, error: undefined } : {}),
              });
            } else if (data.type === 'thinking' && data.thinking) {
              setMessages((current) => {
                const next = [...current];
                const index = next.map((item) => item.role).lastIndexOf('assistant');
                if (index >= 0) {
                  const currentThinking = next[index].thinking || '';
                  next[index] = { ...next[index], thinking: currentThinking + data.thinking };
                }
                return next;
              });
            } else if ((data.type as string) === 'tool_call' && (data as any).tool_call) {
              const incomingToolCall = (data as any).tool_call;
              toolCalls.push({ name: incomingToolCall?.name || 'unknown' });
              patchAssistant({ tool_calls: [...toolCalls.slice(-3)] });
            } else if (data.type === 'tool_result' && data.tool_result) {
              toolResults.push(data.tool_result);
              patchAssistant({ toolResults: [...toolResults] });
            } else if (data.type === 'provenance') {
              // The backend now sends provenanceTrace as a sanitized object
              const trace = data.provenanceTrace || (data as any).provenance_trace || (data as any).provenance || data;
              patchAssistant({ provenanceTrace: trace });
            } else if ((data.type as string) === 'activity_frame' && (data as any).activityFrame) {
              sawActivityFrame = true;
              patchAssistant({ coworkerActivityFrame: (data as any).activityFrame });
            } else if (data.type === 'metadata' && data.metadata) {
              const metadataPatch: Partial<SessionMessage> = {};
              if (data.metadata.modelId !== undefined) metadataPatch.modelId = data.metadata.modelId;
              if (data.metadata.isLocal !== undefined) metadataPatch.isLocal = data.metadata.isLocal;
              if (data.metadata.memoryRecall !== undefined) metadataPatch.memoryRecall = data.metadata.memoryRecall;
              if (data.metadata.durationMs !== undefined) metadataPatch.durationMs = data.metadata.durationMs;
              if (data.metadata.runIds !== undefined) metadataPatch.runIds = data.metadata.runIds;
              if ((data.metadata as any).isDeepResearch !== undefined) metadataPatch.isDeepResearch = (data.metadata as any).isDeepResearch;
              if ((data.metadata as any).nlu) metadataPatch.workflowState = { nlu: (data.metadata as any).nlu };
              patchAssistant(metadataPatch);
            } else if (data.type === 'review_result') {
              setMessages((current) => {
                const next = [...current];
                const index = next.map((item) => item.role).lastIndexOf('assistant');
                if (index >= 0) {
                  const currentEvents = next[index].reviewEvents || [];
                  next[index] = {
                    ...next[index],
                    reviewEvents: [
                      ...currentEvents,
                      {
                        approved: (data as any).approved,
                        feedback: (data as any).feedback,
                        reviewerId: (data as any).reviewer_id,
                      },
                    ],
                  };
                }
                return next;
              });
            } else if ((data.type as string) === 'harness') {
              setMessages((current) => {
                const next = [...current];
                const index = next.map((item) => item.role).lastIndexOf('assistant');
                if (index >= 0) {
                  const logs = next[index].harnessLogs || [];
                  next[index] = { ...next[index], harnessLogs: [...logs, (data as any).harness_log] };
                }
                return next;
              });
            } else if ((data.type as string) === 'approval_required') {
              patchAssistant({ approvalRequired: { reason: (data as any).reason, complexity: (data as any).complexity } });
            } else if (data.type === 'error') {
              const err = data as any;
              const normalizedType = normalizeErrorType(err.error);
              const hasPartial = assistantText.trim().length > 0;
              const fallbackFrame = !sawActivityFrame
                ? buildFallbackActivityFrame({
                    content: assistantText,
                    toolResults,
                    streamStatus: hasPartial ? 'incomplete' : 'failed',
                    error: {
                      type: normalizedType,
                      message: err.message || err.error || 'Generation error',
                    },
                    agentId: selectedAgentId || undefined,
                    sourceChipAgentId: selectedAgentId || undefined,
                    modelId: selectedModel,
                    sourceChipModelId: selectedModel,
                    isLocal: selectedModel.startsWith('ollama/'),
                    workflowState: undefined,
                  }, agents)
                : undefined;
              patchAssistant({
                streamStatus: hasPartial ? 'incomplete' : 'failed',
                ...(fallbackFrame ? { coworkerActivityFrame: fallbackFrame } : {}),
                error: {
                  type: normalizedType,
                  message: getErrorDetailLabel(normalizedType, err.message || err.error || 'Generation error'),
                  details: (
                    normalizedType === 'model_unavailable'
                    || normalizedType === 'stream_failed'
                    || normalizedType === 'agent_error'
                  )
                    ? (err.message || err.error || 'Generation error')
                    : ''
                }
              });
              return {
                state: hasPartial ? 'incomplete' : 'error',
                assistantText,
                errorType: normalizedType,
              };
            } else if (data.type === 'done') {
              sawDoneEvent = true;
              patchAssistant({ streamStatus: 'completed', retryState: undefined });
              return { state: 'done', assistantText }; // Clean termination
            }
          } catch (e) {
            console.warn('Malformed pipe frame:', payload, e);
          }
        }
      }

      if (done) {
        // Process any remaining characters in the buffer if they form a valid line
        if (streamBuffer.trim()) {
           try {
             const payload = streamBuffer.startsWith('data: ') ? streamBuffer.slice(6).trim() : 
                            (streamBuffer.startsWith('data:') ? streamBuffer.slice(5).trim() : streamBuffer);
             JSON.parse(payload);
           } catch(e) {}
        }
        break;
      }
    }
    if (!sawDoneEvent && assistantText.trim().length > 0) {
      const fallbackFrame = !sawActivityFrame
        ? buildFallbackActivityFrame({
            content: assistantText,
            toolResults,
            streamStatus: 'incomplete',
            error: {
              type: 'stream_interrupted',
              message: 'Connection interrupted before the response finished.',
            },
            agentId: selectedAgentId || undefined,
            sourceChipAgentId: selectedAgentId || undefined,
            modelId: selectedModel,
            sourceChipModelId: selectedModel,
            isLocal: selectedModel.startsWith('ollama/'),
            workflowState: undefined,
          }, agents)
        : undefined;
      patchAssistant({
        streamStatus: 'incomplete',
        ...(fallbackFrame ? { coworkerActivityFrame: fallbackFrame } : {}),
        error: {
          type: 'stream_interrupted',
          message: 'Connection interrupted before the response finished.',
        },
      });
      return { state: 'incomplete', assistantText, errorType: 'stream_interrupted' };
    }

    if (!sawDoneEvent) {
      const fallbackFrame = !sawActivityFrame
        ? buildFallbackActivityFrame({
            content: assistantText,
            toolResults,
            streamStatus: 'failed',
            error: {
              type: 'stream_failed',
              message: 'Something went wrong while sending the response.',
            },
            agentId: selectedAgentId || undefined,
            sourceChipAgentId: selectedAgentId || undefined,
            modelId: selectedModel,
            sourceChipModelId: selectedModel,
            isLocal: selectedModel.startsWith('ollama/'),
            workflowState: undefined,
          }, agents)
        : undefined;
      patchAssistant({
        streamStatus: 'failed',
        ...(fallbackFrame ? { coworkerActivityFrame: fallbackFrame } : {}),
        error: {
          type: 'stream_failed',
          message: 'Something went wrong while sending the response.',
        },
      });
      return { state: 'error', assistantText, errorType: 'stream_failed' };
    }

    return { state: 'done', assistantText };
  };

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  const getPersistedIncompleteAssistant = async (): Promise<SessionMessage | null> => {
    await wait(150);
    const response = await api.get<ChatSessionPayload>(`/chat/sessions/${sessionId}`);
    const persisted = [...(response.data?.messages || [])]
      .reverse()
      .find((message) => message.role === 'assistant' && message.streamStatus === 'incomplete');
    return persisted || null;
  };

  const recoverInterruptedTurn = async (
    buildRetryRequest: (messageId: string) => Record<string, unknown>,
  ) => {
    const delays = [1000, 2000, 4000];
    const token = localStorage.getItem(AUTH_TOKEN_KEY);

    for (let index = 0; index < delays.length; index += 1) {
      patchAssistant({
        streamStatus: 'incomplete',
        retryState: {
          mode: 'retrying',
          attempt: index + 1,
          maxAttempts: delays.length,
        },
        error: {
          type: 'stream_interrupted',
          message: `Connection interrupted. Reconnecting ${index + 1}/${delays.length}...`,
        },
      });
      await wait(delays[index]);

      let persisted: SessionMessage | null = null;
      try {
        persisted = await getPersistedIncompleteAssistant();
      } catch (error) {
        console.warn('Could not load incomplete assistant message before retry:', error);
      }

      if (!persisted?.id) {
        continue;
      }

      patchAssistant({
        id: persisted.id,
        createdAt: persisted.createdAt,
        streamStatus: 'incomplete',
      });

      try {
        const response = await fetch('/api/chat/regenerate', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(buildRetryRequest(persisted.id)),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }
        if (!response.body) {
          throw new Error('No response body from retry stream.');
        }

        const outcome = await consumeStream(response.body.getReader(), {
          replaceOnFirstContent: true,
          clearRecoveryOnFirstContent: true,
        });
        if (outcome.state === 'done') {
          return true;
        }
      } catch (error) {
        console.warn(`Retry attempt ${index + 1} failed:`, error);
      }
    }

    let persisted: SessionMessage | null = null;
    try {
      persisted = await getPersistedIncompleteAssistant();
    } catch (error) {
      console.warn('Could not reload incomplete assistant message after retries:', error);
    }

    patchAssistant({
      ...(persisted?.id ? { id: persisted.id, createdAt: persisted.createdAt } : {}),
      streamStatus: 'incomplete',
      retryState: {
        mode: 'manual',
        attempt: delays.length,
        maxAttempts: delays.length,
      },
      error: {
        type: 'stream_interrupted',
        message: 'Connection interrupted before I finished.',
      },
    });
    return false;
  };

  const send = async (explicitEditRequest?: DocumentEditRequest) => {
    if ((!input.trim() && !explicitEditRequest) || sending) return;
    const prompt = input.trim() || `[Edit] ${explicitEditRequest?.action}`;
    if (!explicitEditRequest) setInput('');
    setShowComposerMenu(false);
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
    const nluOverrideForRequest = pendingNluOverride;
    setPendingNluOverride(null);

    setMessages((current) => [
      ...current,
      { role: 'user', content: prompt, attachments: currentAttachments.length > 0 ? currentAttachments : undefined },
      {
        role: 'assistant',
        content: '',
        toolResults: [],
        agentId: selectedAgentId || undefined,
        modelId: selectedModel,
        sourceChipAgentId: selectedAgentId || undefined,
        sourceChipModelId: selectedModel,
        isLocal: selectedModel.startsWith('ollama/'),
      },
    ]);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    let shouldReloadHistoryAfterRecovery = false;

      try {
        const token = localStorage.getItem(AUTH_TOKEN_KEY);
        const isComplexity = selectedModel.startsWith('complexity:');
        const requestBody: any = {
          session_id: sessionId,
          messages: [{ role: 'user', content: prompt, attachments: currentAttachments.length > 0 ? currentAttachments : undefined }],
          model: selectedModel,
          temperature,
          top_p,
          stream: true,
          agent_id: selectedAgentId || undefined,
          selection: !explicitEditRequest ? (activeSelection || undefined) : undefined,
          editRequest: explicitEditRequest,
          planMode: chatControls.planMode,
          preferredWebMode: chatControls.preferredWebMode,
          toolUseMode: chatControls.toolUseMode,
          permissionMode: chatControls.permissionMode,
          selectedPlugins: chatControls.selectedPlugins,
          selectedTools: chatControls.selectedTools,
          nluOverride: nluOverrideForRequest || undefined,
        };
        
        // Only send complexity when explicitly in complexity mode
        if (isComplexity) {
          delete requestBody.model;
          requestBody.complexity = selectedModel.split(':')[1];
        }
        
      const response = await fetch('/api/chat/send', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        });

      if (!response.ok) {
        const parsedError = await parseChatErrorResponse(response);
        const requestError = new Error(parsedError.message) as Error & ParsedChatErrorPayload;
        requestError.name = 'ChatRequestError';
        Object.assign(requestError, parsedError);
        throw requestError;
      }

      if (!response.body) throw new Error('No response body from chat stream.');
      const outcome = await consumeStream(response.body.getReader());
      if (outcome.state === 'incomplete') {
        const recovered = await recoverInterruptedTurn((messageId) => {
          const retryBody: Record<string, unknown> = {
            sessionId,
            messageId,
            temperature,
            top_p,
            agentId: selectedAgentId || undefined,
            nluOverride: nluOverrideForRequest || undefined,
          };
          if (isComplexity) {
            retryBody.complexity = selectedModel.split(':')[1];
          } else {
            retryBody.model = selectedModel;
          }
          return retryBody;
        });
        if (recovered) {
          shouldReloadHistoryAfterRecovery = true;
        }
      }
    } catch (error: any) {
      patchAssistant({ error: mapCaughtChatError(error) });
    } finally {
      setSending(false);
      abortControllerRef.current = null;
      setActiveSelection(null);
      if (shouldReloadHistoryAfterRecovery) {
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
      return [
        ...truncated,
        {
          role: 'assistant',
          content: '',
          toolResults: [],
          agentId: selectedAgentId || undefined,
          modelId: selectedModel,
          sourceChipAgentId: selectedAgentId || undefined,
          sourceChipModelId: selectedModel,
          isLocal: selectedModel.startsWith('ollama/'),
        },
      ];
    });

    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const isComplexity = selectedModel.startsWith('complexity:');
      const requestBody: any = {
        sessionId,
        messageId,
        content,
        model: selectedModel,
        temperature,
        top_p,
        agentId: selectedAgentId || undefined,
      };
      
      // Only send complexity when explicitly in complexity mode
      if (isComplexity) {
        delete requestBody.model;
        requestBody.complexity = selectedModel.split(':')[1];
      }
      
      const response = await fetch('/api/chat/edit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const parsedError = await parseChatErrorResponse(response);
        const requestError = new Error(parsedError.message) as Error & ParsedChatErrorPayload;
        requestError.name = 'ChatRequestError';
        Object.assign(requestError, parsedError);
        throw requestError;
      }
      if (response.body) {
        const outcome = await consumeStream(response.body.getReader());
        if (outcome.state === 'incomplete') {
          await recoverInterruptedTurn((retryMessageId) => {
            const retryBody: Record<string, unknown> = {
              sessionId,
              messageId: retryMessageId,
              temperature,
              top_p,
              agentId: selectedAgentId || undefined,
            };
            if (isComplexity) {
              retryBody.complexity = selectedModel.split(':')[1];
            } else {
              retryBody.model = selectedModel;
            }
            return retryBody;
          });
        }
      }
    } catch (e: any) {
      console.error('Edit failed:', e);
      patchAssistant({ error: mapCaughtChatError(e) });
    } finally {
      setSending(false);
      abortControllerRef.current = null;
      if (sessionId) void loadHistory(sessionId, true);
    }
  };

  const handleRegenerate = async (messageId: string, nluOverride?: { intent: ChatNluIntent }) => {
    if (sending) return;
    if (nluOverride) {
      const index = messages.findIndex((m) => m.id === messageId);
      const messagesAfter = index >= 0 ? messages.slice(index + 1).filter((m) => m.role === 'user' || m.role === 'assistant').length : 0;
      if (messagesAfter > 0 && !window.confirm(`Retrying will remove ${messagesAfter} messages after this point. Continue?`)) {
        return;
      }
    }
    setSending(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Truncate local state to the assistant message being regenerated (which follows a user message)
    // Actually, messageId passed here is for the assistant response.
    setMessages((current) => {
      const index = current.findIndex((m) => m.id === messageId);
      if (index === -1) return current;
      const truncated = current.slice(0, index);
      return [
        ...truncated,
        {
          role: 'assistant',
          content: '',
          toolResults: [],
          agentId: selectedAgentId || undefined,
          modelId: selectedModel,
          sourceChipAgentId: selectedAgentId || undefined,
          sourceChipModelId: selectedModel,
          isLocal: selectedModel.startsWith('ollama/'),
        },
      ];
    });

    try {
      const token = localStorage.getItem(AUTH_TOKEN_KEY);
      const isComplexity = selectedModel.startsWith('complexity:');
      const requestBody: any = {
        sessionId,
        messageId,
        model: selectedModel,
        temperature,
        top_p,
        agentId: selectedAgentId || undefined,
        nluOverride,
      };
      
      // Only send complexity when explicitly in complexity mode
      if (isComplexity) {
        delete requestBody.model;
        requestBody.complexity = selectedModel.split(':')[1];
      }
      
      const response = await fetch('/api/chat/regenerate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const parsedError = await parseChatErrorResponse(response);
        const requestError = new Error(parsedError.message) as Error & ParsedChatErrorPayload;
        requestError.name = 'ChatRequestError';
        Object.assign(requestError, parsedError);
        throw requestError;
      }
      if (response.body) {
        const outcome = await consumeStream(response.body.getReader());
        if (outcome.state === 'incomplete') {
          await recoverInterruptedTurn((retryMessageId) => {
            const retryBody: Record<string, unknown> = {
              sessionId,
              messageId: retryMessageId,
              temperature,
              top_p,
              agentId: selectedAgentId || undefined,
              nluOverride,
            };
            if (isComplexity) {
              retryBody.complexity = selectedModel.split(':')[1];
            } else {
              retryBody.model = selectedModel;
            }
            return retryBody;
          });
        }
      }
    } catch (e: any) {
      console.error('Regenerate failed:', e);
      patchAssistant({ error: mapCaughtChatError(e) });
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
    <div className="chat-page-container chat-page-shell" style={{ display: 'flex', flex: 1, minHeight: 0, gap: '1rem', position: 'relative', overflow: 'hidden' }}>
      <style>{`
        .chat-page-shell .glass-card,
        .chat-page-shell .btn-primary,
        .chat-page-shell .btn-secondary,
        .chat-page-shell .btn-ghost,
        .chat-page-shell textarea,
        .chat-page-shell select,
        .chat-page-shell .message-surface,
        .chat-page-shell .provenance-container {
          border-radius: 0 !important;
        }
        .chat-page-shell .active-session {
          background: rgba(79, 70, 229, 0.92) !important;
          border: 1px solid rgba(129, 140, 248, 0.92) !important;
        }
        .chat-page-shell .active-session div,
        .chat-page-shell .active-session span {
          color: #fff !important;
        }
        .chat-page-shell .message-bubble:hover .message-actions {
          opacity: 0.95 !important;
        }
        .chat-page-shell .provenance-container {
          background: rgba(255,255,255,0.03) !important;
          border: 1px solid rgba(255,255,255,0.08) !important;
          font-family: var(--font-mono, monospace);
          font-size: 12px !important;
        }
        .chat-page-shell .typing-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--neon-cyan);
          opacity: 0.35;
          animation: rawclawTyping 1.2s infinite ease-in-out;
        }
        .chat-page-shell .typing-dot:nth-child(2) { animation-delay: 0.15s; }
        .chat-page-shell .typing-dot:nth-child(3) { animation-delay: 0.3s; }
        .chat-page-shell .shimmer-block {
          position: relative;
          overflow: hidden;
          background: rgba(255,255,255,0.05);
        }
        .chat-page-shell .shimmer-block::after {
          content: '';
          position: absolute;
          inset: 0;
          transform: translateX(-100%);
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent);
          animation: rawclawShimmer 1.6s infinite;
        }
        .chat-page-shell .send-pulse {
          animation: rawclawButtonPulse 1.8s infinite ease-in-out;
        }
        .chat-page-shell .status-dot-ok {
          animation: rawclawPulse 1.7s infinite;
        }
        .chat-page-shell .status-dot-error {
          animation: rawclawBlink 1s infinite;
        }
        @keyframes rawclawTyping {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.3; }
          40% { transform: translateY(-3px); opacity: 1; }
        }
        @keyframes rawclawShimmer {
          100% { transform: translateX(100%); }
        }
        @keyframes rawclawButtonPulse {
          0%, 100% { box-shadow: 0 0 0 rgba(99,102,241,0); }
          50% { box-shadow: 0 0 14px rgba(99,102,241,0.35); }
        }
        @keyframes rawclawPulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(16,185,129,0.2); }
          50% { box-shadow: 0 0 0 6px rgba(16,185,129,0); }
        }
        @keyframes rawclawBlink {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>
      <ChatSidebar />

      {/* Main Chat Area */}
      <div
        className="glass-card"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
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
        <div style={{ height: 40, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.5rem', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h1 style={{ 
              fontSize: '1rem', 
              margin: 0, 
              fontWeight: 800, 
              letterSpacing: '-0.02em',
              background: 'linear-gradient(to right, #fff, var(--neon-cyan))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>
              RawClaw
            </h1>
            {routeSessionId && (
              <span className="mono" style={{ 
                fontSize: '0.6rem', 
                color: 'var(--text-muted)', 
                padding: '1px 4px', 
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border-glass)'
              }}>
                {routeSessionId.slice(0, 8)}...
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
            <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)} style={{ ...fieldStyle, border: '1px solid rgba(34,211,238,0.45)', padding: '0.25rem 0.5rem', fontSize: '0.7rem', minWidth: '140px' }}>
              <option value="">No agent</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
            <button 
              className="btn-secondary" 
              onClick={() => setShowWorkspace(!showWorkspace)}
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
            >
              <FiFolder size={12} />
            </button>
            <button 
              className="btn-secondary" 
              onClick={() => setShowTasks(!showTasks)}
              style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
            >
              <FiActivity size={12} />
            </button>
          </div>
        </div>

        {/* Operational Controls Bar */}
        {(sending || activeDocumentId || pendingConfirmations.length > 0) && (
          <div style={{ 
            display: 'flex', 
            gap: '0.75rem', 
            marginBottom: '0.75rem', 
            padding: '0.5rem', 
            background: 'rgba(0, 0, 0, 0.2)', 
            borderRadius: '8px',
            border: '1px solid var(--border-glass)',
            alignItems: 'center'
          }}>
            {sending && (
              <button 
                className="btn-danger" 
                onClick={stopGeneration}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <FiSquare size={12} /> Stop Generation
              </button>
            )}
            {activeDocumentId && (
              <button 
                className="btn-secondary" 
                onClick={() => {
                  const el = document.getElementById('document-canvas-container');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <FiEye size={12} /> Inspect Document
              </button>
            )}
            {pendingConfirmations.length > 0 && (
              <button 
                className="btn-primary" 
                onClick={() => {
                  const el = document.getElementById('pending-confirmations-list');
                  el?.scrollIntoView({ behavior: 'smooth' });
                }}
                style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.4rem', border: '1px solid var(--neon-cyan)', boxShadow: '0 0 10px rgba(0, 240, 255, 0.2)' }}
              >
                <FiAlertTriangle size={12} /> Jump to Confirmations ({pendingConfirmations.length})
              </button>
            )}
          </div>
        )}

        <PendingConfirmationsPanel
          confirmations={pendingConfirmations}
          onAction={() => void refreshPoller()}
        />

        <div
          ref={scrollRef}
          className="custom-scrollbar"
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            padding: '0.5rem',
            minHeight: 0,
          }}
        >
          {loadingHistory && messages.length === 0 ? <ChatSkeleton /> : null}

          {sessionParticipants.length > 0 ? (
            <div
              className="glass-card"
              style={{
                padding: '0.7rem 0.85rem',
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.55rem',
                alignItems: 'center',
              }}
            >
              <span className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                SESSION PARTICIPANTS
              </span>
              {sessionParticipants.map((participant) => (
                <button
                  key={participant.agentId}
                  type="button"
                  onClick={() => {
                    document.getElementById(participant.anchorId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    borderRadius: '999px',
                    border: `1px solid ${hexToRgba(participant.accent, 0.32)}`,
                    background: hexToRgba(participant.accent, 0.12),
                    color: participant.accent,
                    padding: '0.32rem 0.62rem',
                    fontSize: '0.74rem',
                    cursor: 'pointer',
                  }}
                  title={`Jump to ${participant.label}'s first message`}
                >
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: participant.accent }} />
                  {participant.label}
                </button>
              ))}
            </div>
          ) : null}

          {!loadingHistory && messages.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', padding: '1.5rem 0 1rem', textAlign: 'center', display: 'grid', gap: '0.85rem', alignContent: 'center', minHeight: '40vh', justifyItems: 'center' }}>
              <div style={{ display: 'grid', placeItems: 'center', width: 52, height: 52, border: '1px solid rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.08)' }}>
                <FiCpu size={24} color="#818cf8" />
              </div>
              <div className="mono" style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>No messages yet. Start a conversation.</div>
              <div style={{ fontSize: '0.85rem' }}>Ask a question, run a tool, or attach a file to start.</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.55rem', justifyContent: 'center' }}>
                {['Run a web search', 'List active agents', 'Summarize memory'].map((suggestion) => (
                  <button
                    key={suggestion}
                    className="btn-ghost"
                    onClick={() => setInput(suggestion)}
                    style={{ border: '1px solid rgba(255,255,255,0.12)', padding: '0.45rem 0.65rem', fontSize: '0.76rem' }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message, index) => (
              <MessageCard 
                key={`${message.role}-${index}`} 
                message={message} 
                agents={agents}
                onEdit={handleEdit}
                onRegenerate={handleRegenerate}
                onViewDocument={setActiveDocumentId}
                onCorrectIntent={(intent, messageId) => {
                  if (messageId) {
                    void handleRegenerate(messageId, { intent });
                    return;
                  }
                  setPendingNluOverride({ intent });
                  setControlMessage(`Next request will use intent:${intent}.`);
                }}
                onUseSecondaryIntent={(intent, originalContent) => {
                  if (input.trim() && !window.confirm('Replace your current draft with the original message?')) {
                    composerRef.current?.focus();
                    return;
                  }
                  setInput(originalContent || '');
                  setPendingNluOverride({ intent });
                  if (activeSelection) setActiveSelection(null);
                  setControlMessage(`Composer prepared with intent:${intent}.`);
                  setTimeout(() => composerRef.current?.focus(), 0);
                }}
                onTryClarificationAgain={(content) => {
                  setInput(content || '');
                  setPendingNluOverride(null);
                  setActiveSelection(null);
                }}
                messageAnchorId={message.role === 'assistant' ? `assistant-message-${index}` : undefined}
                previousUserQuery={index > 0 && messages[index-1].role === 'user' ? messages[index-1].content : ''}
              />
            ))
          )}
        </div>

        <div style={{ paddingTop: '0.45rem', marginTop: '0.45rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          {selectedAgent ? (
            <div style={{ marginBottom: '0.45rem', color: 'var(--text-secondary)', fontSize: '0.78rem' }}>
              Active agent: <strong>{selectedAgent.name}</strong>
              {selectedAgent.promptPackId ? <span className="mono" style={{ marginLeft: '0.45rem', color: 'var(--text-muted)' }}>pack:{selectedAgent.promptPackId}</span> : null}
            </div>
          ) : null}
          {agentsError ? (
            <div style={{ marginBottom: '0.45rem', color: 'var(--error)', fontSize: '0.78rem' }}>
              {agentsError}
            </div>
          ) : null}
          {pendingNluOverride ? (
            <div style={{ marginBottom: '0.45rem', color: 'var(--neon-cyan)', fontSize: '0.78rem' }}>
              Next turn intent override: <strong>{pendingNluOverride.intent}</strong>
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

          {controlMessage ? (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 12px',
              marginBottom: '8px',
              background: 'rgba(0, 240, 255, 0.08)',
              border: '1px solid rgba(0, 240, 255, 0.2)',
              borderRadius: '8px',
              color: 'var(--neon-cyan)',
              fontSize: '0.82rem',
            }}>
              <span>{controlMessage}</span>
              <button
                onClick={() => setControlMessage(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', display: 'flex', padding: 0 }}
              >
                <FiX size={14} />
              </button>
            </div>
          ) : null}

          {activeControlChips.length > 0 ? (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {activeControlChips.map((chip) => (
                <span
                  key={chip}
                  className="mono"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(129, 140, 248, 0.12)',
                    border: '1px solid rgba(129, 140, 248, 0.24)',
                    padding: '4px 10px',
                    borderRadius: '999px',
                    fontSize: '0.74rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {chip}
                </span>
              ))}
            </div>
          ) : null}

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', position: 'relative' }}>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={async (e) => {
                await handleAttachmentSelection(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => setShowComposerMenu((current) => !current)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                width: '44px',
                height: '44px',
                background: showComposerMenu ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255,255,255,0.05)',
                border: '1px solid var(--border-glass)',
              }}
              title="Chat controls"
            >
              <FiPlus size={20} />
            </button>
            {showComposerMenu ? (
              <div style={{
                position: 'absolute',
                left: 0,
                bottom: 'calc(100% + 10px)',
                width: 'min(340px, calc(100vw - 32px))',
                maxHeight: 'min(68vh, 520px)',
                overflowY: 'auto',
                padding: '0.72rem',
                borderRadius: '14px',
                border: '1px solid var(--border-glass)',
                background: 'rgba(10, 10, 18, 0.96)',
                backdropFilter: 'blur(18px)',
                boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
                zIndex: 30,
                display: 'grid',
                gap: '0.62rem',
              }}>
                <button
                  className="btn-ghost"
                  onClick={() => fileInputRef.current?.click()}
                  style={{ justifyContent: 'flex-start', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.55rem 0.7rem', fontSize: '0.82rem' }}
                >
                  <FiFileText size={15} />
                  Add photos & files
                </button>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', padding: '0.15rem 0.1rem', fontSize: '0.84rem' }}>
                  <span>Plan mode</span>
                  <input
                    type="checkbox"
                    checked={chatControls.planMode || false}
                    onChange={(event) => updateChatControls({ planMode: event.target.checked })}
                  />
                </label>
                <div style={{ display: 'grid', gap: '0.35rem' }}>
                  <label className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Web mode</label>
                  <select
                    value={chatControls.preferredWebMode || 'auto'}
                    onChange={(event) => updateChatControls({ preferredWebMode: event.target.value as PreferredWebMode })}
                    style={compactControlFieldStyle}
                  >
                    <option value="auto">Auto</option>
                    <option value="search">Search</option>
                    <option value="read_page">Read page</option>
                    <option value="browser">Browser / live UI</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gap: '0.35rem' }}>
                  <label className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Tool use</label>
                  <select
                    value={chatControls.toolUseMode || 'auto'}
                    onChange={(event) => updateChatControls({ toolUseMode: event.target.value as ToolUseMode })}
                    style={compactControlFieldStyle}
                  >
                    <option value="auto">Auto</option>
                    <option value="limited">Limited</option>
                    <option value="manual">Manual confirmation</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gap: '0.35rem' }}>
                  <label className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Permissions</label>
                  <select
                    value={chatControls.permissionMode || 'workspace_default'}
                    onChange={(event) => updateChatControls({ permissionMode: event.target.value as PermissionMode })}
                    style={compactControlFieldStyle}
                  >
                    <option value="workspace_default">Workspace default</option>
                    <option value="allow_safe_tools">Allow safe tools</option>
                    <option value="ask_every_time">Ask every time</option>
                  </select>
                </div>
                <div style={{ display: 'grid', gap: '0.45rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Plugins</label>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{(chatControls.selectedPlugins || []).length} selected</span>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
                    {availablePluginBundles.length > 0 ? availablePluginBundles.map((plugin) => {
                      const selected = (chatControls.selectedPlugins || []).includes(plugin);
                      return (
                        <button
                          key={plugin}
                          type="button"
                          onClick={() => updateChatControls({
                            selectedPlugins: toggleSelectedValue(chatControls.selectedPlugins, plugin),
                          })}
                          style={{
                            border: selected ? '1px solid rgba(0, 240, 255, 0.35)' : '1px solid var(--border-glass)',
                            background: selected ? 'rgba(0, 240, 255, 0.08)' : 'rgba(255,255,255,0.03)',
                            borderRadius: '999px',
                            padding: '0.38rem 0.7rem',
                            color: 'var(--text-primary)',
                            cursor: 'pointer',
                            fontSize: '0.76rem',
                          }}
                        >
                          {plugin}
                        </button>
                      );
                    }) : (
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>No plugin bundles discovered yet.</div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'grid', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label className="mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Tool selection</label>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{(chatControls.selectedTools || []).length} selected</span>
                  </div>
                  {(['built_in', 'mcp', 'plugin'] as const).map((groupKey) => {
                    const groupTools = toolGroups[groupKey];
                    if (!groupTools.length) return null;
                    const groupLabel = groupKey === 'built_in' ? 'Built-in' : groupKey === 'mcp' ? 'MCP' : 'Plugin-provided';
                    return (
                      <div key={groupKey} style={{ display: 'grid', gap: '0.3rem' }}>
                        <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{groupLabel}</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                          {groupTools.map((tool) => {
                            const selected = (chatControls.selectedTools || []).includes(tool.name);
                            return (
                              <button
                                key={tool.name}
                                type="button"
                                onClick={() => updateChatControls({
                                  selectedTools: toggleSelectedValue(chatControls.selectedTools, tool.name),
                                })}
                                style={{
                                  border: selected ? '1px solid rgba(129, 140, 248, 0.35)' : '1px solid var(--border-glass)',
                                  background: selected ? 'rgba(129, 140, 248, 0.1)' : 'rgba(255,255,255,0.03)',
                                  borderRadius: '999px',
                                  padding: '0.35rem 0.65rem',
                                  color: 'var(--text-primary)',
                                  cursor: 'pointer',
                                  fontSize: '0.72rem',
                                }}
                                title={tool.description}
                              >
                                {tool.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', alignItems: 'stretch', marginTop: '0.1rem' }}>
                  <button
                    className="btn-ghost"
                    onClick={() => {
                      updateChatControls(workspaceDefaults);
                      setShowComposerMenu(false);
                    }}
                    style={{ minHeight: '44px', padding: '0.55rem 0.7rem', fontSize: '0.76rem', lineHeight: 1.25 }}
                  >
                    Reset defaults
                  </button>
                  <button
                    className="btn-primary"
                    onClick={() => void saveCurrentControlsAsWorkspaceDefaults()}
                    style={{ minHeight: '44px', padding: '0.55rem 0.7rem', fontSize: '0.76rem', lineHeight: 1.25 }}
                  >
                    Save defaults
                  </button>
                </div>
              </div>
            ) : null}
            <div style={{ flex: 1, position: 'relative' }}>
              <textarea
                ref={composerRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                rows={1}
                placeholder="Ask RawClaw to search, browse, run tools, or reason through a task..."
                style={{
                  ...fieldStyle,
                  resize: 'vertical',
                  minHeight: '44px',
                  padding: '0.68rem 0.85rem 1.35rem',
                  lineHeight: 1.35,
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="mono" style={{ position: 'absolute', right: '0.75rem', bottom: '0.45rem', fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                {currentInputCount} chars / ~{currentTokenEstimate} tok
              </div>
            </div>
            {sending ? (
              <button 
                className="btn-primary" 
                onClick={stopGeneration}
                style={{ background: 'var(--error-glow)', borderColor: 'var(--error)', minHeight: '44px', padding: '0 0.95rem' }}
              >
                Stop
              </button>
            ) : (
              <button className={`btn-primary ${input.trim() ? 'send-pulse' : ''}`} onClick={() => void send()} disabled={sending || !input.trim()} style={{ minHeight: '44px', padding: '0 0.95rem' }}>
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

        {showTasks && (
          <aside
            className="glass-card task-sidebar-float"
            style={{
              width: '320px',
              display: 'flex',
              flexDirection: 'column',
              borderLeft: '1px solid var(--border-glass)',
              background: 'rgba(8, 8, 14, 0.8)',
              backdropFilter: 'blur(20px)',
              marginLeft: '-1rem',
              height: '100%',
              maxHeight: '100%',
              zIndex: 10,
              overflow: 'hidden'
            }}
          >
            <div style={{ 
              padding: '1.2rem', 
              borderBottom: '1px solid var(--border-glass)', 
              display: 'flex', 
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                <FiActivity style={{ color: 'var(--neon-cyan)' }} />
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Background Runs</h3>
              </div>
              <button 
                onClick={() => setShowTasks(false)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <FiX size={18} />
              </button>
            </div>
            <TaskRunPanel runs={recentRuns} currentSessionId={sessionId} onRefresh={refreshPoller} />
          </aside>
        )}

        {activeDocumentId && (
          <div id="document-canvas-container">
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
                  return parseEditSuggestion(lastMsg.content).suggestion;
                })()
              }
              onAcceptEdit={() => {
                // In a real app we'd save this to the backend
                // For now we just dismiss the selection
                setActiveSelection(null);
              }}
              onRejectEdit={() => setActiveSelection(null)}
            />
          </div>
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
                  startOffset: activeSelection.startOffset,
                  endOffset: activeSelection.endOffset,
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

export function getErrorMessage(type: string): string {
  switch (type) {
    case 'stream_failed':
      return 'Something went wrong while sending the response. Your message was received - please try again.';
    case 'agent_unavailable':
      return 'Agent Service Unavailable';
    case 'agent_error':
      return 'Agent Error';
    case 'model_unavailable':
      return 'Model Unavailable';
    case 'mcp_unavailable':
      return 'Tool System Unavailable';
    case 'tool_failed':
      return 'Tool Execution Failed';
    case 'stream_interrupted':
      return 'Stream Interrupted';
    case 'stream_timeout':
    case 'execution_timeout':
      return 'Execution Timed Out';
    case 'turn_limit_reached':
    case 'sequential_thinking_limit_reached':
      return 'Reasoning Limit Reached';
    case 'auth_failure':
      return 'Authentication Failed';
    case 'provider_routing_failed':
      return 'Model Routing Failed';
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

function memoryDetailLabel(event: MemoryEvent): string {
  return `${event.layer}: ${event.summary}`;
}

export function MessageCard({ 
  message, 
  agents,
  onEdit, 
  onRegenerate,
  onViewDocument,
  onCorrectIntent,
  onUseSecondaryIntent,
  onTryClarificationAgain,
  messageAnchorId,
  previousUserQuery
}: { 
  message: SessionMessage; 
  agents: AgentProfile[];
  onEdit: (id: string, content: string) => void;
  onRegenerate: (id: string) => void;
  onViewDocument: (id: string) => void;
  onCorrectIntent: (intent: ChatNluIntent, messageId?: string) => void;
  onUseSecondaryIntent: (intent: ChatNluIntent, originalContent: string) => void;
  onTryClarificationAgain: (content: string) => void;
  messageAnchorId?: string;
  previousUserQuery?: string;
}) {
  const isUser = message.role === 'user';
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showThinking, setShowThinking] = useState(true);
  const [showMemoryDetails, setShowMemoryDetails] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [expanded, setExpanded] = useState(false);
  const activityFrame = !isUser ? message.coworkerActivityFrame : undefined;
  const isLongResponse = !isUser && ((message.content?.length || 0) > 1400 || (message.content?.split('\n').length || 0) > 18);
  const secondaryIntents = [...(message.workflowState?.nlu?.secondaryIntents || [])]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);
  const sourceAgentLabel = !isUser
    ? activityFrame?.source.agentLabel || resolveAgentLabel(message.sourceChipAgentId || message.agentId, agents) || 'RawClaw'
    : null;
  const sourceModelLabel = !isUser
    ? activityFrame?.source.modelLabel || modelShortName(message.sourceChipModelId || message.modelId)
    : null;
  const assistantAccent = !isUser ? resolveAgentAccent(message.sourceChipAgentId || message.agentId || 'main') : '#22d3ee';
  const memorySummary = !isUser
    ? summarizeMemoryEvents(message.memoryEvents) || (message.memoryRecall ? 'Used memory' : null)
    : null;
  const visibleToolResults = !isUser ? (message.toolResults || []).filter((result) => isUserFacingToolResult(result)) : [];
  const searchAttemptMeta = !isUser ? buildSearchAttemptMeta(visibleToolResults) : [];
  const isInterruptedMessage = !isUser && (
    message.streamStatus === 'incomplete'
    || message.error?.type === 'stream_interrupted'
    || Boolean(message.retryState)
  );
  const interruptedDetails = message.error
    ? message.error.message + (message.error.details ? `\n${message.error.details}` : '')
    : 'Connection interrupted before the response finished.';

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
    <div id={messageAnchorId} className="message-bubble" style={{ display: 'grid', gap: '0.65rem', justifyItems: isUser ? 'end' : 'start', position: 'relative' }}>
      <div
        className={`${isUser ? 'user-bubble' : 'assistant-bubble'} message-surface`}
        style={{
          maxWidth: '820px',
          padding: '1.25rem',
          border: `1px solid ${isUser ? 'rgba(34,211,238,0.18)' : hexToRgba(assistantAccent, 0.24)}`,
          borderLeft: `3px solid ${isUser ? 'rgba(34,211,238,0.9)' : assistantAccent}`,
          position: 'relative',
          background: isUser ? 'rgba(34,211,238,0.04)' : hexToRgba(assistantAccent, 0.05)
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.45rem', gap: '1rem', flexWrap: 'wrap' }}>
          <div className="mono" style={{ fontSize: '0.65rem', color: isUser ? 'var(--neon-cyan)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', width: 22, height: 22, alignItems: 'center', justifyContent: 'center', border: `1px solid ${isUser ? 'rgba(34,211,238,0.35)' : hexToRgba(assistantAccent, 0.35)}`, background: isUser ? 'rgba(34,211,238,0.08)' : hexToRgba(assistantAccent, 0.12) }}>
              {isUser ? <FiUser size={12} /> : <FiCpu size={12} />}
            </span>
            {isUser ? 'USER' : 'RAWCLAW'}
            {!isUser && sourceAgentLabel ? (
              <span
                className="mono"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.65rem',
                  color: assistantAccent,
                  background: hexToRgba(assistantAccent, 0.12),
                  padding: '2px 8px',
                  borderRadius: '10px',
                  border: `1px solid ${hexToRgba(assistantAccent, 0.28)}`,
                }}
              >
                {sourceModelLabel ? (
                  message.isLocal ? <FiHome size={10} /> : <FiGlobe size={10} />
                ) : null}
                {sourceAgentLabel}
                {sourceModelLabel ? <span style={{ opacity: 0.75 }}>| {sourceModelLabel}</span> : null}
                {message.durationMs ? (
                  <span style={{ marginLeft: '0.3rem', opacity: 0.6, borderLeft: '1px solid currentColor', paddingLeft: '0.4rem' }}>
                    {(message.durationMs / 1000).toFixed(1)}s
                  </span>
                ) : null}
              </span>
            ) : null}
            <span style={{ opacity: 0.5, fontWeight: 400 }}>{formatTime(message.createdAt)}</span>
          </div>

          {!isUser && (memorySummary || message.workflowState?.assistantLane || message.workflowState?.confidenceState || message.workflowState?.nlu) ? (
            <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {memorySummary ? (
                message.memoryEvents?.length ? (
                  <button
                    type="button"
                    onClick={() => setShowMemoryDetails((current) => !current)}
                    style={{
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
                      letterSpacing: '0.02em',
                      cursor: 'pointer',
                    }}
                    title="Show memory details"
                  >
                    <FiDatabase size={10} />
                    {memorySummary}
                  </button>
                ) : (
                  <span
                    style={{
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
                      letterSpacing: '0.02em',
                    }}
                  >
                    <FiDatabase size={10} />
                    {memorySummary}
                  </span>
                )
              ) : null}
              {message.workflowState?.nlu && (
                <span className="mono" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.65rem',
                  color: message.workflowState.nlu.clarificationFailed ? '#fca5a5' : 'var(--neon-cyan)',
                  background: message.workflowState.nlu.clarificationFailed ? 'rgba(248,113,113,0.08)' : 'rgba(0,240,255,0.08)',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  border: message.workflowState.nlu.clarificationFailed ? '1px solid rgba(248,113,113,0.25)' : '1px solid rgba(0,240,255,0.2)',
                }}>
                  intent:{message.workflowState.nlu.intent === 'code_help' ? 'code' : message.workflowState.nlu.intent}
                </span>
              )}
              {message.workflowState?.nlu && (
                <select
                  aria-label="Correct intent"
                  value=""
                  onChange={(event) => {
                    const value = event.target.value as ChatNluIntent;
                    if (value) {
                      onCorrectIntent(value, message.id);
                      event.currentTarget.value = '';
                    }
                  }}
                  style={{
                    fontSize: '0.65rem',
                    color: 'var(--text-secondary)',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid var(--border-glass)',
                    borderRadius: 10,
                    padding: '2px 6px',
                  }}
                >
                  <option value="">Correct</option>
                  {NLU_CORRECTION_OPTIONS.map((option) => (
                    <option key={option.intent} value={option.intent}>{option.label}</option>
                  ))}
                </select>
              )}
              {message.workflowState?.assistantLane && (
                <span className="mono" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.65rem',
                  color: 'var(--neon-cyan)',
                  background: 'rgba(0,240,255,0.08)',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  border: '1px solid rgba(0,240,255,0.2)',
                }}>
                  lane:{message.workflowState.assistantLane}
                </span>
              )}
              {message.workflowState?.confidenceState && (
                <span className="mono" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.65rem',
                  color: 'var(--text-secondary)',
                  background: 'rgba(255,255,255,0.05)',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-glass)',
                }}>
                  confidence:{message.workflowState.confidenceState}
                </span>
              )}
              {message.workflowState?.nlu ? (
                <span className="mono" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.65rem',
                  color: 'var(--text-secondary)',
                  background: 'rgba(255,255,255,0.05)',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-glass)',
                }}>
                  nlu:{message.workflowState.nlu.confidenceState}/{message.workflowState.nlu.confidence.toFixed(2)}
                </span>
              ) : null}
              {message.workflowState?.nlu?.entities?.length ? (
                <span className="mono" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.3rem',
                  fontSize: '0.65rem',
                  color: 'var(--text-secondary)',
                  background: 'rgba(255,255,255,0.05)',
                  padding: '2px 8px',
                  borderRadius: '10px',
                  border: '1px solid var(--border-glass)',
                }}>
                  entities:{message.workflowState.nlu.entities.length}
                </span>
              ) : null}
              {message.workflowState?.nlu?.clarificationFailed ? (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => onTryClarificationAgain(previousUserQuery || '')}
                  style={{ fontSize: '0.65rem', padding: '2px 8px', borderRadius: 10 }}
                >
                  Try again
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {!isUser && secondaryIntents.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.65rem' }}>
            {secondaryIntents.map((item) => (
              <button
                key={`${item.intent}-${item.confidence}`}
                type="button"
                className="btn-ghost"
                onClick={() => onUseSecondaryIntent(item.intent, previousUserQuery || '')}
                style={{ fontSize: '0.68rem', padding: '0.28rem 0.55rem', borderRadius: 10 }}
                title="Prepare the original message with this intent"
              >
                Try as {item.intent === 'code_help' ? 'code' : item.intent} ({item.confidence.toFixed(2)})
              </button>
            ))}
          </div>
        ) : null}

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
          <div style={{ display: 'grid', gap: '1rem' }}>
            {message.thinking && (
              <div style={{ marginBottom: '0.8rem' }}>
                <button
                  onClick={() => setShowThinking(!showThinking)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    background: 'rgba(0, 240, 255, 0.05)',
                    border: '1px solid rgba(0, 240, 255, 0.1)',
                    borderRadius: '8px',
                    padding: '6px 12px',
                    color: 'var(--neon-cyan)',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    marginBottom: showThinking ? '0.5rem' : '0'
                  }}
                >
                  <FiCpu size={14} className={message.content ? '' : 'spin'} />
                  <span>{message.content ? 'Reasoning' : 'Thinking...'}</span>
                  {showThinking ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
                </button>
                
                {showThinking && (
                  <div style={{
                    background: 'rgba(0, 0, 0, 0.2)',
                    borderRadius: '10px',
                    padding: '1rem',
                    fontSize: '0.9rem',
                    color: 'var(--text-secondary)',
                    borderLeft: '2px solid var(--neon-cyan)',
                    maxHeight: '400px',
                    overflowY: 'auto',
                    fontStyle: 'italic',
                    lineHeight: 1.6
                  }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {message.thinking}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            )}

            {message.provenanceTrace?.steps?.length ? (
              <InitialAnalysisCard 
                trace={message.provenanceTrace} 
                query={previousUserQuery || 'Processing request...'} 
              />
            ) : null}
            
            {message.content ? (
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, maxWidth: '720px' }}>
                {(() => {
                  const { suggestion, textContent } = parseEditSuggestion(message.content);
                  if (suggestion) {
                    return (
                      <>
                        <div className="markdown-content" style={{ maxHeight: isLongResponse && !expanded ? '24rem' : 'none', overflow: 'hidden', position: 'relative' }}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {textContent}
                          </ReactMarkdown>
                        </div>
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
                          Document Edit Suggested - Preview above
                        </div>
                      </>
                    );
                  }
                  return (
                    <div className="markdown-content" style={{ maxHeight: isLongResponse && !expanded ? '24rem' : 'none', overflow: 'hidden', position: 'relative' }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  );
                })()}
                {isLongResponse && (
                  <button
                    onClick={() => setExpanded((current) => !current)}
                    style={{
                      marginTop: '0.75rem',
                      border: 'none',
                      background: 'none',
                      color: 'var(--neon-cyan)',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: '0.82rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.35rem'
                    }}
                  >
                    {expanded ? 'Show less ↑' : 'Show more ↓'}
                  </button>
                )}
              </div>
            ) : !message.error ? (
              <div style={{ display: 'grid', gap: '0.75rem', color: 'var(--neon-cyan)', opacity: 0.9, minWidth: '340px' }}>
                <div className="shimmer-block" style={{ height: '1rem', width: '58%' }} />
                <div className="shimmer-block" style={{ height: '1rem', width: '92%' }} />
                <div className="shimmer-block" style={{ height: '1rem', width: '76%' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </div>
                  <span style={{ fontSize: '0.9rem', fontStyle: 'italic' }}>
                    {message.approvalRequired
                      ? 'Waiting for approval...'
                      : message.tool_calls && message.tool_calls.length > 0
                        ? `Running tool: ${message.tool_calls[message.tool_calls.length - 1]?.name || 'tool'}...`
                        : message.isDeepResearch
                          ? 'Deep Researching...'
                          : 'RawClaw is thinking...'}
                  </span>
                </div>
              </div>
            ) : null}
            {!isUser && message.content && isInterruptedMessage ? (
              <InterruptedBanner
                details={interruptedDetails}
                isRetrying={message.retryState?.mode === 'retrying'}
                attempt={message.retryState?.attempt}
                maxAttempts={message.retryState?.maxAttempts}
                onRetry={message.retryState?.mode !== 'retrying' && message.id ? () => onRegenerate(message.id!) : undefined}
              />
            ) : null}
          </div>
        )}

        {!isUser && message.tool_calls && message.tool_calls.length > 0 && (
          <div style={{ marginTop: '0.8rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {message.tool_calls.map((toolCall, index) => (
              <div
                key={`${toolCall?.name || 'tool'}-${index}`}
                style={{
                  padding: '6px 10px',
                  borderRadius: '999px',
                  background: 'rgba(0, 240, 255, 0.05)',
                  border: '1px solid rgba(0, 240, 255, 0.12)',
                  color: 'var(--neon-cyan)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                }}
              >
                Tool: {toolCall?.name || 'unknown'}
              </div>
            ))}
          </div>
        )}

        {message.harnessLogs && message.harnessLogs.length > 0 && !message.content && (
          <div style={{ 
            marginTop: '0.8rem', 
            padding: '10px 14px', 
            background: 'rgba(0, 240, 255, 0.05)', 
            border: '1px solid rgba(0, 240, 255, 0.1)',
            borderRadius: '8px',
            fontSize: '0.8rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--neon-cyan)', marginBottom: '4px' }}>
              <FiActivity className="spin" size={14} />
              <span style={{ fontWeight: 600 }}>Orchestration Harness</span>
            </div>
            {message.harnessLogs.map((log, i) => (
              <div key={i} style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginLeft: '22px' }}>
                • {log.step === 'preparing' ? `Preparing ${log.tool}...` : `${log.tool}: ${log.message || log.step}`}
              </div>
            ))}
          </div>
        )}

        {message.approvalRequired && (
          <div style={{ 
            marginTop: '1rem', 
            padding: '12px 16px', 
            background: 'rgba(255, 165, 0, 0.1)', 
            border: '1px solid var(--warning)',
            borderRadius: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--warning)', fontWeight: 600 }}>
              <FiShield size={16} />
              <span>Authorization Required</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
              {message.approvalRequired.reason}
            </p>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Complexity: <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{message.approvalRequired.complexity || 'High'}</span>
            </div>
          </div>
        )}

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

      {!message.content && message.error ? (
        <ErrorCard 
          type={message.error.type}
          message={getErrorMessage(message.error.type)}
          details={message.error.message + (message.error.details ? `\n${message.error.details}` : '')}
          onRetry={!isUser && message.id ? () => onRegenerate(message.id!) : undefined}
        />
      ) : null}

      {!isUser && visibleToolResults.length > 0 ? (
        <div style={{ width: '100%', display: 'grid', gap: '0.8rem' }}>
          {visibleToolResults.map((result, index) => (
            <ToolResultRenderer key={`${result.tool_name}-${index}`} result={result} attemptMeta={searchAttemptMeta[index] || undefined} />
          ))}
        </div>
      ) : null}

      {!isUser ? <WorkStoryCard message={message} /> : null}

      {!isUser && showMemoryDetails && message.memoryEvents && message.memoryEvents.length > 0 ? (
        <div style={{ width: '100%', display: 'grid', gap: '0.75rem' }}>
          <div style={{ border: '1px solid var(--border-glass)', borderRadius: '12px', padding: '0.8rem', background: 'rgba(255,255,255,0.03)' }}>
            <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: '0.45rem' }}>
              MEMORY DETAILS
            </div>
            <div style={{ display: 'grid', gap: '0.35rem' }}>
              {message.memoryEvents.map((event, index) => (
                <div key={`memory-${index}`} style={{ color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.5 }}>
                  - {memoryDetailLabel(event)}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {!isUser && message.provenanceTrace ? <ProvenanceTrace trace={message.provenanceTrace} /> : null}
    </div>
  );
}

export function ToolResultRenderer({
  result,
  attemptMeta,
}: {
  result: ToolResult;
  attemptMeta?: { attempt: number; total: number } | null;
}) {
  const name = result.tool_name.toLowerCase();
  let details: React.ReactNode;
  if (name.includes('search')) details = <WebSearchResult result={result} framed={false} />;
  else if (name.includes('browser') || name.includes('fetch') || name.includes('navigate') || name.includes('extract')) details = <BrowserResult result={result} framed={false} />;
  else if (name.includes('file')) details = <FileResult result={result} framed={false} />;
  else if (name.includes('python') || name.includes('code')) details = <CodeResult result={result} framed={false} />;
  else if (name.includes('shell') || name.includes('terminal') || name.includes('bash') || name.includes('command')) {
    details = <TerminalResult result={result} framed={false} />;
  } else {
    details = <GenericToolCard result={result} framed={false} />;
  }

  const sourceLabel = attemptMeta && name.includes('search')
    ? `Web Search - Attempt ${attemptMeta.attempt}/${attemptMeta.total}`
    : undefined;

  return <ToolResultCard result={result} sourceLabel={sourceLabel}>{details}</ToolResultCard>;
}

export function formatTime(date?: string | Date) {
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
}

const fieldStyle = {
  width: '100%',
  padding: '0.8rem 0.9rem',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
};

const compactControlFieldStyle = {
  ...fieldStyle,
  padding: '0.58rem 0.72rem',
  borderRadius: '10px',
  fontSize: '0.84rem',
  minHeight: '42px',
};

function cryptoRandom() {
  // Generate a premium-looking hex identifier instead of generic 'session-'
  const array = new Uint32Array(2);
  crypto.getRandomValues(array);
  return `rc-${array[0].toString(16)}-${array[1].toString(16).slice(0, 4)}`;
}
