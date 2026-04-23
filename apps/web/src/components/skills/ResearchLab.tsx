import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export function ResearchLab() {
  const [repoUrl, setRepoUrl] = useState('');
  const [cloning, setCloning] = useState(false);
  const [researchedSkills, setResearchedSkills] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void fetchResearchedSkills();
  }, []);

  const fetchResearchedSkills = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ skills: any[] }>('/skills/research');
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
      await api.post('/skills/install', { source_path: sourcePath });
      alert('Skill installed successfully!');
      await fetchResearchedSkills();
    } catch (e) {
      console.error(e);
      alert('Failed to install skill.');
    }
  };

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
          {researchedSkills.map((skill, idx) => (
            <div
              key={idx}
              style={{
                border: '1px solid var(--border-glass)',
                background: 'rgba(255,255,255,0.02)',
                borderRadius: '14px',
                padding: '1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
              }}
            >
              <div>
                <div style={{ fontWeight: 700, marginBottom: '0.3rem' }}>{skill.name}</div>
                <div style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                  {skill.description}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  Repo: <code>{skill.repo}</code>
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
      )}
    </section>
  );
}
