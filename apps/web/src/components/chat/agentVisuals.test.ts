import { describe, expect, it } from 'vitest';
import { hexToRgba, resolveAgentAccent } from './agentVisuals';

describe('agentVisuals', () => {
  it('uses reserved colors for known agents', () => {
    expect(resolveAgentAccent('main')).toBe('#60A5FA');
    expect(resolveAgentAccent('app_builder')).toBe('#F59E0B');
    expect(resolveAgentAccent('research_agent')).toBe('#14B8A6');
    expect(resolveAgentAccent('automation_worker')).toBe('#FB7185');
  });

  it('keeps unknown agent colors deterministic across calls', () => {
    expect(resolveAgentAccent('custom_agent')).toBe(resolveAgentAccent('custom_agent'));
    expect(resolveAgentAccent('another_agent')).toMatch(/^#/);
  });

  it('converts hex accents into rgba tints', () => {
    expect(hexToRgba('#60A5FA', 0.12)).toBe('rgba(96,165,250,0.12)');
  });
});
