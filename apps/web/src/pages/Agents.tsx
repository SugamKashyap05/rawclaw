import { FormEvent, useEffect, useState } from 'react';
import { AgentProfile, CreateAgentRequest, SkillDefinition, UpdateAgentRequest } from '@rawclaw/shared';
import { api } from '../lib/api';

type PromptPack = {
  id: string;
  purpose: string;
};

const EMPTY_AGENT: CreateAgentRequest = {
  name: '',
  description: '',
  systemPrompt: `You are RawClaw, an AI agent for reliable, tool-aware task execution.

Primary goals:
- Be accurate, grounded, and useful.
- Prefer verified tool results and repository context over prior model memory.
- Complete the user's request end-to-end whenever possible.
- Be concise, but include important caveats when confidence is low.

Operating rules:
- If a task requires current information, use an available search or fetch tool.
- If a tool returns usable results, base the answer on those results.
- Do not contradict successful tool results with unsupported prior knowledge.
- If tool results are incomplete or failed, say that plainly.
- Never invent files, facts, commands, URLs, APIs, or project state.
- Match the project's existing conventions before proposing edits.

Response style:
- Clear, direct, and helpful.
- Use structured output when it improves readability.
- Do not expose hidden chain-of-thought.`,
  promptPackId: 'rawclaw-default',
  promptOverlay: '',
  skills: [],
  isDefault: false,
};

