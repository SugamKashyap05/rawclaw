import type { ChatStreamChunkType } from './chat';

export type TransformerBoundaryName = 'intake' | 'context' | 'execution' | 'emission' | 'persistence';
export type TransformerLifecycleStatus = 'v1-live' | 'planned-v2' | 'stub' | 'in-progress';

export interface TransformerOwner {
  contractOwner: string;
  runtimeOwner: string;
  rolloutOwner: string;
  ciSuite: string;
}

export interface TransformerAcceptanceCase {
  id: string;
  kind: 'positive' | 'negative';
  description: string;
  testSuite: string;
  testCaseId: string;
}

export interface TransformerDescriptor {
  name: TransformerBoundaryName;
  status: TransformerLifecycleStatus;
  purpose: string;
  inputContract: string;
  outputContract: string;
  owner: TransformerOwner;
  replacementTarget: string;
  forbiddenBehaviors: string[];
  acceptanceCases: TransformerAcceptanceCase[];
  rolloutDependency?: string | null;
  notes?: string[];
}

export type TransformerRegistryModule = {
  COVERED_ACCEPTANCE_CASE_IDS: string[];
};

export const TRANSFORMER_TEST_REGISTRIES: Record<TransformerBoundaryName, string> = {
  emission: 'apps/api/src/transformer-acceptance/emission.acceptance-registry.ts',
  intake: 'apps/api/src/transformer-acceptance/intake.acceptance-registry.ts',
  persistence: 'apps/api/src/transformer-acceptance/persistence.acceptance-registry.ts',
  context: 'apps/api/src/transformer-acceptance/context.acceptance-registry.ts',
  execution: 'apps/api/src/transformer-acceptance/execution.acceptance-registry.ts',
};

export const CLIENT_VISIBLE_STREAM_FIELDS: Record<ChatStreamChunkType, readonly string[]> = {
  content: ['type', 'content'],
  thinking: ['type', 'thinking'],
  tool_call: ['type', 'tool_call'],
  tool_result: ['type', 'tool_result'],
  sources: ['type', 'sources'],
  error: ['type', 'error', 'message', 'reason', 'correlationId'],
  done: ['type', 'reason', 'correlationId'],
  provenance: ['type', 'provenanceTrace'],
  metadata: ['type', 'metadata', 'correlationId'],
  review_result: ['type', 'approved', 'feedback', 'reviewer_id'],
  harness: ['type', 'harness_log'],
  approval_required: ['type', 'reason', 'message'],
  activity_frame: ['type', 'activityFrame'],
  heartbeat: ['type', 'ts', 'timestamp'],
};

export const CLIENT_VISIBLE_METADATA_FIELDS = [
  'modelId',
  'isLocal',
  'fallbacks',
  'memoryRecall',
  'durationMs',
  'runIds',
  'isDeepResearch',
  'nlu',
  'contextBudget',
  'correlationId',
] as const;

const DEFAULT_OWNER: TransformerOwner = {
  contractOwner: 'platform-chat',
  runtimeOwner: 'platform-chat',
  rolloutOwner: 'platform-ops',
  ciSuite: 'apps/api/src/transformer-pipeline.contracts.spec.ts',
};

