# Transformer Pipeline Integrity Spec

This document is snapshot-verified against `packages/shared/src/contracts/transformer-pipeline.ts`.

| Boundary | Status | Input Contract | Output Contract | Must Not Do | Acceptance Tests | Owner | Replacement Target |
| --- | --- | --- | --- | --- | --- | --- | --- |
| intake | in-progress | ChatRequest + latest user message + selection + attachments + ChatNluFrame | IntakeEnvelope + RetrievalPolicy + optional IntakeRejection | reject_valid_multilingual_input<br>silently_truncate_user_input<br>broaden_retrieval_beyond_declared_policy | `intake-memory-query-policy`<br>`intake-conversation-no-retrieval`<br>`intake-hybrid-memory-web-policy`<br>`intake-multilingual-valid-input`<br>`intake-oversize-rejection` | platform-chat | chat-orchestrator.service.ts + executor.py conversational retrieval heuristics |

### intake
- Token estimator fallback is character-budget based when unavailable.
- Agent-side invariant checker may only enforce supplied policy.

| context | planned-v2 | Full turn history with IDs + context budget metadata | ContextEnvelope + ContextSummaryBlock + optional ContextCompactionError | drop_open_commitments<br>drop_named_entities<br>drop_unresolved_questions<br>replace_structured_summary_with_freeform_blob | `context-compaction-preserves-active-state`<br>`context-compaction-reduces-size`<br>`context-no-short-session-compaction` | platform-chat | chat-orchestrator.service.ts budgetContext truncation heuristics |

### context
- Resolution rule: a turn is resolved when the next user turn does not contain a follow-up question, correction, or reference to unresolved prior content.
- V1 is extractive and structured only; no LLM summarization pass.

| execution | v1-live | HumanTurnEnvelope + CanonicalIntentFrame + tool results + review/memory signals | ExecutionIntent + AssistantResponseEnvelope + CoworkerActivityFrame + TransformTrace | hide_degraded_state<br>upgrade_response_to_grounded_without_evidence | `execution-direct-empty-evidence-clean`<br>`execution-grounded-failed-evidence-partial` | platform-chat | Legacy inline chat metadata and render-state derivation |

### execution
- V1 agent timing coverage is model_execution only.

| emission | in-progress | Internal chat stream event payloads | Client-visible ChatStreamChunk payloads + optional EmissionFailure | change_semantic_meaning<br>invent_or_remove_citations<br>leak_internal_only_fields | `emission-markdown-regression-fixtures`<br>`emission-stream-allowlist`<br>`emission-preserve-meaning-control-fixtures` | platform-chat | Inline sanitizeAssistantContentChunk and direct SSE payload writes in chat-orchestrator.service.ts |
| persistence | in-progress | Final assistant turn state + CoworkerActivityFrame + TransformTrace + workflow metadata | PersistenceEnvelope + optional PersistenceError | alter_assistant_content<br>repair_degraded_state_during_persistence<br>persist_replay_shape_that_differs_from_live_frame | `persistence-frame-replay-parity`<br>`persistence-degraded-visual-parity`<br>`persistence-no-content-healing` | platform-chat | End-of-turn persistence block in chat-orchestrator.service.ts |