export default function Agents() {
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillDefinition[]>([]);
  const [promptPacks, setPromptPacks] = useState<PromptPack[]>([]);
  const [draft, setDraft] = useState<CreateAgentRequest>(EMPTY_AGENT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptPackError, setPromptPackError] = useState<string | null>(null);

  useEffect(() => {
    void loadAgents();
    void loadSkills();
    void loadPromptPacks();
  }, []);

  const loadAgents = async () => {
    try {
      const response = await api.get<AgentProfile[]>('/agents');
      setAgents(response.data);
    } catch (loadError) {
      console.error('Failed to load agents', loadError);
      setError('Unable to load agent profiles right now.');
    }
  };

  const loadSkills = async () => {
    try {
      const response = await api.get<SkillDefinition[]>('/skills');
      setAvailableSkills(response.data);
    } catch (loadError) {
      console.error('Failed to load skills', loadError);
    }
  };

  const loadPromptPacks = async () => {
    try {
      const response = await api.get<PromptPack[]>('/prompts/packs');
      setPromptPacks(response.data);
      setPromptPackError(null);
    } catch (loadError) {
      console.error('Failed to load prompt packs', loadError);
      setPromptPackError('Prompt packs could not be loaded, so the default pack will be used.');
    }
  };

  const promptPackOptions = (() => {
    const byId = new Map<string, PromptPack>();
    for (const pack of promptPacks) {
      byId.set(pack.id, pack);
    }
    if (!byId.has('rawclaw-default')) {
      byId.set('rawclaw-default', {
        id: 'rawclaw-default',
        purpose: 'Fallback default prompt pack',
      });
    }
    const currentDraftPack = draft.promptPackId?.trim();
    if (currentDraftPack && !byId.has(currentDraftPack)) {
      byId.set(currentDraftPack, {
        id: currentDraftPack,
        purpose: 'Currently assigned prompt pack',
      });
    }
    return Array.from(byId.values());
  })();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      if (editingId) {
        const payload: UpdateAgentRequest = { ...draft };
        await api.patch(`/agents/${editingId}`, payload);
        setMessage('Agent updated.');
      } else {
        await api.post('/agents', draft);
        setMessage('Agent created.');
      }
      setDraft(EMPTY_AGENT);
      setEditingId(null);
      await loadAgents();
    } catch (saveError: unknown) {
      console.error('Failed to save agent', saveError);
      setError(extractApiError(saveError, editingId ? 'Unable to update this agent.' : 'Unable to create this agent.'));
    } finally {
      setSaving(false);
    }
  };

  const editAgent = (agent: AgentProfile) => {
    setEditingId(agent.id);
      setDraft({
        name: agent.name,
        description: agent.description || '',
        systemPrompt: agent.systemPrompt,
        promptPackId: agent.promptPackId || 'rawclaw-default',
        promptOverlay: agent.promptOverlay || '',
        skills: agent.skills || [],
        isDefault: agent.isDefault,
      });
  };

  const toggleSkill = (skillName: string) => {
    setDraft((current) => {
      const currentSkills = current.skills || [];
      const nextSkills = currentSkills.includes(skillName)
        ? currentSkills.filter((name) => name !== skillName)
        : [...currentSkills, skillName];
      return { ...current, skills: nextSkills };
    });
  };

  const updateStatus = async (agent: AgentProfile, status: AgentProfile['status']) => {
    setError(null);
    try {
      await api.patch(`/agents/${agent.id}`, { status });
      await loadAgents();
    } catch (statusError: unknown) {
      console.error('Failed to update agent status', statusError);
      setError(extractApiError(statusError, 'Unable to change the agent status.'));
    }
  };

  const removeAgent = async (id: string) => {
    if (!window.confirm('Delete this agent profile?')) return;
    setError(null);
    try {
      await api.delete(`/agents/${id}`);
      if (editingId === id) {
        setEditingId(null);
        setDraft(EMPTY_AGENT);
      }
      await loadAgents();
    } catch (removeError: unknown) {
      console.error('Failed to delete agent', removeError);
      setError(extractApiError(removeError, 'Unable to delete this agent.'));
    }
  };

  return (
    <div className="animate-in" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '1.5rem' }}>
      <section className="glass-card">
        <div style={{ marginBottom: '1rem' }}>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Agents</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Create reusable system-prompt profiles and switch them directly from chat.
          </p>
        </div>

        <div style={{ display: 'grid', gap: '1rem' }}>
          {agents.map((agent) => (
            <div
              key={agent.id}
              style={{
                border: '1px solid var(--border-glass)',
                borderRadius: '16px',
                padding: '1rem',
                background: 'rgba(255,255,255,0.03)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.6rem' }}>
                <div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 700 }}>{agent.name}</div>
                  <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    {agent.status.toUpperCase()} {agent.isDefault ? '• DEFAULT' : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <button className="btn-ghost" onClick={() => editAgent(agent)}>Edit</button>
                  <button className="btn-ghost" onClick={() => updateStatus(agent, agent.status === 'running' ? 'idle' : 'running')}>
                    {agent.status === 'running' ? 'Pause' : 'Run'}
                  </button>
                  <button className="btn-ghost" onClick={() => removeAgent(agent.id)}>Delete</button>
                </div>
              </div>
              {agent.description ? <div style={{ color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>{agent.description}</div> : null}
              {agent.promptPackId ? (
                <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                  Prompt pack: {agent.promptPackId}
                </div>
              ) : null}
              {agent.skills?.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.75rem' }}>
                  {agent.skills.map((skill) => (
                    <span key={skill} style={skillPillStyle}>
                      {skill}
                    </span>
                  ))}
                </div>
              ) : null}
              <pre className="custom-scrollbar" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: '220px' }}>
                {agent.effectiveSystemPrompt || agent.systemPrompt}
              </pre>
            </div>
          ))}
        </div>
      </section>

      <aside className="glass-card">
        <h2 style={{ fontSize: '1.15rem', marginBottom: '1rem' }}>{editingId ? 'Edit agent' : 'Create agent'}</h2>
        <form onSubmit={submit} style={{ display: 'grid', gap: '0.9rem' }}>
          <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Name" style={fieldStyle} />
          <input
            value={draft.description || ''}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            placeholder="Description"
            style={fieldStyle}
          />
          <textarea
            value={draft.systemPrompt}
            onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))}
            placeholder="System prompt"
            rows={12}
            style={{ ...fieldStyle, resize: 'vertical' }}
          />
          <select
            value={draft.promptPackId || 'rawclaw-default'}
            onChange={(event) => setDraft((current) => ({ ...current, promptPackId: event.target.value }))}
            style={fieldStyle}
          >
            {promptPackOptions.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.id} - {pack.purpose}
              </option>
            ))}
          </select>
          {promptPackError ? <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>{promptPackError}</div> : null}
          <textarea
            value={draft.promptOverlay || ''}
            onChange={(event) => setDraft((current) => ({ ...current, promptOverlay: event.target.value }))}
            placeholder="Prompt overlay"
            rows={5}
            style={{ ...fieldStyle, resize: 'vertical' }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-secondary)' }}>
            <input
              type="checkbox"
              checked={draft.isDefault || false}
              onChange={(event) => setDraft((current) => ({ ...current, isDefault: event.target.checked }))}
            />
            Set as default agent
          </label>
          <div style={{ display: 'grid', gap: '0.55rem' }}>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Injected Skills</div>
            {availableSkills.length === 0 ? (
              <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
                No installed skills are available yet. Use the Skills page to build or install them first.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {availableSkills.map((skill) => {
                  const selected = (draft.skills || []).includes(skill.name);
                  return (
                    <button
                      key={skill.name}
                      type="button"
                      className="btn-ghost"
                      onClick={() => toggleSkill(skill.name)}
                      style={{
                        ...skillPillStyle,
                        cursor: 'pointer',
                        background: selected ? 'rgba(0,240,255,0.12)' : 'rgba(255,255,255,0.04)',
                        border: selected ? '1px solid rgba(0,240,255,0.3)' : '1px solid var(--border-glass)',
                        color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                      }}
                    >
                      {skill.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button className="btn-primary" disabled={saving || !draft.name.trim() || (!draft.systemPrompt.trim() && !(draft.promptOverlay || '').trim())}>
              {saving ? 'Saving...' : editingId ? 'Update agent' : 'Create agent'}
            </button>
            {editingId ? (
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setEditingId(null);
                  setDraft(EMPTY_AGENT);
                }}
              >
                Cancel
              </button>
            ) : null}
          </div>
          {message ? <div style={{ color: 'var(--text-secondary)' }}>{message}</div> : null}
          {error ? <div style={{ color: 'var(--error)' }}>{error}</div> : null}
        </form>
      </aside>
    </div>
  );
}

function extractApiError(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string | string[] } } }).response;
    const message = response?.data?.message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

const fieldStyle = {
  width: '100%',
  padding: '0.8rem 0.9rem',
  borderRadius: '12px',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
};

const skillPillStyle = {
  fontSize: '0.7rem',
  padding: '0.24rem 0.55rem',
  borderRadius: '999px',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--text-secondary)',
};
