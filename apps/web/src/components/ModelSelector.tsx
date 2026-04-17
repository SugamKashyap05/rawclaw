import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { FiChevronDown, FiCpu, FiStar } from 'react-icons/fi';

interface ModelWithPreference {
  id: string;
  name: string;
  provider: string;
  customName?: string;
  isFavorite: boolean;
}

interface Props {
  selectedModel: string;
  onModelChange: (model: string) => void;
}

export default function ModelSelector({ selectedModel, onModelChange }: Props) {
  const [models, setModels] = useState<ModelWithPreference[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await api.get<ModelWithPreference[]>('/models');
        setModels(response.data);
      } finally {
        setLoading(false);
      }
    };

    void fetchModels();
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const favorites = useMemo(() => models.filter((model) => model.isFavorite), [models]);
  const others = useMemo(() => models.filter((model) => !model.isFavorite), [models]);
  const sections = useMemo(
    () => [
      {
        label: 'Favorites',
        items: favorites.map((model) => ({
          value: model.id,
          title: model.customName || model.name || model.id,
          subtitle: model.provider,
          favorite: true,
        })),
      },
      {
        label: 'Models',
        items: others.map((model) => ({
          value: model.id,
          title: model.customName || model.name || model.id,
          subtitle: model.provider,
          favorite: false,
        })),
      },
      {
        label: 'Complexity routing',
        items: [
          { value: 'complexity:low', title: 'low complexity', subtitle: 'Prefer low-cost / local path', favorite: false },
          { value: 'complexity:medium', title: 'medium complexity', subtitle: 'Balanced routing', favorite: false },
          { value: 'complexity:high', title: 'high complexity', subtitle: 'Best available reasoning path', favorite: false },
        ],
      },
    ],
    [favorites, others],
  );

  if (loading) {
    return (
      <div
        className="mono"
        style={{
          padding: '0.75rem',
          fontSize: '0.74rem',
          color: 'var(--text-muted)',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid var(--border-glass)',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '0.55rem',
          minWidth: '240px',
        }}
      >
        <FiCpu className="icon-spin" />
        Loading models...
      </div>
    );
  }

  const selectedLabel =
    sections.flatMap((section) => section.items).find((item) => item.value === selectedModel)?.title ||
    selectedModel ||
    'Select model';

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth: '280px' }}>
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        style={{ ...fieldStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
        className="mono"
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selectedLabel}</span>
        <FiChevronDown style={{ opacity: 0.8, flexShrink: 0 }} />
      </button>

      {open ? (
        <div
          className="custom-scrollbar"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.5rem)',
            right: 0,
            width: '360px',
            maxHeight: '360px',
            overflowY: 'auto',
            background: 'rgba(8, 10, 18, 0.97)',
            border: '1px solid var(--border-neon)',
            boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
            borderRadius: '16px',
            padding: '0.65rem',
            zIndex: 50,
            backdropFilter: 'blur(18px)',
          }}
        >
          {sections.map((section) => (
            <div key={section.label} style={{ marginBottom: '0.5rem' }}>
              <div className="mono" style={{ fontSize: '0.66rem', color: 'var(--text-muted)', padding: '0.45rem 0.55rem' }}>
                {section.label.toUpperCase()}
              </div>
              {section.items.length === 0 ? (
                <div style={{ padding: '0.55rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>No models available.</div>
              ) : (
                section.items.map((item) => {
                  const active = item.value === selectedModel;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => {
                        onModelChange(item.value);
                        setOpen(false);
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: '1px solid transparent',
                        background: active ? 'rgba(0, 240, 255, 0.12)' : 'transparent',
                        color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                        borderRadius: '12px',
                        padding: '0.7rem 0.75rem',
                        display: 'grid',
                        gap: '0.15rem',
                        cursor: 'pointer',
                        marginBottom: '0.2rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                        {item.favorite ? <FiStar style={{ color: 'var(--neon-cyan)', flexShrink: 0 }} /> : null}
                        <span className="mono" style={{ fontSize: '0.78rem' }}>{item.title}</span>
                      </div>
                      <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>{item.subtitle}</span>
                    </button>
                  );
                })
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const fieldStyle = {
  width: '100%',
  minWidth: '240px',
  padding: '0.85rem 0.9rem',
  borderRadius: '12px',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.05)',
  color: 'var(--text-primary)',
};
