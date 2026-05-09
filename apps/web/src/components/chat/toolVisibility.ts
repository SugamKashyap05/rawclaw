import type { ToolResult } from '@rawclaw/shared';

const USER_FACING_TOOL_ALLOW_PATTERNS = [
  /^web_search$/i,
  /^web_extract$/i,
  /browser/i,
  /fetch/i,
  /navigate/i,
  /file/i,
  /python/i,
  /code/i,
  /shell/i,
  /terminal/i,
  /bash/i,
  /command/i,
] as const;

export function normalizeToolName(toolName?: string | null): string {
  return String(toolName || '').trim().toLowerCase();
}

export function isUserFacingToolName(toolName?: string | null): boolean {
  const normalized = normalizeToolName(toolName);
  if (!normalized) return false;
  return USER_FACING_TOOL_ALLOW_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isUserFacingToolResult(result?: Pick<ToolResult, 'tool_name'> | null): boolean {
  return Boolean(result && isUserFacingToolName(result.tool_name));
}
