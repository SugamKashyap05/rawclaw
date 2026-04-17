import { useEffect, useMemo, useState } from 'react';
import { ModelInfo, ModelsHealthResponse, ProviderConfigState } from '@rawclaw/shared';
import { api } from '../lib/api';

interface ModelWithPreference extends ModelInfo {
  customName?: string;
  isFavorite: boolean;
  preferenceId?: string;
}

const PROVIDERS = ['openai', 'anthropic', 'google', 'ollama'] as const;

export default function Models() {
  const [models, setModels] = useState<ModelWithPreference[]>([]);
  const [health, setHealth] = useState<ModelsHealthResponse | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    const [modelsResponse, healthResponse] = await Promise.all([
      api.get<ModelWithPreference[]>('/models'),
      api.get<ModelsHealthResponse>('/models/health'),
    ]);
    setModels(modelsResponse.data);
    setHealth(healthResponse.data);
  };

  const modelsByProvider = useMemo(() => {
    return models.reduce<Record<string, ModelWithPreference[]>>((accumulator, model) => {
      accumulator[model.provider] = accumulator[model.provider] || [];
      accumulator[model.provider].push(model);
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

  const availableModelIds = models.map((model) => model.id);

  return (
    <div className="animate-in" style={{ display: 'grid', gap: '1.5rem' }}>
      <section className="glass-card">
        <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Models</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.2rem' }}>
          Manage providers, routing policy, and local-vs-cloud execution preferences from one place.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '1rem' }}>
          {PROVIDERS.map((provider) => {
            const providerState = health?.providerConfig[provider] || { enabled: false };
            const providerHealth = health?.providers[provider];
            const providerModels = modelsByProvider[provider] || [];

            return (
              <div key={provider} style={{ border: '1px solid var(--border-glass)', borderRadius: '16px', padding: '1rem', background: 'rgba(255,255,255,0.03)' }}>
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
                    {id}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      <section className="glass-card">
        <h2 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Available models</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
          {models.map((model) => (
            <div key={model.id} style={{ border: '1px solid var(--border-glass)', borderRadius: '14px', padding: '0.9rem', background: 'rgba(255,255,255,0.03)' }}>
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

const fieldStyle = {
  width: '100%',
  padding: '0.8rem 0.9rem',
  borderRadius: '12px',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
};
