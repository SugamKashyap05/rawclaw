import { useEffect, useState } from 'react';
import { SettingsPayload } from '@rawclaw/shared';
import { api } from '../lib/api';

export default function Integrations() {
  const [payload, setPayload] = useState<SettingsPayload | null>(null);

  useEffect(() => {
    void load();
  }, []);

  const load = async () => {
    const response = await api.get<SettingsPayload>('/settings');
    setPayload(response.data);
  };

  const toggle = async (provider: 'github' | 'slack', connected: boolean) => {
    const endpoint = connected ? `/settings/integrations/${provider}/disconnect` : `/settings/integrations/${provider}/connect`;
    await api.post(endpoint);
    await load();
  };

  const integrations = payload?.settings.integrations;

  return (
    <div className="animate-in">
      <div className="glass-card">
        <h1 style={{ fontSize: '2rem', marginBottom: '0.4rem' }}>Integrations</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.4rem' }}>
          Manage external surfaces connected to RawClaw from one place.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '1rem' }}>
          <IntegrationCard
            title="GitHub"
            connected={integrations?.githubConnected || false}
            description="Use GitHub as a remote execution and collaboration surface."
            onToggle={() => void toggle('github', integrations?.githubConnected || false)}
          />
          <IntegrationCard
            title="Slack"
            connected={integrations?.slackConnected || false}
            description="Route updates and command notifications through Slack."
            onToggle={() => void toggle('slack', integrations?.slackConnected || false)}
          />
        </div>
      </div>
    </div>
  );
}

function IntegrationCard({
  title,
  description,
  connected,
  onToggle,
}: {
  title: string;
  description: string;
  connected: boolean;
  onToggle: () => void;
}) {
  return (
    <div style={{ border: '1px solid var(--border-glass)', borderRadius: '16px', padding: '1rem', background: 'rgba(255,255,255,0.03)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', gap: '1rem' }}>
        <h2 style={{ fontSize: '1.1rem' }}>{title}</h2>
        <span className={`status-dot ${connected ? 'ok' : 'down'}`} />
      </div>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{description}</p>
      <button className={connected ? 'btn-ghost' : 'btn-primary'} onClick={onToggle}>
        {connected ? 'Disconnect' : 'Connect'}
      </button>
    </div>
  );
}
