import { useMemo, useState } from 'react';
import { SkillDefinition, SkillRunResponse } from '@rawclaw/shared';
import { api } from '../../lib/api';

interface SkillRunnerProps {
  skills: SkillDefinition[];
  initialSkillName?: string;
}

export function SkillRunner({ skills, initialSkillName }: SkillRunnerProps) {
  const [selectedName, setSelectedName] = useState(initialSkillName || skills[0]?.name || '');
  const [params, setParams] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SkillRunResponse | null>(null);

  const selectedSkill = useMemo(
    () => skills.find((skill) => skill.name === selectedName) || null,
    [skills, selectedName],
  );

  const parameterKeys = useMemo(() => {
    if (!selectedSkill) return [];
    const raw = selectedSkill.parameters;
    if (raw && typeof raw === 'object') return Object.keys(raw);
    return [];
  }, [selectedSkill]);

  const runSkill = async () => {
    if (!selectedSkill) return;
    setRunning(true);
    setResult(null);
    try {
      const payload = Object.fromEntries(
        Object.entries(params).filter((entry) => entry[1].trim().length > 0),
      );
      const response = await api.post<SkillRunResponse>(`/skills/${selectedSkill.name}/run`, {
        params: payload,
      });
      setResult(response.data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Skill execution failed';
      setResult({ success: false, error: message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="glass-card" style={{ display: 'grid', gap: '1rem' }}>
      <div>
        <div className="mono" style={{ color: 'var(--neon-cyan)', fontSize: '0.72rem', marginBottom: '0.4rem' }}>
          SKILL RUNNER
        </div>
        <select
          value={selectedName}
          onChange={(event) => {
            setSelectedName(event.target.value);
            setResult(null);
          }}
          style={fieldStyle}
        >
          {skills.map((skill) => (
            <option key={skill.name} value={skill.name}>
              {skill.name}
            </option>
          ))}
        </select>
      </div>

      {selectedSkill ? (
        <>
          <div style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{selectedSkill.description}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
            {selectedSkill.capabilityTags.map((tag) => (
              <span key={tag} className="mono" style={tagStyle}>
                {tag}
              </span>
            ))}
          </div>

          <div style={{ display: 'grid', gap: '0.8rem' }}>
            {parameterKeys.length === 0 ? (
              <div style={{ color: 'var(--text-muted)' }}>This skill does not declare any structured parameters.</div>
            ) : (
              parameterKeys.map((key) => (
                <div key={key}>
                  <label className="mono" style={{ display: 'block', marginBottom: '0.35rem', fontSize: '0.72rem' }}>
                    {key}
                  </label>
                  <input
                    value={params[key] || ''}
                    onChange={(event) => setParams((current) => ({ ...current, [key]: event.target.value }))}
                    style={fieldStyle}
                    placeholder={`Enter ${key}`}
                  />
                </div>
              ))
            )}
          </div>

          <button className="btn-primary" onClick={runSkill} disabled={running}>
            {running ? 'RUNNING...' : 'EXECUTE SKILL'}
          </button>

          {result ? (
            <div
              style={{
                borderRadius: '12px',
                border: '1px solid var(--border-glass)',
                background: 'rgba(255,255,255,0.03)',
                padding: '0.9rem',
              }}
            >
              <div className="mono" style={{ color: result.success ? 'var(--success)' : 'var(--error)', fontSize: '0.72rem', marginBottom: '0.5rem' }}>
                {result.success ? 'SUCCESS' : 'FAILED'}
              </div>
              <pre className="custom-scrollbar" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowX: 'auto' }}>
                {JSON.stringify(result.success ? result.result : result.error, null, 2)}
              </pre>
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ color: 'var(--text-muted)' }}>No skills available yet.</div>
      )}
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

const tagStyle = {
  fontSize: '0.68rem',
  padding: '0.22rem 0.55rem',
  borderRadius: '999px',
  background: 'rgba(255,255,255,0.06)',
  color: 'var(--text-secondary)',
};
