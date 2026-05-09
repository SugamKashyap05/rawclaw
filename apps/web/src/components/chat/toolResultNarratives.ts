import { ToolResult } from '@rawclaw/shared';
import { ToolActivityStatus } from './ToolActivityCard';
import { asString, toRecord } from './toolResultUtils';

export type ToolResultFamily = 'search' | 'browser' | 'file' | 'code' | 'terminal' | 'generic';

export function detectToolResultFamily(result: ToolResult): ToolResultFamily {
  const name = result.tool_name.toLowerCase();
  if (name.includes('search')) return 'search';
  if (name.includes('browser') || name.includes('fetch') || name.includes('navigate') || name.includes('extract')) return 'browser';
  if (name.includes('file')) return 'file';
  if (name.includes('python') || name.includes('code')) return 'code';
  if (name.includes('shell') || name.includes('terminal') || name.includes('bash') || name.includes('command')) return 'terminal';
  return 'generic';
}

export function resolveToolResultStatus(result: ToolResult): ToolActivityStatus {
  const payload = toRecord(result.output);
  const family = detectToolResultFamily(result);

  if (family === 'search') {
    const resultQuality = asString(payload.result_quality);
    const qualityAssessment = asString(payload.quality_assessment)?.toLowerCase() || '';
    const results = Array.isArray(payload.results) ? payload.results : [];
    if (result.error) return 'failed';
    if (!results.length) return 'degraded';
    if (resultQuality === 'weak') return 'degraded';
    if (
      qualityAssessment.includes('weak')
      || qualityAssessment.includes('incomplete')
      || qualityAssessment.includes('placeholder')
      || qualityAssessment.includes('thin')
    ) {
      return 'degraded';
    }
    return 'success';
  }

  if (family === 'browser') {
    const backendResult = asString(payload.backendResult);
    const evidenceStatus = asString(payload.evidenceStatus);
    const isFallback = Boolean(payload.isFallback);

    if (backendResult === 'skipped') return 'skipped';
    if (backendResult === 'failed' || result.error) return 'failed';
    if (backendResult === 'garbage' || evidenceStatus === 'degraded' || isFallback) return 'degraded';
    return 'success';
  }

  return result.error ? 'failed' : 'success';
}

export function buildToolNarrative(result: ToolResult): string {
  const payload = toRecord(result.output);
  const family = detectToolResultFamily(result);

  switch (family) {
    case 'search': {
      const query = asString(payload.query) || asString(result.input?.query) || 'the request';
      const results = Array.isArray(payload.results) ? payload.results : [];
      const resultQuality = asString(payload.result_quality);
      const qualityAssessment = asString(payload.quality_assessment);
      const first = (results[0] && typeof results[0] === 'object') ? (results[0] as Record<string, unknown>) : {};
      const title = asString(first.title);
      if (result.error) {
        return `I searched for ${quote(query)}, but the search run failed before I could use the results.`;
      }
      if (results.length === 0) {
        return `I searched for ${quote(query)}, but I did not capture any usable results this turn.`;
      }
      if (resultQuality === 'weak' || qualityAssessment) {
        const warning = qualityAssessment ? ` ${qualityAssessment.replace(/\.$/, '')}.` : ' The evidence still looked weak or incomplete.';
        if (title) {
          return `I searched for ${quote(query)} and found ${results.length} result${results.length === 1 ? '' : 's'}, but the evidence looked weak or incomplete. The strongest lead was ${quote(title)}.${warning}`;
        }
        return `I searched for ${quote(query)} and found ${results.length} result${results.length === 1 ? '' : 's'}, but the evidence looked weak or incomplete.${warning}`;
      }
      if (title) {
        return `I searched for ${quote(query)} and found ${results.length} result${results.length === 1 ? '' : 's'}. The strongest lead was ${quote(title)}.`;
      }
      return `I searched for ${quote(query)} and found ${results.length} result${results.length === 1 ? '' : 's'} to work from.`;
    }
    case 'browser': {
      const url = asString(payload.url) || result.source_url || asString(result.input?.url) || 'the page';
      const title = asString(payload.title) || asString(payload.page_title);
      const backendResult = asString(payload.backendResult);
      const evidenceStatus = asString(payload.evidenceStatus);
      const isFallback = Boolean(payload.isFallback);
      const redirectedUrl = asString(payload.redirectedUrl);
      const target = title ? `${quote(title)} at ${url}` : url;

      if (backendResult === 'skipped') {
        return `I could not open ${target} because the browser queue was full, so this step was skipped.`;
      }
      if (result.error) {
        return `I reached ${target}, but I could not extract usable page content from it.`;
      }
      if (isFallback || backendResult === 'garbage' || evidenceStatus === 'degraded') {
        const finalTarget = redirectedUrl && redirectedUrl !== url ? ` It ended at ${redirectedUrl}.` : '';
        return `I checked ${target}, but the extracted page evidence was thin, degraded, or required fallback handling.${finalTarget}`;
      }
      return `I opened ${target} and recovered usable page content for the answer.`;
    }
    case 'file': {
      const path = asString(payload.path) || asString(result.input?.path) || 'the file';
      return result.error
        ? `I tried to read ${path}, but the file result came back with an error.`
        : `I opened ${path} and pulled the file contents into working context.`;
    }
    case 'code': {
      return result.error
        ? 'I ran the code step, but the execution did not complete cleanly.'
        : 'I ran the code step and captured its execution output for this turn.';
    }
    case 'terminal': {
      const command = asString(payload.command) || asString(result.input?.command) || 'the command';
      return result.error
        ? `I ran ${quote(command)}, but the command did not finish cleanly.`
        : `I ran ${quote(command)} and captured the command output for this turn.`;
    }
    default:
      return result.error
        ? `I ran ${humanizeToolName(result.tool_name)}, but it returned an error instead of a usable result.`
        : `I ran ${humanizeToolName(result.tool_name)} and captured the result for this turn.`;
  }
}

