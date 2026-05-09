import { RunStep, TaskRun } from '@rawclaw/shared';

export type RunSummaryModel = {
  outcome: string;
  steps: string[];
  nextStep?: string;
};

const STEP_TYPE_COPY: Record<RunStep['stepType'], string> = {
  plan: 'Planned the task',
  tool_call: 'Chose a tool to continue',
  tool_result: 'Captured a tool result',
  synthesis: 'Wrapped up the task',
  error: 'Hit a blocking error',
  review: 'Reviewed the result',
};

export function deriveRunSummary(run: Pick<TaskRun, 'status' | 'errorMessage' | 'selectedAgent' | 'resumedFromRunId'> & { steps?: RunStep[]; task?: { name?: string } | null }): RunSummaryModel {
  const agentLabel = run.selectedAgent ? ` using ${run.selectedAgent}` : '';
  const taskLabel = run.task?.name ? ` for ${run.task.name}` : '';
  const meaningfulSteps = summarizeSteps(run.steps || []);

  if (run.status === 'failed') {
    const stoppedAt = normalizeOutcomeFragment(meaningfulSteps[meaningfulSteps.length - 1] || 'an execution step');
    return {
      outcome: `The task ran${taskLabel}${agentLabel} but couldn't complete - it stopped at ${stoppedAt.toLowerCase()}. You can resume from where it left off.`,
      steps: meaningfulSteps,
      nextStep: 'Resume this run to continue from the last completed step.',
    };
  }

  if (run.status === 'cancelled') {
    return {
      outcome: `This run was cancelled before finishing${taskLabel ? taskLabel : ''}. Resume to continue from the last completed step.`,
      steps: meaningfulSteps,
      nextStep: 'Resume this run when you are ready to continue.',
    };
  }

  if (run.status === 'running') {
    return {
      outcome: `This task is still running${taskLabel}${agentLabel}. Check the latest steps below if you want to follow along.`,
      steps: meaningfulSteps,
    };
  }

  if (run.status === 'queued') {
    return {
      outcome: `This task is queued${taskLabel}${agentLabel} and waiting for execution to begin.`,
      steps: meaningfulSteps,
    };
  }

  return {
    outcome: `The task completed${taskLabel}${agentLabel}. Review the summary below and open technical details if you need the raw trace.`,
    steps: meaningfulSteps,
  };
}

export function summarizeSteps(steps: RunStep[]): string[] {
  const summary: string[] = [];

  for (const step of steps) {
    const label = humanizeStep(step);
    if (!label) {
      continue;
    }
    if (summary.includes(label)) {
      continue;
    }
    summary.push(label);
    if (summary.length >= 5) {
      break;
    }
  }

  if (!summary.length) {
    summary.push('No detailed steps were recorded');
  }

  return summary;
}

export function humanizeStep(step: RunStep): string {
  const sourceText = firstReadable(step.outputSummary) || firstReadable(step.inputSummary);

  switch (step.stepType) {
    case 'tool_call':
      return step.toolName ? `Called ${humanizeToolName(step.toolName)}` : STEP_TYPE_COPY.tool_call;
    case 'tool_result':
      if (step.toolName) {
        return sourceText
          ? `Used ${humanizeToolName(step.toolName)}: ${trimSentence(sourceText)}`
          : `Used ${humanizeToolName(step.toolName)}`;
      }
      return sourceText ? trimSentence(sourceText) : STEP_TYPE_COPY.tool_result;
    case 'synthesis':
      return sourceText ? trimSentence(sourceText) : STEP_TYPE_COPY.synthesis;
    case 'error':
      return sourceText ? `Stopped: ${trimSentence(sourceText)}` : STEP_TYPE_COPY.error;
    case 'review':
      return sourceText ? trimSentence(sourceText) : STEP_TYPE_COPY.review;
    case 'plan':
    default:
      return sourceText ? trimSentence(sourceText) : STEP_TYPE_COPY.plan;
  }
}

function humanizeToolName(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstReadable(value?: string | null): string {
  if (!value) {
    return '';
  }

  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) {
    return '';
  }

  if (compact.startsWith('{') || compact.startsWith('[') || compact.startsWith('instructions=')) {
    return '';
  }

  return compact;
}

function trimSentence(value: string): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= 92) {
    return compact;
  }
  return `${compact.slice(0, 89).trimEnd()}...`;
}

function normalizeOutcomeFragment(value: string): string {
  return value.replace(/^stopped:\s*/i, '').replace(/\s+/g, ' ').trim();
}