export const TRANSFORMER_PIPELINE_DESCRIPTORS: TransformerDescriptor[] = [
  {
    name: 'intake',
    status: 'in-progress',
    purpose: 'Normalize inbound user turn input and derive retrieval policy before orchestrator tool routing.',
    inputContract: 'ChatRequest + latest user message + selection + attachments + ChatNluFrame',
    outputContract: 'IntakeEnvelope + RetrievalPolicy + optional IntakeRejection',
    owner: DEFAULT_OWNER,
    replacementTarget: 'chat-orchestrator.service.ts + executor.py conversational retrieval heuristics',
    forbiddenBehaviors: [
      'reject_valid_multilingual_input',
      'silently_truncate_user_input',
      'broaden_retrieval_beyond_declared_policy',
    ],
    acceptanceCases: [
      {
        id: 'intake-memory-query-policy',
        kind: 'positive',
        description: 'Summarize memory forbids web retrieval and requires memory retrieval.',
        testSuite: 'apps/api/src/intake-transformer.service.spec.ts',
        testCaseId: 'intake-memory-query-policy',
      },
      {
        id: 'intake-conversation-no-retrieval',
        kind: 'positive',
        description: 'Direct conversational greetings forbid web and memory retrieval.',
        testSuite: 'apps/api/src/intake-transformer.service.spec.ts',
        testCaseId: 'intake-conversation-no-retrieval',
      },
      {
        id: 'intake-hybrid-memory-web-policy',
        kind: 'positive',
        description: 'Hybrid memory plus live-web turns produce mixed-axis retrieval policy.',
        testSuite: 'apps/api/src/intake-transformer.service.spec.ts',
        testCaseId: 'intake-hybrid-memory-web-policy',
      },
      {
        id: 'intake-multilingual-valid-input',
        kind: 'negative',
        description: 'Valid multilingual conversational input must not be rejected or corrupted.',
        testSuite: 'apps/api/src/intake-transformer.service.spec.ts',
        testCaseId: 'intake-multilingual-valid-input',
      },
      {
        id: 'intake-oversize-rejection',
        kind: 'negative',
        description: 'Oversized intake payload is rejected with a typed IntakeRejection.',
        testSuite: 'apps/api/src/intake-transformer.service.spec.ts',
        testCaseId: 'intake-oversize-rejection',
      },
    ],
    notes: [
      'Token estimator fallback is character-budget based when unavailable.',
      'Agent-side invariant checker may only enforce supplied policy.',
    ],
  },
  {
    name: 'context',
    status: 'planned-v2',
    purpose: 'Compact long session history into a deterministic structured context envelope while preserving active state.',
    inputContract: 'Full turn history with IDs + context budget metadata',
    outputContract: 'ContextEnvelope + ContextSummaryBlock + optional ContextCompactionError',
    owner: DEFAULT_OWNER,
    replacementTarget: 'chat-orchestrator.service.ts budgetContext truncation heuristics',
    forbiddenBehaviors: [
      'drop_open_commitments',
      'drop_named_entities',
      'drop_unresolved_questions',
      'replace_structured_summary_with_freeform_blob',
    ],
    acceptanceCases: [
      {
        id: 'context-compaction-preserves-active-state',
        kind: 'positive',
        description: 'Compaction preserves open commitments, named entities, and unresolved questions.',
        testSuite: 'apps/api/src/context-transformer.service.spec.ts',
        testCaseId: 'context-compaction-preserves-active-state',
      },
      {
        id: 'context-compaction-reduces-size',
        kind: 'positive',
        description: 'Triggered compaction reduces estimated prompt size by at least 25 percent.',
        testSuite: 'apps/api/src/context-transformer.service.spec.ts',
        testCaseId: 'context-compaction-reduces-size',
      },
      {
        id: 'context-no-short-session-compaction',
        kind: 'negative',
        description: 'Short sessions do not compact.',
        testSuite: 'apps/api/src/context-transformer.service.spec.ts',
        testCaseId: 'context-no-short-session-compaction',
      },
    ],
    notes: [
      'Resolution rule: a turn is resolved when the next user turn does not contain a follow-up question, correction, or reference to unresolved prior content.',
      'V1 is extractive and structured only; no LLM summarization pass.',
    ],
  },
  {
    name: 'execution',
    status: 'v1-live',
    purpose: 'Normalize execution intent, evidence envelopes, coworker activity frames, and transform traces.',
    inputContract: 'HumanTurnEnvelope + CanonicalIntentFrame + tool results + review/memory signals',
    outputContract: 'ExecutionIntent + AssistantResponseEnvelope + CoworkerActivityFrame + TransformTrace',
    owner: DEFAULT_OWNER,
    replacementTarget: 'Legacy inline chat metadata and render-state derivation',
    forbiddenBehaviors: [
      'hide_degraded_state',
      'upgrade_response_to_grounded_without_evidence',
    ],
    acceptanceCases: [
      {
        id: 'execution-direct-empty-evidence-clean',
        kind: 'positive',
        description: 'Direct conversational replies with empty evidence remain clean.',
        testSuite: 'apps/api/src/chat-transformer.service.spec.ts',
        testCaseId: 'execution-direct-empty-evidence-clean',
      },
      {
        id: 'execution-grounded-failed-evidence-partial',
        kind: 'negative',
        description: 'Grounded replies with only failed evidence downgrade to partial instead of pretending success.',
        testSuite: 'apps/api/src/chat-transformer.service.spec.ts',
        testCaseId: 'execution-grounded-failed-evidence-partial',
      },
    ],
    notes: [
      'V1 agent timing coverage is model_execution only.',
    ],
  },
  {
    name: 'emission',
    status: 'in-progress',
    purpose: 'Normalize client-visible SSE events, sanitize malformed markdown, strip internal-only fields, and enforce stream payload allowlists.',
    inputContract: 'Internal chat stream event payloads',
    outputContract: 'Client-visible ChatStreamChunk payloads + optional EmissionFailure',
    owner: DEFAULT_OWNER,
    replacementTarget: 'Inline sanitizeAssistantContentChunk and direct SSE payload writes in chat-orchestrator.service.ts',
    forbiddenBehaviors: [
      'change_semantic_meaning',
      'invent_or_remove_citations',
      'leak_internal_only_fields',
    ],
    acceptanceCases: [
      {
        id: 'emission-markdown-regression-fixtures',
        kind: 'positive',
        description: 'Malformed markdown/list regression fixtures normalize into client-safe content.',
        testSuite: 'apps/api/src/emission-transformer.service.spec.ts',
        testCaseId: 'emission-markdown-regression-fixtures',
      },
      {
        id: 'emission-stream-allowlist',
        kind: 'positive',
        description: 'Outgoing SSE events are reduced to explicit client-visible fields.',
        testSuite: 'apps/api/src/emission-transformer.service.spec.ts',
        testCaseId: 'emission-stream-allowlist',
      },
      {
        id: 'emission-preserve-meaning-control-fixtures',
        kind: 'negative',
        description: 'Control fixtures preserve content meaning and citations.',
        testSuite: 'apps/api/src/emission-transformer.service.spec.ts',
        testCaseId: 'emission-preserve-meaning-control-fixtures',
      },
    ],
  },
  {
    name: 'persistence',
    status: 'in-progress',
    purpose: 'Persist normalized final turn state and replay it faithfully for audit and UI parity.',
    inputContract: 'Final assistant turn state + CoworkerActivityFrame + TransformTrace + workflow metadata',
    outputContract: 'PersistenceEnvelope + optional PersistenceError',
    owner: DEFAULT_OWNER,
    replacementTarget: 'End-of-turn persistence block in chat-orchestrator.service.ts',
    forbiddenBehaviors: [
      'alter_assistant_content',
      'repair_degraded_state_during_persistence',
      'persist_replay_shape_that_differs_from_live_frame',
    ],
    acceptanceCases: [
      {
        id: 'persistence-frame-replay-parity',
        kind: 'positive',
        description: 'Replayed sessions reconstruct the same coworker activity frame as the live session.',
        testSuite: 'apps/api/src/persistence-transformer.service.spec.ts',
        testCaseId: 'persistence-frame-replay-parity',
      },
      {
        id: 'persistence-degraded-visual-parity',
        kind: 'positive',
        description: 'Replayed degraded sessions preserve the same degraded UI state as the live session.',
        testSuite: 'apps/api/src/persistence-transformer.service.spec.ts',
        testCaseId: 'persistence-degraded-visual-parity',
      },
      {
        id: 'persistence-no-content-healing',
        kind: 'negative',
        description: 'Persistence errors never rewrite or repair assistant content.',
        testSuite: 'apps/api/src/persistence-transformer.service.spec.ts',
        testCaseId: 'persistence-no-content-healing',
      },
    ],
    rolloutDependency: 'Canary promotion beyond 5 percent',
  },
];

export function renderTransformerPipelineMarkdown(descriptors: TransformerDescriptor[]): string {
  const lines: string[] = [
    '# Transformer Pipeline Integrity Spec',
    '',
    'This document is snapshot-verified against `packages/shared/src/contracts/transformer-pipeline.ts`.',
    '',
    '| Boundary | Status | Input Contract | Output Contract | Must Not Do | Acceptance Tests | Owner | Replacement Target |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const descriptor of descriptors) {
    lines.push(
      `| ${descriptor.name} | ${descriptor.status} | ${descriptor.inputContract} | ${descriptor.outputContract} | ${descriptor.forbiddenBehaviors.join('<br>')} | ${descriptor.acceptanceCases.map((item) => `\`${item.id}\``).join('<br>')} | ${descriptor.owner.runtimeOwner} | ${descriptor.replacementTarget} |`,
    );
    if (descriptor.notes?.length) {
      lines.push('');
      lines.push(`### ${descriptor.name}`);
      for (const note of descriptor.notes) {
        lines.push(`- ${note}`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}
