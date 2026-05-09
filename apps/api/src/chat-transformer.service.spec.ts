import { ExecutionIntent, TRANSFORM_TRACE_V1_AGENT_TIMING_STAGES, TRANSFORM_TRACE_V2_PLANNED_AGENT_TIMING_STAGES } from '@rawclaw/shared';
import { ChatTransformerService } from './chat-transformer.service';

describe('ChatTransformerService', () => {
  let service: ChatTransformerService;

  beforeEach(() => {
    service = new ChatTransformerService();
  });

  it('treats direct conversational replies with empty evidence as clean', () => {
    const response = service.buildAssistantResponseEnvelope({
      content: 'Hey there.',
      assistantLane: 'conversation',
      evidence: [],
    });
    const frame = service.buildCoworkerActivityFrame({
      response,
      agentId: 'default-assistant',
      agentName: null,
      modelId: 'openai/gpt-4o',
      isLocal: false,
      lane: 'conversation',
      confidenceState: 'direct',
      fallbackReason: null,
    });

    expect(response.responseMode).toBe('direct');
    expect(frame.visibilityState).toBe('clean');
    expect(frame.source.agentLabel).toBe('RawClaw');
  });

  it('downgrades a rejected direct answer to abstain', () => {
    const response = service.buildAssistantResponseEnvelope({
      content: 'I think that should work.',
      assistantLane: 'conversation',
      evidence: [],
      reviewEvents: [{ approved: false, feedback: 'Too speculative.' }],
    });

    expect(response.reviewOutcome).toBe('rejected');
    expect(response.responseMode).toBe('abstain');
  });

  it('downgrades grounded answers with only failed evidence to partial when content exists', () => {
    const response = service.buildAssistantResponseEnvelope({
      content: 'I found one thin lead.',
      assistantLane: 'research',
      evidence: [
        {
          sourceType: 'search',
          status: 'failed',
          quality: 'unknown',
          toolName: 'web_search',
        },
      ],
    });

    expect(response.responseMode).toBe('partial');
  });

  it('builds a deterministic grounded work story', () => {
    const response = service.buildAssistantResponseEnvelope({
      content: 'The answer is ready.',
      assistantLane: 'research',
      evidence: [
        {
          sourceType: 'search',
          status: 'success',
          quality: 'strong',
          toolName: 'web_search',
          strongestSource: 'Election Commission of India',
          sourceCount: 3,
        },
      ],
    });
    const frame = service.buildCoworkerActivityFrame({
      response,
      agentId: 'research-agent',
      agentName: 'Research Agent',
      modelId: 'openai/gpt-4o',
      isLocal: false,
      lane: 'research',
      confidenceState: 'grounded',
      fallbackReason: null,
    });

    expect(frame.workStory).toBe('Checked 3 sources and anchored the answer in Election Commission of India.');
  });

  it('supports task-shaped execution intent without contract changes', () => {
    const taskIntent: ExecutionIntent = {
      invocationSource: 'task',
      lane: 'tasking',
      groundingMode: 'tool_preferred',
      reviewEnabled: false,
      selectedToolNames: ['web_search'],
      selectedSkillNames: [],
      selectedAgentId: 'automation-worker',
      selectedModel: 'openai/gpt-4o-mini',
      memoryAccessPolicy: {
        structured: true,
        semantic: true,
      },
      executionPolicy: {
        stream: false,
        allowToolUse: true,
      },
      taskInvocation: {
        taskId: 'task-1',
        runId: 'run-1',
        triggeredBy: 'cron',
      },
    };

    expect(taskIntent.invocationSource).toBe('task');
    expect(taskIntent.taskInvocation?.triggeredBy).toBe('cron');
  });

  it('documents V1 trace coverage as model execution only while naming planned V2 stages', () => {
    expect(TRANSFORM_TRACE_V1_AGENT_TIMING_STAGES).toEqual(['model_execution']);
    expect(TRANSFORM_TRACE_V2_PLANNED_AGENT_TIMING_STAGES).toEqual(
      ['tool', 'search', 'fetch', 'extract', 'synthesis'],
    );
  });
});
