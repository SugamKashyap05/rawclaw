import { CSSProperties, useEffect, useMemo, useState } from 'react';
import { AgentProfile, ModelInfo, ModelsHealthResponse, ProviderConfigState } from '@rawclaw/shared';
import { api } from '../lib/api';

interface ModelWithPreference extends ModelInfo {
  customName?: string;
  isFavorite: boolean;
  preferenceId?: string;
}

const PROVIDERS = ['openai', 'anthropic', 'google', 'ollama'] as const;

export default function Models() {
  const [models, setModels] = useState<ModelWithPreference[]>([]);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [health, setHealth] = useState<ModelsHealthResponse | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    const [modelsResponse, healthResponse, agentsResponse] = await Promise.all([
      api.get<ModelWithPreference[]>('/models'),
      api.get<ModelsHealthResponse>('/models/health'),
      api.get<AgentProfile[]>('/agents'),
    ]);
    setModels(modelsResponse.data);
    setHealth(healthResponse.data);
    setAgents(agentsResponse.data);
  };

  const modelsByProvider = useMemo(() => {
    return models.reduce<Record<string, ModelWithPreference[]>>((accumulator, model) => {
      accumulator[model.provider] = accumulator[model.provider] || [];
      accumulator[model.provider].push(model);
      return accumulator;
    }, {});
  }, [models]);

  const modelLabelById = useMemo(() => {
    return models.reduce<Record<string, string>>((accumulator, model) => {
      accumulator[model.id] = model.customName || model.name || model.id;
      return accumulator;
    }, {});
  }, [models]);

  const updateProvider = async (provider: string, patch: Partial<ProviderConfigState>) => {
    if (!health) return;
    const next = {
      providerConfig: {
        [provider]: {
          ...(health.providerConfig[provider] || {}),
          ...patch,
        },
      },
    };
    setSaving(true);
    try {
      const response = await api.post<ModelsHealthResponse>('/models/config', next);
      setHealth(response.data);
    } finally {
      setSaving(false);
    }
  };

  const updateRouting = async (patch: Partial<ModelsHealthResponse['routing']>) => {
    if (!health) return;
    setSaving(true);
    try {
      const response = await api.post<ModelsHealthResponse>('/models/config', { routing: patch });
      setHealth(response.data);
    } finally {
      setSaving(false);
    }
  };

  const updateAgentModel = async (agentId: string, modelId: string) => {
    setSaving(true);
    try {
      await api.patch(`/agents/${agentId}`, { modelId: modelId || null });
      await load();
    } finally {
      setSaving(false);
    }
  };

  const availableModelIds = models.map((model) => model.id);

  return (
    <div className="animate-in" style={{ display: 'grid', gap: '1.5rem' }}>
      <section className="glass-card">
        <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Models</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.2rem' }}>
          Manage providers, routing policy, App Builder preferences, and agent model assignments from one place.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '1rem' }}>
          {PROVIDERS.map((provider) => {
            const providerState = health?.providerConfig[provider] || { enabled: false };
            const providerHealth = health?.providers[provider];
            const providerModels = modelsByProvider[provider] || [];

            return (
              <div key={provider} style={providerCardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.6rem' }}>
                  <div style={{ fontWeight: 700, textTransform: 'capitalize' }}>{provider}</div>
                  <span className={`status-dot ${providerHealth?.status === 'ok' ? 'ok' : providerHealth?.status === 'degraded' ? 'loading' : 'down'}`} />
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.8rem' }}>
                  {providerHealth?.error || providerHealth?.status || 'unknown'}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.8rem' }}>
                  <input
                    type="checkbox"
                    checked={providerState.enabled}
                    onChange={(event) => void updateProvider(provider, { enabled: event.target.checked })}
                  />
                  Enabled
                </label>
                <input
                  value={providerState.apiKey || ''}
                  onChange={(event) => void updateProvider(provider, { apiKey: event.target.value })}
                  placeholder={provider === 'ollama' ? 'Optional token' : 'API key'}
                  type="password"
                  style={fieldStyle}
                />
                <input
                  value={providerState.baseUrl || ''}
                  onChange={(event) => void updateProvider(provider, { baseUrl: event.target.value })}
                  placeholder={provider === 'ollama' ? 'http://localhost:11434' : 'Base URL (optional)'}
                  style={{ ...fieldStyle, marginTop: '0.6rem' }}
                />
                <select
                  value={providerState.defaultModel || ''}
                  onChange={(event) => void updateProvider(provider, { defaultModel: event.target.value })}
                  style={{ ...fieldStyle, marginTop: '0.6rem' }}
                >
                  <option value="">Default model</option>
                  {providerModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.customName || model.name || model.id}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </section>

      <section className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', marginBottom: '0.3rem' }}>Complexity routing</h2>
            <div style={{ color: 'var(--text-secondary)' }}>Choose which model should handle low, medium, and high complexity tasks.</div>
          </div>
          <div className="mono" style={{ color: 'var(--text-muted)' }}>{saving ? 'Saving...' : 'Live'}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '1rem' }}>
          {(['low', 'medium', 'high'] as const).map((level) => (
            <div key={level}>
              <label className="mono" style={{ display: 'block', marginBottom: '0.45rem', fontSize: '0.72rem' }}>
                {level.toUpperCase()}
              </label>
              <select
                value={health?.routing[level] || ''}
                onChange={(event) => void updateRouting({ [level]: event.target.value })}
                style={fieldStyle}
              >
                {availableModelIds.map((id) => (
                  <option key={id} value={id}>
                    {modelLabelById[id]} ({id})
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="glass-card" style={specialistsSectionStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem', alignItems: 'center' }}>
          <div>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '0.3rem', color: 'var(--neon-cyan)', textShadow: '0 0 8px var(--neon-cyan-glow)' }}>
              Builder & Agents
            </h2>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
              Put dedicated model lanes behind App Builder and the agent profiles that do real work across the system.
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: '1.2rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
            <div style={specialistCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <div style={statusOrbStyle('var(--neon-cyan)', 'var(--neon-cyan)')} />
                <strong style={{ fontSize: '1rem', letterSpacing: '0.5px' }}>App Builder Chat</strong>
              </div>
              <p style={specialistCopyStyle}>
                Pick the preferred model lane for App Builder chat, discovery turns, and builder-side reasoning before execution begins.
              </p>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <select
                  value={health?.routing.appBuilder || ''}
                  onChange={(event) => void updateRouting({ appBuilder: event.target.value })}
                  style={{ ...fieldStyle, maxWidth: '420px', borderColor: 'rgba(0, 240, 255, 0.3)' }}
                >
                  {availableModelIds.map((id) => (
                    <option key={id} value={id}>
                      {modelLabelById[id]} ({id})
                    </option>
                  ))}
                </select>
                <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {health?.routing.appBuilder ? 'BUILDER ROUTE READY' : 'USING DEFAULT'}
                </div>
              </div>
            </div>

            <div style={specialistCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <div style={statusOrbStyle('#7dd3fc', '#7dd3fc')} />
                <strong style={{ fontSize: '1rem', letterSpacing: '0.5px' }}>Planner Lane</strong>
              </div>
              <p style={specialistCopyStyle}>
                The `plan` phase uses this model lane to turn the brief into a planning review, structured spec, and architecture guidance before approval.
              </p>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <select
                  value={health?.routing.appBuilderPlanner || ''}
                  onChange={(event) => void updateRouting({ appBuilderPlanner: event.target.value })}
                  style={{ ...fieldStyle, maxWidth: '420px', borderColor: 'rgba(125, 211, 252, 0.3)' }}
                >
                  {availableModelIds.map((id) => (
                    <option key={id} value={id}>
                      {modelLabelById[id]} ({id})
                    </option>
                  ))}
                </select>
                <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {health?.routing.appBuilderPlanner ? 'PLANNER ROUTE READY' : 'USING DEFAULT'}
                </div>
              </div>
            </div>

            <div style={specialistCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <div style={statusOrbStyle('#8bffb3', '#8bffb3')} />
                <strong style={{ fontSize: '1rem', letterSpacing: '0.5px' }}>Build Lane</strong>
              </div>
              <p style={specialistCopyStyle}>
                The `build / generate` phase uses this model lane to produce implementation guidance and generation context before files are written.
              </p>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <select
                  value={health?.routing.appBuilderBuilder || ''}
                  onChange={(event) => void updateRouting({ appBuilderBuilder: event.target.value })}
                  style={{ ...fieldStyle, maxWidth: '420px', borderColor: 'rgba(139, 255, 179, 0.3)' }}
                >
                  {availableModelIds.map((id) => (
                    <option key={id} value={id}>
                      {modelLabelById[id]} ({id})
                    </option>
                  ))}
                </select>
                <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {health?.routing.appBuilderBuilder ? 'BUILD ROUTE READY' : 'USING DEFAULT'}
                </div>
              </div>
            </div>

            <div style={specialistCardStyle}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
                <div style={statusOrbStyle('var(--neon-purple)', 'var(--neon-purple)')} />
                <strong style={{ fontSize: '1rem', letterSpacing: '0.5px' }}>Ending Special Agent (Output Reviewer)</strong>
              </div>
              <p style={specialistCopyStyle}>
                This verification lane reviews the final response against the request before RawClaw ships an answer.
              </p>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                <select
                  value={health?.routing.outputReviewer || ''}
                  onChange={(event) => void updateRouting({ outputReviewer: event.target.value })}
                  style={{ ...fieldStyle, maxWidth: '420px', borderColor: 'rgba(157, 0, 255, 0.3)' }}
                >
                  <option value="">Disabled (Fastest)</option>
                  {availableModelIds.map((id) => (
                    <option key={id} value={id}>
                      {modelLabelById[id]} ({id})
                    </option>
                  ))}
                </select>
                <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {health?.routing.outputReviewer ? 'ENABLED (HIGHER QUALITY)' : 'INACTIVE'}
                </div>
              </div>
            </div>
          </div>

          <div style={specialistCardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
              <div style={statusOrbStyle('var(--neon-cyan)', 'var(--neon-cyan)')} />
              <strong style={{ fontSize: '1rem', letterSpacing: '0.5px' }}>Initial Analysis Specialist (Decision Level)</strong>
            </div>
            <p style={specialistCopyStyle}>
              This gate decides whether a request can stay lightweight or should escalate into deeper retrieval, tooling, or research.
            </p>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <div style={alwaysActiveBadgeStyle}>
                ALWAYS ACTIVE
              </div>
              <div className="mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                Built-in heuristic, no separate model slot
              </div>
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.85rem' }}>
              <div>
                <h3 style={{ fontSize: '1rem', marginBottom: '0.2rem' }}>Agent Profiles</h3>
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
                  Reassign each saved agent profile to a dedicated model without leaving this page.
                </div>
              </div>
              <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                {saving ? 'Saving...' : `${agents.length} agents`}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
              {agents.length === 0 ? (
                <div style={{ ...specialistCardStyle, gridColumn: '1 / -1' }}>
                  <div style={{ color: 'var(--text-secondary)' }}>
                    No saved agent profiles exist yet. Create them on the Agents page, then tune their model assignments here.
                  </div>
                </div>
              ) : (
                agents.map((agent) => (
                  <div key={agent.id} style={specialistCardStyle}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '1rem' }}>{agent.name}</div>
                        <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem', marginTop: '0.15rem' }}>
                          {agent.status.toUpperCase()} {agent.isDefault ? '• DEFAULT' : ''}
                        </div>
                      </div>
                      <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                        {agent.modelId ? 'MODEL PINNED' : 'USES CHAT ROUTING'}
                      </div>
                    </div>

                    {agent.description ? (
                      <p style={specialistCopyStyle}>{agent.description}</p>
                    ) : null}

                    <select
                      value={agent.modelId || ''}
                      onChange={(event) => void updateAgentModel(agent.id, event.target.value)}
                      style={fieldStyle}
                    >
                      <option value="">Use complexity/default routing</option>
                      {availableModelIds.map((id) => (
                        <option key={id} value={id}>
                          {modelLabelById[id]} ({id})
                        </option>
                      ))}
                    </select>

                    <div className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {agent.modelId ? `Current: ${agent.modelId}` : 'Current: runtime routing decides'}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="glass-card">
        <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Available models</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
          {models.map((model) => (
            <div key={model.id} style={providerCardStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
                <strong>{model.customName || model.name || model.id}</strong>
                <span className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                  {model.provider}
                </span>
              </div>
              <div className="mono" style={{ color: 'var(--text-secondary)', fontSize: '0.74rem' }}>
                {model.id}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

const fieldStyle: CSSProperties = {
  width: '100%',
  padding: '0.8rem 0.9rem',
  borderRadius: '12px',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
};

const providerCardStyle: CSSProperties = {
  border: '1px solid var(--border-glass)',
  borderRadius: '16px',
  padding: '1rem',
  background: 'rgba(255,255,255,0.03)',
};

const specialistsSectionStyle: CSSProperties = {
  border: '1px solid var(--neon-cyan)',
  boxShadow: '0 0 20px var(--neon-cyan-glow)',
  background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.05), rgba(157, 0, 255, 0.02))',
};

const specialistCardStyle: CSSProperties = {
  background: 'rgba(0,0,0,0.2)',
  padding: '1.2rem',
  borderRadius: '12px',
  border: '1px solid var(--border-glass)',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
};

const specialistCopyStyle: CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: '0.85rem',
  lineHeight: '1.4',
  margin: 0,
};

const alwaysActiveBadgeStyle: CSSProperties = {
  padding: '0.5rem 1.2rem',
  borderRadius: '10px',
  background: 'rgba(0, 240, 255, 0.08)',
  border: '1px solid rgba(0, 240, 255, 0.2)',
  fontSize: '0.85rem',
  color: 'var(--neon-cyan)',
  fontWeight: 600,
};

function statusOrbStyle(background: string, glow: string): CSSProperties {
  return {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background,
    boxShadow: `0 0 10px ${glow}`,
  };
}
