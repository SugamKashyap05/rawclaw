import { AdvisoryEvent, CoworkerActivityFrame, MemoryEvent, ToolResult, WorkflowState, ProvenanceTrace as ProvenanceTraceShape } from '@rawclaw/shared';
import { useMemo, useState } from 'react';
import { FiActivity, FiChevronDown, FiChevronUp } from 'react-icons/fi';
import { asString, toRecord } from './toolResultUtils';
import { isPayloadLikeText } from './tracePresentation';
import { isUserFacingToolName, isUserFacingToolResult } from './toolVisibility';

export interface WorkStoryMessageLike {
  toolResults?: ToolResult[];
  memoryEvents?: MemoryEvent[];
  advisoryEvents?: AdvisoryEvent[];
  workflowState?: WorkflowState;
  provenanceTrace?: Partial<ProvenanceTraceShape> | null;
  coworkerActivityFrame?: CoworkerActivityFrame;
}

export interface WorkStoryStep {
  id: string;
  category: 'memory' | 'action' | 'trust' | 'advisory' | 'workflow';
  text: string;
}

function compactSummary(summary: string): string | null {
  const normalized = summary.replace(/\s+/g, ' ').trim().replace(/[.]+$/, '');
  if (!normalized) return null;
  if (normalized.split(/\s+/).length > 4 || normalized.length > 28) return null;
  return normalized;
}

function toolCopy(result: ToolResult): { action?: string; trust?: string } {
  const name = result.tool_name.toLowerCase();
  if (!isUserFacingToolName(name)) {
    return {};
  }
  const output = toRecord(result.output);
  const backendResult = asString(output.backendResult);
  const evidenceStatus = asString(output.evidenceStatus);
  const isFallback = Boolean(output.isFallback || output.fallbackAttempted);

  if (name.includes('search')) {
    return { action: 'Searched the web' };
  }
  if (name.includes('extract') || name.includes('fetch') || name.includes('browser') || name.includes('navigate')) {
    if (backendResult === 'skipped') {
      return { action: 'Skipped a browser attempt', trust: 'Returned constrained evidence' };
    }
    if (backendResult === 'garbage' || evidenceStatus === 'degraded' || isFallback || result.error) {
      return { action: 'Read the page with browser fallback', trust: 'Returned degraded evidence' };
    }
    return { action: 'Read the page directly' };
  }
  if (name.includes('file')) {
    return { action: 'Read the workspace file' };
  }
  if (name.includes('python') || name.includes('code')) {
    return { action: 'Ran local code' };
  }
  if (name.includes('shell') || name.includes('terminal') || name.includes('bash') || name.includes('command')) {
    return { action: 'Ran a shell command' };
  }
  if (result.error) {
    return { trust: 'Reported a tool failure' };
  }
  return {};
}

function provenanceCopy(trace?: Partial<ProvenanceTraceShape> | null): Partial<Record<WorkStoryStep['category'], string>> {
  const steps = Array.isArray(trace?.steps) ? trace.steps : [];
  const copy: Partial<Record<WorkStoryStep['category'], string>> = {};

  for (const rawStep of steps) {
    const stepType = typeof rawStep.stepType === 'string'
      ? rawStep.stepType
      : (typeof (rawStep as any).step_type === 'string' ? (rawStep as any).step_type : '');
    const toolName = typeof rawStep.toolName === 'string'
      ? rawStep.toolName
      : (typeof (rawStep as any).tool_name === 'string' ? (rawStep as any).tool_name : '');
    const outputSummary = typeof rawStep.outputSummary === 'string'
      ? rawStep.outputSummary
      : (typeof (rawStep as any).output_summary === 'string' ? (rawStep as any).output_summary : '');
    const loweredSummary = outputSummary.toLowerCase();

    if (!copy.action && (stepType === 'tool_call' || stepType === 'tool_result') && toolName && isUserFacingToolName(toolName)) {
      copy.action = toolCopy({ tool_name: toolName, input: {}, output: {}, duration_ms: 0, sandboxed: false }).action;
    }
    if (!copy.trust && stepType === 'error') {
      copy.trust = loweredSummary.includes('turn_limit')
        || loweredSummary.includes('maximum reasoning turns')
        || loweredSummary.includes('sequential thinking')
        ? 'Reported an execution limit'
        : 'Reported a tool failure';
    }
    if (!copy.trust && !isPayloadLikeText(outputSummary) && (loweredSummary.includes('degraded') || loweredSummary.includes('fallback'))) {
      copy.trust = 'Returned degraded evidence';
    }
    if (!copy.workflow && stepType === 'review' && loweredSummary.includes('reject')) {
      copy.workflow = 'Revised after review';
    }
  }

  return copy;
}

