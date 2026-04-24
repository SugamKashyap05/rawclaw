import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

type Compatibility = {
  status: 'compatible' | 'partial' | 'incompatible';
  score: number;
  reasons: string[];
};

type PluginSystem = {
  platform: string;
  name: string;
  version?: string;
  description?: string;
  is_installed?: boolean;
};

type Marketplace = {
  platform: string;
  name: string;
  plugin_count: number;
};

type AgentTemplate = {
  name: string;
  description?: string;
};

type ResearchedSkill = {
  kind?: 'skill' | 'plugin_bundle';
  name: string;
  description: string;
  source_path: string;
  repo?: string;
  repo_root?: string;
  is_installed?: boolean;
  plugin_bundle_installed?: boolean;
  compatibility?: Compatibility;
  plugin_systems?: PluginSystem[];
  marketplaces?: Marketplace[];
  agent_templates?: AgentTemplate[];
};

type InstallResponse = {
  success?: boolean;
  installed?: Array<{ skill_name: string }>;
  skill_name?: string;
  plugin_bundle?: { bundle_name?: string; platforms?: string[]; success?: boolean };
  autoAssignment?: {
    strategy?: string;
    compatibleSkills?: string[];
    agents?: Array<{ name: string; mode: string }>;
  };
};

export function ResearchLab({ onChanged }: { onChanged?: () => void }) {
  const [repoUrl, setRepoUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [researchedSkills, setResearchedSkills] = useState<ResearchedSkill[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetchResearchedSkills();
  }, []);

  const fetchResearchedSkills = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ skills: ResearchedSkill[] }>('/skills/research');
      setResearchedSkills(res.data.skills);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleClone = async () => {
    if (!repoUrl) return;
    setCloning(true);
    try {
      await api.post('/skills/clone', { repo_url: repoUrl });
      await fetchResearchedSkills();
      onChanged?.();
      setRepoUrl('');
    } catch (e) {
      console.error(e);
      alert('Failed to clone repository.');
    } finally {
      setCloning(false);
    }
  };

  const handleInstall = async (sourcePath: string) => {
    try {
      const response = await api.post<InstallResponse>('/skills/install', { source_path: sourcePath });
      alert(formatInstallMessage(response.data));
      await fetchResearchedSkills();
      onChanged?.();
    } catch (e) {
      console.error(e);
      alert('Failed to install skill.');
    }
  };

  const handleInstallRepo = async (repoRoot: string) => {
    try {
      const response = await api.post<InstallResponse>('/skills/install', { source_path: repoRoot });
      alert(formatInstallMessage(response.data));
      await fetchResearchedSkills();
      onChanged?.();
    } catch (e) {
      console.error(e);
      alert('Failed to install skill library.');
    }
  };

  const groupedByRepo = researchedSkills.reduce<Record<string, ResearchedSkill[]>>((acc, skill) => {
    const key = skill.repo || 'unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(skill);
    return acc;
  }, {});

  return (
    <section className="glass-card">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Research Lab</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        Clone repositories to research them, and install them into your active workspace.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
        <input
          type="text"
          placeholder="GitHub Repository URL"
          className="input-base"
          value={repoUrl}
          onChange={(e) => setRepoUrl(e.target.value)}
          style={{ flex: 1 }}
        />
        <button className="btn-primary" onClick={handleClone} disabled={cloning}>
          {cloning ? 'Cloning...' : 'Clone Repository'}
        </button>
      </div>

      <h3 style={{ fontSize: '1.2rem', marginBottom: '1rem' }}>Researched Skills</h3>
      {loading ? (
        <p>Loading...</p>
      ) : researchedSkills.length === 0 ? (
        <p style={{ color: 'var(--text-secondary)' }}>No skills researched yet.</p>
      ) : (
        <div style={{ display: 'grid', gap: '1rem' }}>
          {Object.entries(groupedByRepo).map(([repo, repoSkills]) => {
            const repoRoot = repoSkills[0]?.repo_root;
            const allInstalled = repoSkills.every((skill) => skill.is_installed);
            const repoPlugins = uniqueByPlatform(repoSkills.flatMap((skill) => skill.plugin_systems || []));
            const repoMarketplaces = uniqueByKey(repoSkills.flatMap((skill) => skill.marketplaces || []), (entry) => `${entry.platform}:${entry.name}`);
            const repoAgents = uniqueByKey(repoSkills.flatMap((skill) => skill.agent_templates || []), (entry) => entry.name);
            const repoCompatibility = deriveRepoCompatibility(repoSkills);
            return (
              <div
                key={repo}
                style={{
                  border: '1px solid var(--border-glass)',
                  background: 'rgba(255,255,255,0.02)',
                  borderRadius: '14px',
                  padding: '1rem',
                  display: 'grid',
                  gap: '0.9rem',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>{repo}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                      {repoSkills.length} discovered skill{repoSkills.length === 1 ? '' : 's'}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginTop: '0.55rem' }}>
                      <CompatibilityBadge compatibility={repoCompatibility} />
                      {repoPlugins.map((plugin) => (
                        <span key={`${repo}-${plugin.platform}`} className="mono" style={pillStyle}>
                          {plugin.platform} plugin
                        </span>
                      ))}
                      {repoMarketplaces.map((marketplace) => (
                        <span key={`${repo}-${marketplace.platform}-${marketplace.name}`} className="mono" style={pillStyle}>
                          {marketplace.platform} marketplace
                        </span>
                      ))}
                      {repoAgents.length ? (
                        <span className="mono" style={pillStyle}>
                          {repoAgents.length} agent template{repoAgents.length === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  {repoRoot ? (
                    <button
                      className={allInstalled ? 'btn-ghost' : 'btn-primary'}
                      onClick={() => handleInstallRepo(repoRoot)}
                      disabled={allInstalled}
                    >
                      {allInstalled ? 'Library Installed' : 'Install All'}
                    </button>
                  ) : null}
                </div>

                {repoPlugins.length || repoMarketplaces.length || repoAgents.length ? (
                  <div style={{ display: 'grid', gap: '0.45rem', color: 'var(--text-secondary)', fontSize: '0.84rem' }}>
                    {repoPlugins.length ? (
                      <div>
                        Plugin systems: {repoPlugins.map((plugin) => `${plugin.platform}${plugin.version ? ` ${plugin.version}` : ''}`).join(', ')}
                      </div>
                    ) : null}
                    {repoMarketplaces.length ? (
                      <div>
                        Marketplace metadata: {repoMarketplaces.map((marketplace) => `${marketplace.name} (${marketplace.platform})`).join(', ')}
                      </div>
                    ) : null}
                    {repoAgents.length ? (
                      <div>
                        Agent templates: {repoAgents.map((agent) => agent.name).join(', ')}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div style={{ display: 'grid', gap: '0.75rem' }}>
                  {repoSkills.map((skill, idx) => (
                    <div
                      key={`${repo}-${idx}`}
                      style={{
                        border: '1px solid var(--border-glass)',
                        background: 'rgba(255,255,255,0.015)',
                        borderRadius: '12px',
                        padding: '0.85rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '1rem',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>{skill.name}</div>
                        <div style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                          {skill.description}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem', marginBottom: '0.55rem' }}>
                          <CompatibilityBadge compatibility={skill.compatibility} />
                          {(skill.plugin_systems || []).map((plugin) => (
                            <span key={`${skill.name}-${plugin.platform}`} className="mono" style={pillStyle}>
                              {plugin.platform}
                            </span>
                          ))}
                          {skill.plugin_bundle_installed ? (
                            <span className="mono" style={pillStyle}>
                              plugin bundle installed
                            </span>
                          ) : null}
                        </div>
                        {skill.compatibility?.reasons?.length ? (
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '0.45rem' }}>
                            {skill.compatibility.reasons.join(' ')}
                          </div>
                        ) : null}
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          Path: <code>{skill.source_path}</code>
                        </div>
                      </div>
                      <button
                        className={skill.is_installed ? 'btn-ghost' : 'btn-primary'}
                        onClick={() => handleInstall(skill.source_path)}
                        disabled={skill.is_installed}
                        style={{ minWidth: '100px' }}
                      >
                        {skill.is_installed ? 'Installed' : 'Install'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatInstallMessage(response: InstallResponse) {
  const skillNames = [
    ...(typeof response.skill_name === 'string' ? [response.skill_name] : []),
    ...((response.installed || []).map((entry) => entry.skill_name).filter(Boolean)),
  ];
  const dedupedSkills = [...new Set(skillNames)];
  const bundle = response.plugin_bundle;
  const assignedAgents = response.autoAssignment?.agents || [];

  const lines = [];
  if (dedupedSkills.length) {
    lines.push(`Installed skills: ${dedupedSkills.join(', ')}`);
  }
  if (bundle?.success && bundle.bundle_name) {
    lines.push(`Imported plugin bundle: ${bundle.bundle_name}${bundle.platforms?.length ? ` (${bundle.platforms.join(', ')})` : ''}`);
  }
  if (assignedAgents.length) {
    lines.push(`Auto-assigned to agents: ${assignedAgents.map((agent) => `${agent.name} (${agent.mode})`).join(', ')}`);
  }
  return lines.length ? lines.join('\n') : 'Install completed successfully.';
}

function CompatibilityBadge({ compatibility }: { compatibility?: Compatibility }) {
  if (!compatibility) return null;
  const color =
    compatibility.status === 'compatible'
      ? 'rgba(37, 99, 235, 0.18)'
      : compatibility.status === 'partial'
        ? 'rgba(245, 158, 11, 0.18)'
        : 'rgba(220, 38, 38, 0.18)';
  return (
    <span className="mono" style={{ ...pillStyle, background: color }}>
      {compatibility.status} {compatibility.score}
    </span>
  );
}

function uniqueByPlatform<T extends { platform: string }>(entries: T[]) {
  return uniqueByKey(entries, (entry) => entry.platform);
}

function uniqueByKey<T>(entries: T[], getKey: (entry: T) => string) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = getKey(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deriveRepoCompatibility(skills: ResearchedSkill[]): Compatibility | undefined {
  const candidates = skills.map((skill) => skill.compatibility).filter(Boolean) as Compatibility[];
  if (!candidates.length) return undefined;
  return candidates.reduce((current, candidate) => (candidate.score < current.score ? candidate : current));
}

const pillStyle = {
  fontSize: '0.72rem',
  padding: '0.22rem 0.55rem',
  borderRadius: '999px',
  background: 'rgba(255,255,255,0.06)',
  color: 'var(--text-secondary)',
};
