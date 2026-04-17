import { useEffect, useState } from 'react';
import { SkillDefinition } from '@rawclaw/shared';
import { api } from '../lib/api';
import { SkillRunner } from '../components/skills/SkillRunner';

export default function Skills() {
  const [skills, setSkills] = useState<SkillDefinition[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<string | undefined>();

  useEffect(() => {
    void loadSkills();
  }, []);

  const loadSkills = async () => {
    const response = await api.get<SkillDefinition[]>('/skills');
    setSkills(response.data);
    setSelectedSkill((current) => current || response.data[0]?.name);
  };

  return (
    <div className="animate-in" style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.1fr', gap: '1.5rem' }}>
      <section className="glass-card">
        <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Skills</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
          Installed skills exposed by the agent runtime, ready to execute from the UI.
        </p>
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
      </section>

      <SkillRunner skills={skills} initialSkillName={selectedSkill} />
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
