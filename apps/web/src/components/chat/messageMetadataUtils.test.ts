import { describe, expect, it } from 'vitest';
import { RESERVED_AGENT_DISPLAY_NAMES, type AgentProfile, type MemoryEvent } from '@rawclaw/shared';
import {
  RESERVED_AGENT_LABELS,
  humanizeAgentId,
  modelShortName,
  resolveAgentLabel,
  summarizeMemoryEvents,
} from './messageMetadataUtils';

function makeAgent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'profile_agent',
    name: 'Profile Agent',
    systemPrompt: 'You are a profile agent.',
    status: 'idle',
    isDefault: false,
    skills: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeMemoryEvent(summary: string): MemoryEvent {
  return {
    layer: 'session',
    action: 'recalled',
    summary,
  };
}

describe('messageMetadataUtils', () => {
  it('covers reserved agent mappings', () => {
    expect(RESERVED_AGENT_LABELS).toBe(RESERVED_AGENT_DISPLAY_NAMES);
    expect(RESERVED_AGENT_LABELS.main).toBe('RawClaw');
    expect(humanizeAgentId('main')).toBe('RawClaw');
    expect(humanizeAgentId('default-assistant')).toBe('RawClaw');
    expect(humanizeAgentId('app_builder')).toBe('App Builder');
    expect(humanizeAgentId('app-builder')).toBe('App Builder');
    expect(humanizeAgentId('research_agent')).toBe('Research Agent');
    expect(humanizeAgentId('research-agent')).toBe('Research Agent');
    expect(humanizeAgentId('automation_worker')).toBe('Automation');
    expect(humanizeAgentId('automation-worker')).toBe('Automation');
  });

  it('humanizes unknown ids and truncates long labels', () => {
    expect(humanizeAgentId('custom_agent_name')).toBe('Custom Agent Name');
    expect(humanizeAgentId('custom-agent-name')).toBe('Custom Agent Name');
    expect(humanizeAgentId('extremely_long_custom_agent_identifier')).toBe('Extremely Long Cu...');
  });

  it('prefers loaded agent profile names over derived labels', () => {
    expect(resolveAgentLabel('profile_agent', [makeAgent()])).toBe('Profile Agent');
    expect(resolveAgentLabel('custom_agent_name', [])).toBe('Custom Agent Name');
  });

  it('derives short model names from provider paths', () => {
    expect(modelShortName('openai/gpt-4o')).toBe('gpt-4o');
    expect(modelShortName('local-model')).toBe('local-model');
    expect(modelShortName(null)).toBeNull();
  });

  it('summarizes memory events for one, two, three, and many entries', () => {
    expect(summarizeMemoryEvents([makeMemoryEvent('project brief')])).toBe('Used memory: project brief');
    expect(summarizeMemoryEvents([makeMemoryEvent('project brief'), makeMemoryEvent('your name')])).toBe(
      'Used memory: project brief, your name',
    );
    expect(
      summarizeMemoryEvents([
        makeMemoryEvent('project brief'),
        makeMemoryEvent('your name'),
        makeMemoryEvent('launch plan'),
      ]),
    ).toBe('Used memory: project brief, your name, launch plan');
    expect(
      summarizeMemoryEvents([
        makeMemoryEvent('project brief'),
        makeMemoryEvent('your name'),
        makeMemoryEvent('launch plan'),
        makeMemoryEvent('release checklist'),
      ]),
    ).toBe('Used memory: project brief, your name, launch plan +1 more');
  });

  it('falls back to plain memory copy when detailed names are unavailable', () => {
    expect(summarizeMemoryEvents([makeMemoryEvent('   '), makeMemoryEvent('')])).toBe('Used memory');
    expect(summarizeMemoryEvents(undefined)).toBeNull();
  });
});
