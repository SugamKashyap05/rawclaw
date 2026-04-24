import { useState } from 'react';
import { api } from '../../lib/api';

export function SkillBuilder({ onChanged }: { onChanged?: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [instructions, setInstructions] = useState('');
  const [building, setBuilding] = useState(false);

  const handleBuild = async () => {
    if (!name || !instructions) {
      alert('Name and Instructions are required.');
      return;
    }
    
    setBuilding(true);
    try {
      const tagsList = tags.split(',').map((t) => t.trim()).filter((t) => t.length > 0);
      
      const res = await api.post('/skills/build', {
        name,
        description,
        tags: tagsList,
        instructions,
      });
      
      if (res.data.success) {
        alert('Skill built and installed successfully!');
        setName('');
        setDescription('');
        setTags('');
        setInstructions('');
        onChanged?.();
      } else {
        alert(`Failed to build skill: ${res.data.error || 'Unknown error'}`);
      }
    } catch (e: any) {
      console.error(e);
      alert(`Error: ${e.message}`);
    } finally {
      setBuilding(false);
    }
  };

  return (
    <section className="glass-card">
      <h2 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>Skill Builder</h2>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem' }}>
        Create a brand new custom skill directly from the UI.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: 600 }}>Skill Name *</label>
          <input
            type="text"
            className="input-base"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. data-analyzer"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: 600 }}>Description</label>
          <input
            type="text"
            className="input-base"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does this skill do?"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: 600 }}>Tags (comma separated)</label>
          <input
            type="text"
            className="input-base"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="e.g. tool, utility, python"
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '0.3rem', fontWeight: 600 }}>Instructions (Markdown) *</label>
          <textarea
            className="input-base"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Detailed instructions for the agent..."
            style={{ width: '100%', minHeight: '150px', resize: 'vertical', fontFamily: 'monospace' }}
          />
        </div>

        <button
          className="btn-primary"
          onClick={handleBuild}
          disabled={building}
          style={{ alignSelf: 'flex-start', marginTop: '0.5rem' }}
        >
          {building ? 'Building Skill...' : 'Build & Install Skill'}
        </button>
      </div>
    </section>
  );
}