export function buildWorkStory(message: WorkStoryMessageLike): WorkStoryStep[] {
  if (message.coworkerActivityFrame?.workStory) {
    return [
      {
        id: 'coworker-frame',
        category: message.coworkerActivityFrame.visibilityState === 'degraded' ? 'trust' : 'workflow',
        text: message.coworkerActivityFrame.workStory,
      },
    ];
  }

  const primaryTool = message.toolResults?.find((result) => isUserFacingToolResult(result));
  const traceCopy = provenanceCopy(message.provenanceTrace);
  const hasStory = Boolean(
    primaryTool
    || message.memoryEvents?.length
    || message.advisoryEvents?.length
    || traceCopy.action
    || traceCopy.trust
    || traceCopy.workflow,
  );
  if (!hasStory) return [];

  const steps: WorkStoryStep[] = [];
  const memoryEvent = message.memoryEvents?.[0];
  const primaryAdvisory = message.advisoryEvents?.[0];

  if (memoryEvent) {
    const summary = compactSummary(memoryEvent.summary);
    const actionLabel =
      memoryEvent.action === 'captured'
        ? (summary ? `Saved ${summary}` : 'Saved your context')
        : memoryEvent.action === 'updated'
          ? (summary ? `Updated ${summary}` : 'Updated your context')
          : (summary ? `Remembered ${summary}` : 'Remembered your context');
    steps.push({ id: 'memory', category: 'memory', text: actionLabel });
  }

  const toolNarrative = primaryTool ? toolCopy(primaryTool) : {};
  const actionText = traceCopy.action || toolNarrative.action;
  if (actionText) {
    steps.push({ id: 'action', category: 'action', text: actionText });
  }

  const trustText = traceCopy.trust || toolNarrative.trust;
  if (trustText) {
    steps.push({ id: 'trust', category: 'trust', text: trustText });
  }

  if (primaryAdvisory) {
    steps.push({ id: 'advisory', category: 'advisory', text: 'Suggested a follow-up' });
  }

  if (traceCopy.workflow) {
    steps.push({ id: 'workflow', category: 'workflow', text: traceCopy.workflow });
  }

  return steps.slice(0, 5);
}

export function WorkStoryCard({ message }: { message: WorkStoryMessageLike }) {
  const [expanded, setExpanded] = useState(false);
  const steps = useMemo(() => buildWorkStory(message), [message]);

  if (!steps.length) return null;

  return (
    <div style={{ width: '100%' }}>
      <div className="glass-card" style={{ padding: '0.9rem 1rem', display: 'grid', gap: '0.7rem' }}>
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: '0.65rem',
            justifyContent: 'space-between',
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: 'inherit',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.68rem' }}>
              WORK STORY
            </span>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
              How this answer came together
            </span>
          </div>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: 'var(--neon-cyan)' }}>
            <FiActivity size={13} />
            {expanded ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
          </span>
        </button>

        {expanded ? (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {steps.map((step) => (
              <div
                key={step.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.55rem',
                  padding: '0.55rem 0.7rem',
                  borderRadius: '10px',
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid var(--border-glass)',
                  color: 'var(--text-secondary)',
                  fontSize: '0.84rem',
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--neon-cyan)' }} />
                <span>{step.text}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
