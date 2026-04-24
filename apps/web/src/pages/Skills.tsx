import { useEffect, useState } from 'react';
import { SkillDefinition } from '@rawclaw/shared';
import { api } from '../lib/api';
import { SkillRunner } from '../components/skills/SkillRunner';
import { ResearchLab } from '../components/skills/ResearchLab';
import { SkillBuilder } from '../components/skills/SkillBuilder';

type Tab = 'installed' | 'research' | 'builder';
type SkillStatus = {
  status: string;
  activeSkillsDir: string;
  researchDir: string;
  activePluginsDir?: string;
  installedCount: number;
  installedSkillFiles: string[];
  researchedCount: number;
  installedPluginBundleCount?: number;
  installedPluginBundles?: string[];
};

export default function Skills() {
  const [activeTab, setActiveTab] = useState<Tab>('installed');
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | undefined>();
  const [status, setStatus] = useState<SkillStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([loadSkills(), loadStatus()]);
  }, []);

  const loadSkills = async () => {
    const response = await api.get<SkillDefinition[]>('/skills');
    setSkills(response.data);
    setSelectedSkill((current) => current || response.data[0]?.name);
  };

  const loadStatus = async () => {
    try {
      const response = await api.get<SkillStatus>('/skills/status');
      setStatus(response.data);
      setError(null);
    } catch (statusError) {
      console.error(statusError);
      setStatus(null);
      setError('Unable to load skill runtime status right now.');
    }
  };

  const refreshInstalled = async () => {
    await Promise.all([loadSkills(), loadStatus()]);
  };

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <section className="glass-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '1rem' }}>
        <StatusMetric label="Installed skills" value={String(status?.installedCount ?? skills.length)} />
        <StatusMetric label="Researched skills" value={String(status?.researchedCount ?? 0)} />
        <StatusMetric label="Plugin bundles" value={String(status?.installedPluginBundleCount ?? 0)} />
        <StatusMetric label="Runtime" value={status?.status || (error ? 'degraded' : 'loading')} />
        <div style={{ gridColumn: '1 / -1', color: 'var(--text-secondary)', fontSize: '0.84rem', lineHeight: 1.6 }}>
          <div>Active skills directory: <code>{status?.activeSkillsDir || 'Unavailable'}</code></div>
          <div>Active plugin imports: <code>{status?.activePluginsDir || 'Unavailable'}</code></div>
          <div>Research directory: <code>{status?.researchDir || 'Unavailable'}</code></div>
          {status?.installedPluginBundles?.length ? (
            <div>Installed plugin bundles: <code>{status.installedPluginBundles.join(', ')}</code></div>
          ) : null}
          {error ? <div style={{ color: 'var(--error)' }}>{error}</div> : null}
        </div>
      </section>

      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border-glass)', paddingBottom: '0.5rem' }}>
        <button 
          className={activeTab === 'installed' ? 'btn-primary' : 'btn-ghost'} 
          onClick={() => setActiveTab('installed')}
        >
          Installed Skills
        </button>
        <button 
          className={activeTab === 'research' ? 'btn-primary' : 'btn-ghost'} 
          onClick={() => setActiveTab('research')}
        >
          Research Lab
        </button>
        <button 
          className={activeTab === 'builder' ? 'btn-primary' : 'btn-ghost'} 
          onClick={() => setActiveTab('builder')}
        >
          Skill Builder
        </button>
        <button className="btn-ghost" onClick={() => void refreshInstalled()} style={{ marginLeft: 'auto' }}>
          Refresh Status
        </button>
      </div>

      {activeTab === 'installed' && (
        <div style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.1fr', gap: '1.5rem' }}>
          <section className="glass-card">
            <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Skills</h1>
            <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Installed skills exposed by the agent runtime, ready to execute from the UI.
            </p>
            {skills.length === 0 ? (
              <div style={{ border: '1px solid var(--border-glass)', background: 'rgba(255,255,255,0.02)', borderRadius: '16px', padding: '1rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700, color: 'var(--text-primary)', marginBottom: '0.35rem' }}>No installed skills discovered yet.</div>
                <div style={{ marginBottom: '0.75rem' }}>
                  The skills runtime is active, but it did not find any installed <code>SKILL.md</code> files to expose.
                </div>
                <div>Next steps:</div>
                <div>1. Use <strong>Skill Builder</strong> to create a starter skill.</div>
                <div>2. Or use <strong>Research Lab</strong> to clone and install one.</div>
                <div>3. Then return here and press <strong>Refresh Status</strong>.</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.9rem' }}>
                {skills.map((skill) => (
                  <button
                    key={skill.name}
                    className="btn-ghost"
                    onClick={() => setSelectedSkill(skill.name)}
                    style={{
                      textAlign: 'left',
                      border: skill.name === selectedSkill ? '1px solid rgba(0,240,255,0.25)' : '1px solid var(--border-glass)',
                      background: skill.name === selectedSkill ? 'rgba(0,240,255,0.08)' : 'rgba(255,255,255,0.02)',
                      borderRadius: '14px',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>{skill.name}</div>
                    <div style={{ color: 'var(--text-secondary)', marginBottom: '0.55rem' }}>{skill.description}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {skill.capabilityTags.map((tag) => (
                        <span key={tag} className="mono" style={tagStyle}>
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <SkillRunner skills={skills} initialSkillName={selectedSkill} />
        </div>
      )}

      {activeTab === 'research' && <ResearchLab onChanged={() => void refreshInstalled()} />}
      
      {activeTab === 'builder' && <SkillBuilder onChanged={() => void refreshInstalled()} />}
    </div>
  );
}

function StatusMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--border-glass)', borderRadius: '14px', padding: '0.9rem', background: 'rgba(255,255,255,0.03)' }}>
      <div className="mono" style={{ color: 'var(--text-muted)', fontSize: '0.68rem', marginBottom: '0.35rem' }}>{label}</div>
      <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{value}</div>
    </div>
  );
}

const tagStyle = {
  fontSize: '0.68rem',
  padding: '0.22rem 0.55rem',
  borderRadius: '999px',
  background: 'rgba(255,255,255,0.06)',
  color: 'var(--text-secondary)',
};