export function getToolTrustSignals(result: ToolResult): Array<{ label: string; tone: 'info' | 'warning' | 'neutral' }> {
  const payload = toRecord(result.output);
  const signals: Array<{ label: string; tone: 'info' | 'warning' | 'neutral' }> = [];
  const family = detectToolResultFamily(result);
  const sourceUrl = asString(payload.url) || result.source_url || asString(result.input?.url);
  const redirectedUrl = asString(payload.redirectedUrl);
  const evidenceStatus = asString(payload.evidenceStatus);
  const backendResult = asString(payload.backendResult);
  const resultQuality = asString(payload.result_quality);
  const qualityAssessment = asString(payload.quality_assessment);
  const isFallback = Boolean(payload.isFallback);
  const fallbackAttempted = Boolean(payload.fallbackAttempted);
  const truncated = Boolean(payload.contentTruncated || result.is_truncated);
  const provider = asString(payload.provider) || asString(payload.search_provider);
  const resultCount = Array.isArray(payload.results) ? payload.results.length : 0;

  if (sourceUrl) {
    signals.push({ label: sourceHostname(sourceUrl), tone: 'info' });
  }
  if (family === 'search' && resultCount > 0) {
    signals.push({ label: `${resultCount} result${resultCount === 1 ? '' : 's'}`, tone: 'neutral' });
  }
  if (family === 'search' && provider) {
    signals.push({ label: provider, tone: 'info' });
  }
  if (redirectedUrl && redirectedUrl !== sourceUrl) {
    signals.push({ label: `redirected`, tone: 'neutral' });
  }
  if (backendResult) {
    signals.push({ label: backendResult, tone: backendResult === 'success' ? 'info' : backendResult === 'skipped' ? 'neutral' : 'warning' });
  }
  if (evidenceStatus) {
    signals.push({ label: `evidence:${evidenceStatus}`, tone: evidenceStatus === 'strong' || evidenceStatus === 'medium' ? 'info' : 'warning' });
  }
  if (family === 'search' && resultQuality) {
    signals.push({ label: `quality:${resultQuality}`, tone: resultQuality === 'strong' ? 'info' : 'warning' });
  }
  if (family === 'search' && qualityAssessment) {
    signals.push({ label: 'quality warning', tone: 'warning' });
  }
  if (isFallback) {
    signals.push({ label: 'fallback', tone: 'warning' });
  } else if (fallbackAttempted) {
    signals.push({ label: 'fallback attempted', tone: 'warning' });
  }
  if (truncated) {
    signals.push({ label: 'truncated', tone: 'warning' });
  }
  if (result.error && signals.every((signal) => signal.label !== 'error')) {
    signals.push({ label: 'error', tone: 'warning' });
  }

  return signals;
}

export function shouldExpandToolDetailsByDefault(result: ToolResult): boolean {
  const status = resolveToolResultStatus(result);
  const payload = toRecord(result.output);
  return status !== 'success' || Boolean(payload.isFallback || payload.contentTruncated || result.is_truncated || result.error);
}

export function toolResultSourceLabel(result: ToolResult): string {
  switch (detectToolResultFamily(result)) {
    case 'search':
      return 'Web Search';
    case 'browser':
      return 'Browser Result';
    case 'file':
      return 'File Result';
    case 'code':
      return 'Code Execution';
    case 'terminal':
      return 'Terminal Result';
    default:
      return humanizeToolName(result.tool_name);
  }
}

function sourceHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function humanizeToolName(toolName: string): string {
  const cleaned = String(toolName || 'tool')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!cleaned) {
    return 'Tool Result';
  }
  const titleCased = cleaned.replace(/\b\w/g, (char) => char.toUpperCase());
  return titleCased.length > 20 ? `${titleCased.slice(0, 17).trimEnd()}...` : titleCased;
}

function quote(value: string): string {
  return `"${value}"`;
}
