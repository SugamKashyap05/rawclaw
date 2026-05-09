import { describe, expect, it } from 'vitest';
import { isUserFacingToolName } from './toolVisibility';

describe('toolVisibility', () => {
  it('shows known user-facing tool families by explicit allow-list', () => {
    expect(isUserFacingToolName('web_extract')).toBe(true);
    expect(isUserFacingToolName('web_search')).toBe(true);
    expect(isUserFacingToolName('terminal_command')).toBe(true);
  });

  it('hides helper and unknown tools by default', () => {
    expect(isUserFacingToolName('skill_new_thing')).toBe(false);
    expect(isUserFacingToolName('unknown-tool')).toBe(false);
    expect(isUserFacingToolName('custom_analytics_probe_worker')).toBe(false);
  });
});
