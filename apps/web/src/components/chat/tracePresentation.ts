function normalizeText(value?: string | null): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

const TRACE_REVIEW_SUMMARY_MAP: Record<'approved' | 'rejected', string> = {
  approved: 'Reviewer approved the draft',
  rejected: 'Reviewer requested changes',
};

const PAYLOAD_LIKE_TRACE_SUMMARY_MAP: Record<string, string> = {
  tool_result: 'Structured tool output captured',
  tool_call: 'Tool call recorded',
  error: 'Tool error recorded',
  review: 'Reviewer decision recorded',
  plan: 'Planning step recorded',
  default: 'Structured trace recorded',
};

export function isPayloadLikeText(value?: string | null): boolean {
  const normalized = normalizeText(value);
  if (!normalized) return false;

  if (/^[{\[]/.test(normalized)) return true;
  if (/instructions\s*=|skill_path\s*=|tool_name\s*=|output_summary\s*=|input_summary\s*=/i.test(normalized)) return true;
  if (/"instructions"\s*:|"task"\s*:|"skill_path"\s*:|"tool_name"\s*:/.test(normalized)) return true;
  if (normalized.length > 200 && /[{}[\]":=]/.test(normalized)) return true;
  return false;
}

export function sanitizeTraceSummary(stepType: string, summary?: string | null): string {
  const normalized = normalizeText(summary);
  if (!normalized) return '';

  if (stepType === 'review') {
    if (/approved/i.test(normalized)) return TRACE_REVIEW_SUMMARY_MAP.approved;
    if (/reject|requested changes|needs revision/i.test(normalized)) return TRACE_REVIEW_SUMMARY_MAP.rejected;
  }

  if (isPayloadLikeText(normalized)) {
    return PAYLOAD_LIKE_TRACE_SUMMARY_MAP[stepType] || PAYLOAD_LIKE_TRACE_SUMMARY_MAP.default;
  }

  if (stepType === 'error' && normalized.length > 160) {
    return PAYLOAD_LIKE_TRACE_SUMMARY_MAP.error;
  }

  if (normalized.length > 160) {
    return `${normalized.slice(0, 157).trimEnd()}...`;
  }

  return normalized;
}
