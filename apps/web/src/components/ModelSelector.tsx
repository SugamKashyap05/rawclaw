import { useEffect, useState } from 'react';
import axios from 'axios';
import { ModelInfo } from '@rawclaw/shared';

interface Props {
  selectedModel: string;
  onModelChange: (model: string) => void;
}

export default function ModelSelector({ selectedModel, onModelChange }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const res = await axios.get<{ models: ModelInfo[] }>('/api/chat/models');
        setModels(res.data.models);
      } catch (err) {
        console.error('Failed to fetch models', err);
      } finally {
        setLoading(false);
      }
    };
    fetchModels();
  }, []);

  if (loading) return <div className="model-selector loading">Loading Models...</div>;

  return (
    <div className="model-selector">
      <select 
        className="glass-select"
        value={selectedModel} 
        onChange={(e) => onModelChange(e.target.value)}
      >
        {models.length === 0 && (
          <option value="ollama/llama3">ollama/llama3 (Fallback)</option>
        )}
        {models.map(m => (
          <option key={m.id} value={m.id}>
            {m.name || m.id}
          </option>
        ))}
        <optgroup label="Complexity Hints">
          <option value="complexity:low">Low Complexity (Auto)</option>
          <option value="complexity:medium">Medium Complexity (Auto)</option>
          <option value="complexity:high">High Complexity (Auto)</option>
        </optgroup>
      </select>
      
      <style>{`
        .glass-select {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid var(--glass-border);
          border-radius: 8px;
          color: var(--text-main);
          padding: 0.5rem 1rem;
          outline: none;
          backdrop-filter: blur(4px);
          cursor: pointer;
        }
        .glass-select option {
          background: var(--bg-dark);
          color: var(--text-main);
        }
      `}</style>
    </div>
  );
}
