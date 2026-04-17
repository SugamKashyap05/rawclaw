import { useEffect, useState } from 'react';
import { SettingsPayload, UpdateSettingsRequest } from '@rawclaw/shared';
import { api } from '../lib/api';

const EMPTY_SETTINGS: SettingsPayload = {
  settings: {
    theme: 'dark',
    language: 'en',
    autoStart: false,
    aiProviders: {},
    bots: {
      telegramEnabled: false,
      discordEnabled: false,
    },
    security: {
      verifySignatures: true,
      publicKey: '',
    },
    integrations: {
      githubConnected: false,
      slackConnected: false,
    },
  },
  workspaceFiles: {
    soul: '',
    user: '',
    memory: '',
    tools: '',
  },
};

export default function Settings() {
  const [payload, setPayload] = useState<SettingsPayload>(EMPTY_SETTINGS);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    const response = await api.get<SettingsPayload>('/settings');
    setPayload(response.data);
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const body: UpdateSettingsRequest = payload;
      const response = await api.post<SettingsPayload>('/settings', body);
      setPayload(response.data);
      setMessage('Settings saved.');
    } finally {
      setSaving(false);
    }
  };

  const startStopBot = async (bot: 'telegram' | 'discord', enabled: boolean) => {
    await api.post(`/settings/bots/${bot}/${enabled ? 'stop' : 'start'}`);
    await load();
  };

  return (
    <div className="animate-in" style={{ display: 'grid', gap: '1.5rem' }}>
      <section className="glass-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Settings</h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Persist provider config, bot controls, security defaults, and the workspace markdown files the agent reads.
            </p>
          </div>
          <button className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'Saving...' : 'Save settings'}
          </button>
        </div>
        {message ? <div style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{message}</div> : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
          <div className="glass-card">
            <h2 style={{ fontSize: '1.1rem', marginBottom: '0.9rem' }}>General</h2>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <select value={payload.settings.theme} onChange={(event) => setPayload((current) => ({ ...current, settings: { ...current.settings, theme: event.target.value as 'dark' | 'light' } }))} style={fieldStyle}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
              <input value={payload.settings.language} onChange={(event) => setPayload((current) => ({ ...current, settings: { ...current.settings, language: event.target.value } }))} placeholder="Language" style={fieldStyle} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <input type="checkbox" checked={payload.settings.autoStart} onChange={(event) => setPayload((current) => ({ ...current, settings: { ...current.settings, autoStart: event.target.checked } }))} />
                Auto-start local services
              </label>
            </div>
          </div>

          <div className="glass-card">
            <h2 style={{ fontSize: '1.1rem', marginBottom: '0.9rem' }}>AI Providers</h2>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <input value={payload.settings.aiProviders.openaiApiKey || ''} onChange={(event) => setPayload((current) => ({ ...current, settings: { ...current.settings, aiProviders: { ...current.settings.aiProviders, openaiApiKey: event.target.value } } }))} placeholder="OpenAI API key" type="password" style={fieldStyle} />
              <input value={payload.settings.aiProviders.anthropicApiKey || ''} onChange={(event) => setPayload((current) => ({ ...current, settings: { ...current.settings, aiProviders: { ...current.settings.aiProviders, anthropicApiKey: event.target.value } } }))} placeholder="Anthropic API key" type="password" style={fieldStyle} />
              <input value={payload.settings.aiProviders.googleApiKey || ''} onChange={(event) => setPayload((current) => ({ ...current, settings: { ...current.settings, aiProviders: { ...current.settings.aiProviders, googleApiKey: event.target.value } } }))} placeholder="Google API key" type="password" style={fieldStyle} />
              <input value={payload.settings.aiProviders.ollamaUrl || ''} onChange={(event) => setPayload((current) => ({ ...current, settings: { ...current.settings, aiProviders: { ...current.settings.aiProviders, ollamaUrl: event.target.value } } }))} placeholder="Ollama URL" style={fieldStyle} />
            </div>
          </div>

          <div className="glass-card">
            <h2 style={{ fontSize: '1.1rem', marginBottom: '0.9rem' }}>Bots</h2>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <input value={payload.settings.bots.telegramToken || ''} onChange={(event) => setPayload((current) => ({ ...current, settings: { ...current.settings, bots: { ...current.settings.bots, telegramToken: event.target.value } } }))} placeholder="Telegram token" style={fieldStyle} />
              <button className="btn-ghost" onClick={() => void startStopBot('telegram', payload.settings.bots.telegramEnabled)}>
                {payload.settings.bots.telegramEnabled ? 'Stop Telegram bot' : 'Start Telegram bot'}
              </button>
              <input value={payload.settings.bots.discordToken || ''} onChange={(event) => setPayload((current) => ({ ...current, settings: { ...current.settings, bots: { ...current.settings.bots, discordToken: event.target.value } } }))} placeholder="Discord token" style={fieldStyle} />
              <button className="btn-ghost" onClick={() => void startStopBot('discord', payload.settings.bots.discordEnabled)}>
                {payload.settings.bots.discordEnabled ? 'Stop Discord bot' : 'Start Discord bot'}
              </button>
            </div>
          </div>

          <div className="glass-card">
            <h2 style={{ fontSize: '1.1rem', marginBottom: '0.9rem' }}>Security</h2>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
                <input
                  type="checkbox"
                  checked={payload.settings.security.verifySignatures}
                  onChange={(event) =>
                    setPayload((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        security: { ...current.settings.security, verifySignatures: event.target.checked },
                      },
                    }))
                  }
                />
                Verify signatures
              </label>
              <textarea value={payload.settings.security.publicKey} readOnly rows={6} style={{ ...fieldStyle, resize: 'vertical' }} />
            </div>
          </div>
        </div>
      </section>

      <section className="glass-card">
        <h2 style={{ fontSize: '1.15rem', marginBottom: '1rem' }}>Workspace files</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
          <WorkspaceEditor
            label="SOUL.md"
            value={payload.workspaceFiles.soul}
            onChange={(value) => setPayload((current) => ({ ...current, workspaceFiles: { ...current.workspaceFiles, soul: value } }))}
          />
          <WorkspaceEditor
            label="USER.md"
            value={payload.workspaceFiles.user}
            onChange={(value) => setPayload((current) => ({ ...current, workspaceFiles: { ...current.workspaceFiles, user: value } }))}
          />
          <WorkspaceEditor
            label="MEMORY.md"
            value={payload.workspaceFiles.memory}
            onChange={(value) => setPayload((current) => ({ ...current, workspaceFiles: { ...current.workspaceFiles, memory: value } }))}
          />
          <WorkspaceEditor
            label="TOOLS.md"
            value={payload.workspaceFiles.tools}
            onChange={(value) => setPayload((current) => ({ ...current, workspaceFiles: { ...current.workspaceFiles, tools: value } }))}
          />
        </div>
      </section>
    </div>
  );
}

function WorkspaceEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mono" style={{ display: 'block', marginBottom: '0.45rem', fontSize: '0.72rem' }}>
        {label}
      </label>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={10} style={{ ...fieldStyle, resize: 'vertical' }} />
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
