import { ProvenanceTrace, ProvenanceStep, ProvenanceSummary } from '@rawclaw/shared';

export class ProvenanceSanitizer {
  private static readonly TRANSCRIPT_MARKER_REGEX = /<turn\|>|<\|(?:user|assistant|system|model)\|>|\|>(?:user|assistant|model)|<start_of_turn>|<end_of_turn>/i;
  /**
   * Normalizes raw provenance data from the agent (which might be snake_case)
   * and generates a high-level summary for display.
   */
  static processTrace(rawTrace: any): ProvenanceTrace {
    const runId = (rawTrace.runId || rawTrace.run_id || 'unknown') as string;
    const rawSteps = (Array.isArray(rawTrace.steps) ? rawTrace.steps : []) as any[];
    
    // 1. Normalize steps to camelCase and perform basic sanitization
    const steps: ProvenanceStep[] = rawSteps.map((step, index) => {
      const normalizedStep: ProvenanceStep = {
        stepIndex: (step.stepIndex ?? step.step_index ?? index) as number,
        stepType: (step.stepType ?? step.step_type ?? 'plan') as any,
        toolName: (step.toolName ?? step.tool_name ?? null) as string | null,
        inputSummary: (step.inputSummary ?? step.input_summary ?? null) as string | null,
        outputSummary: (step.outputSummary ?? step.output_summary ?? null) as string | null,
        sourceUrl: (step.sourceUrl ?? step.source_url ?? null) as string | null,
        durationMs: (step.durationMs ?? step.duration_ms ?? 0) as number,
        sandboxed: (step.sandboxed ?? false) as boolean,
        timestamp: (step.timestamp ?? new Date().toISOString()) as string,
      };

      // Apply display sanitization (truncation, cleanup) to the normalized step
      return this.sanitizeStepForDisplay(normalizedStep);
    });

    const trace: ProvenanceTrace = {
      runId,
      steps,
      stepCount: (rawTrace.stepCount ?? rawTrace.step_count ?? steps.length) as number,
      createdAt: (rawTrace.createdAt ?? rawTrace.created_at ?? new Date().toISOString()) as string,
      runIds: this.extractRunIds(steps),
    };

    // 2. Generate summary
    trace.summary = this.generateSummary(trace);

    return trace;
  }

  /**
   * Cleans up a step's summaries for UI display.
   */
  static sanitizeStepForDisplay(step: ProvenanceStep): ProvenanceStep {
    const sanitized = { ...step };

    if (sanitized.outputSummary) {
      sanitized.outputSummary = this.sanitizeText(sanitized.outputSummary);
    }
    if (sanitized.inputSummary) {
      sanitized.inputSummary = this.sanitizeText(sanitized.inputSummary);
    }

    return sanitized;
  }

  private static sanitizeText(text: string): string {
    if (!text) return text;

    let sanitized = text;

    // 1. Remove hidden-role framing / persona boilerplate
    sanitized = sanitized.replace(/^(As an AI|I am an AI|My objective is|I will now).+?[.!?]\s*/gi, '');
    
    // 2. Remove common prompt boilerplate
    sanitized = sanitized.replace(/I will perform the following steps:?\s*/gi, '');
    sanitized = sanitized.replace(/Plan for this turn:?\s*/gi, '');

    // 3. Truncate/Remove large doc injection blocks
    sanitized = sanitized.replace(/\[File: .+?\] \(Extracted Text\): [\s\S]{300,}/g, (match) => {
      return match.slice(0, 80) + '... [Long document content truncated in trace]';
    });

    // 4. Handle assistant self-talk / internal reasoning framing more aggressively
    sanitized = sanitized.replace(/^Thought:?\s*/gi, '');
    sanitized = sanitized.replace(/^Reasoning:?\s*/gi, '');

    // 5. Remove transcript/control markers and anything after them
    const transcriptMatch = sanitized.match(this.TRANSCRIPT_MARKER_REGEX);
    if (transcriptMatch?.index !== undefined) {
      sanitized = sanitized.slice(0, transcriptMatch.index);
    }

    // 6. Improve readability for compressed model snippets in traces
    sanitized = sanitized
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/([,.;:!?])([A-Za-z])/g, '$1 $2')
      .replace(/\s{2,}/g, ' ');

    return sanitized.trim();
  }

  private static generateSummary(trace: ProvenanceTrace): ProvenanceSummary {
    const steps = trace.steps || [];
    const hasTools = steps.some(s => s.stepType === 'tool_call');
    const hasDocuments = steps.some(s => s.sourceUrl || (s.inputSummary && s.inputSummary.includes('[File:')));
    const runIds = trace.runIds || [];
    const hasTaskRun = runIds.length > 0;

    let mainSource: 'model' | 'tool' | 'document' = 'model';
    if (hasTools) mainSource = 'tool';
    else if (hasDocuments) mainSource = 'document';

    let brief = 'Answered directly from model knowledge. No tools were invoked.';

    if (hasTools && hasDocuments) {
      brief = 'Synthesized answer using documents and external tools.';
    } else if (hasTools) {
      const toolNames = Array.from(new Set(steps.filter(s => s.toolName).map(s => s.toolName)));
      brief = `Executed ${toolNames.length} tool(s): ${toolNames.join(', ')}.`;
    } else if (hasDocuments) {
      brief = 'Synthesized answer from provided documents. No external tools needed.';
    } else if (steps.some(s => s.stepType === 'review')) {
      const reviewed = steps.filter(s => s.stepType === 'review');
      const rejected = reviewed.some(s => s.outputSummary?.includes('REJECTED'));
      brief = rejected 
        ? 'Output was rejected by reviewer and subsequently revised.' 
        : 'Output was verified and approved by secondary reviewer.';
    } else if (steps.some(s => s.stepType === 'error')) {
      brief = 'Encountered issues during processing; fallback logic applied.';
    }

    // Identify the most significant "last action"
    let lastAction = brief;
    const meaningfulSteps = steps.filter(s => s.stepType === 'tool_result' || s.stepType === 'error');
    if (meaningfulSteps.length > 0) {
      const last = meaningfulSteps[meaningfulSteps.length - 1];
      if (last.stepType === 'error') lastAction = 'Encountered error';
      else if (last.toolName) lastAction = `Completed ${last.toolName}`;
    }

    return {
      hasTools,
      hasDocuments,
      hasTaskRun,
      mainSource,
      brief,
      lastAction,
    } as ProvenanceSummary;
  }

  private static extractRunIds(steps: ProvenanceStep[]): string[] {
    const runIds: string[] = [];
    for (const step of steps) {
      if (step.stepType === 'tool_result' && step.outputSummary) {
        const match = step.outputSummary.match(/"run_?Id":\s*"([a-f0-9-]+)"/i);
        if (match && match[1]) {
          runIds.push(match[1]);
        }
      }
    }
    return Array.from(new Set(runIds));
  }
}
