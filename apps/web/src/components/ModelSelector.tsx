import { useEffect, useMemo, useRef, useState } from 'react';
import { FiChevronDown, FiCheck, FiHome, FiGlobe, FiCpu } from 'react-icons/fi';
import { api } from '../lib/api';

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
  temperature: number;
  top_p: number;
  onParamsChange: (temperature: number, top_p: number) => void;
}

export default function ModelSelector({ 
  selectedModel, 
  onModelChange,
  temperature,
  top_p,
  onParamsChange
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);
  const [models, setModels] = useState<ModelWithPreference[]>([]);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchModels = async () => {
    setLoading(true);
    try {
      const response = await api.get<ModelWithPreference[]>('/models');
      setModels(response.data);
    } catch (err) {
      console.error('Failed to fetch models for selector:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleOpen = () => {
    const nextState = !isOpen;
    setIsOpen(nextState);
    if (nextState) {
      void fetchModels();
    }
  };

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('pointerdown', handlePointerDown);
    }
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [isOpen]);

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
    [favorites, others]
  );

  const currentSelection = useMemo(() => {
    for (const section of sections) {
      const match = section.items.find((item) => item.value === selectedModel);
      if (match) return match;
    }
    
    if (selectedModel.startsWith('complexity:')) {
      return { title: selectedModel.split(':')[1] + ' complexity', subtitle: 'complexity routing' };
    }
    
    return { title: selectedModel.split('/').pop() || selectedModel, subtitle: 'selected model' };
  }, [sections, selectedModel]);

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth: '220px' }}>
      <button
        onClick={toggleOpen}
        style={{
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.8rem',
          padding: '0.65rem 0.9rem',
          borderRadius: '12px',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid var(--border-glass)',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        className="model-selector-trigger"
      >
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {currentSelection.title}
          </div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: '0.1rem' }}>
            {currentSelection.subtitle}
          </div>
        </div>
        <div style={{ 
          fontSize: '1rem', 
          opacity: 0.5, 
          transform: isOpen ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.2s ease',
          display: 'flex',
          alignItems: 'center'
        }}>
          <FiChevronDown />
        </div>
      </button>

      {isOpen && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.5rem)',
            right: 0,
            width: '320px',
            background: 'rgba(12, 12, 20, 0.95)',
            backdropFilter: 'blur(16px)',
            borderRadius: '16px',
            border: '1px solid var(--border-glass)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)',
            zIndex: 100,
            transformOrigin: 'top right',
            animation: 'selectorFadeIn 0.2s ease-out',
          }}
        >
          <div style={{ maxHeight: '440px', overflowY: 'auto' }} className="custom-scrollbar">
            {sections.map((section, sectionIndex) => (
              <div key={section.label} style={{ 
                borderBottom: sectionIndex < sections.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                paddingBottom: '0.5rem',
                paddingTop: '0.5rem'
              }}>
                <div style={{ 
                  padding: '0.75rem 1rem 0.4rem', 
                  fontSize: '0.62rem', 
                  fontWeight: 800, 
                  color: 'var(--text-muted)', 
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase'
                }}>
                  {section.label}
                </div>
                
                {loading && section.label !== 'Complexity routing' ? (
                  <div style={{ padding: '0.8rem 1rem', display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                    <div className="spinner-small" /> Updating models...
                  </div>
                ) : section.items.length === 0 ? (
                  <div style={{ padding: '0.8rem 1rem', color: 'var(--text-muted)', fontSize: '0.82rem', fontStyle: 'italic' }}>
                    No items available
                  </div>
                ) : (
                  <div style={{ display: 'grid' }}>
                    {section.items.map((item) => {
                      const isActive = item.value === selectedModel;
                      const isOllama = item.subtitle.toLowerCase().includes('ollama');
                      const isAnthropic = item.subtitle.toLowerCase().includes('anthropic');

                      return (
                        <button
                          key={item.value}
                          onClick={() => {
                            onModelChange(item.value);
                            setIsOpen(false);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            padding: '0.7rem 1rem',
                            border: 'none',
                            background: isActive ? 'rgba(0, 240, 255, 0.08)' : 'transparent',
                            color: isActive ? 'var(--neon-cyan)' : 'var(--text-primary)',
                            textAlign: 'left',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                          onMouseEnter={(e) => {
                            if (!isActive) e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
                          }}
                          onMouseLeave={(e) => {
                            if (!isActive) e.currentTarget.style.background = 'transparent';
                          }}
                        >
                          <div style={{ 
                            width: '32px', 
                            height: '32px', 
                            borderRadius: '8px', 
                            display: 'grid', 
                            placeItems: 'center',
                            background: isActive ? 'rgba(0, 240, 255, 0.15)' : 'rgba(255,255,255,0.05)',
                            fontSize: '1rem',
                            color: isActive ? 'var(--neon-cyan)' : 'inherit'
                          }}>
                            {isOllama ? <FiHome size={16} /> : isAnthropic ? <FiGlobe size={16} /> : <FiCpu size={16} />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {item.title}
                            </div>
                            <div style={{ fontSize: '0.65rem', color: isActive ? 'var(--neon-cyan)' : 'var(--text-muted)', textTransform: 'capitalize', opacity: 0.8 }}>
                              {item.subtitle}
                            </div>
                          </div>
                          {isActive && <div style={{ color: 'var(--neon-cyan)', display: 'flex', alignItems: 'center' }}><FiCheck size={16} /></div>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', padding: '0.25rem 0' }}>
            <button
              onClick={() => setIsAdvancedOpen(!isAdvancedOpen)}
              style={{
                width: '100%',
                padding: '0.75rem 1rem',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                fontSize: '0.65rem',
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              Advanced Settings
              <span style={{ transform: isAdvancedOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>↓</span>
            </button>
            
            {isAdvancedOpen && (
              <div style={{ padding: '0 1rem 1rem', display: 'grid', gap: '1rem' }}>
                <div style={{ display: 'grid', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Temperature</label>
                    <span style={{ fontSize: '0.7rem', color: 'var(--neon-cyan)', fontWeight: 600 }}>{temperature.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.05"
                    value={temperature}
                    onChange={(e) => onParamsChange(parseFloat(e.target.value), top_p)}
                    style={sliderStyle}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', color: 'var(--text-muted)' }}>
                    <span>Precise</span>
                    <span>Creative</span>
                  </div>
                </div>

                <div style={{ display: 'grid', gap: '0.4rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>Top P</label>
                    <span style={{ fontSize: '0.7rem', color: 'var(--neon-cyan)', fontWeight: 600 }}>{top_p.toFixed(2)}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={top_p}
                    onChange={(e) => onParamsChange(temperature, parseFloat(e.target.value))}
                    style={sliderStyle}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.55rem', color: 'var(--text-muted)' }}>
                    <span>Focused</span>
                    <span>Diverse</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      
      <style>{`
        @keyframes selectorFadeIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .spinner-small {
          width: 14px;
          height: 14px;
          border: 2px solid rgba(255,255,255,0.1);
          border-top-color: var(--neon-cyan);
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        input[type=range] {
          -webkit-appearance: none;
          width: 100%;
          background: transparent;
        }
        input[type=range]::-webkit-slider-runnable-track {
          width: 100%;
          height: 4px;
          cursor: pointer;
          background: rgba(255,255,255,0.1);
          border-radius: 2px;
        }
        input[type=range]::-webkit-slider-thumb {
          height: 14px;
          width: 14px;
          border-radius: 50%;
          background: var(--neon-cyan);
          cursor: pointer;
          -webkit-appearance: none;
          margin-top: -5px;
          box-shadow: 0 0 10px var(--neon-cyan-glow);
        }
      `}</style>
    </div>
  );
}

const sliderStyle: React.CSSProperties = {
  cursor: 'pointer',
  accentColor: 'var(--neon-cyan)',
};
