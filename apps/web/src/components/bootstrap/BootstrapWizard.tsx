import { useEffect, useMemo, useState } from 'react';
import type { BootstrapPreflightResponse, BootstrapSetupRequest } from '@rawclaw/shared';
import { bootstrapWorkspace, createBootstrapAgentDraft, getBootstrapPreflight } from '../../lib/auth';

type BootstrapWizardProps = {
  onComplete: () => Promise<void> | void;
};

const INIT_STEPS = [
  'Writing workspace files',
  'Checking local model setup',
  'Creating background agents',
  'Configuring your main agent',
  'Opening your dashboard',
];

const fieldStyle = {
  width: '100%',
  padding: '0.8rem 0.9rem',
  borderRadius: '12px',
  border: '1px solid var(--border-glass)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--text-primary)',
} as const;

export function BootstrapWizard({ onComplete }: BootstrapWizardProps) {
  const [preflight, setPreflight] = useState<BootstrapPreflightResponse | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(true);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [user, setUser] = useState('');
  const [memory, setMemory] = useState('');
  const [agentName, setAgentName] = useState('');
  const [agentDescription, setAgentDescription] = useState('');
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [promptOverlay, setPromptOverlay] = useState('');
  const [modelId, setModelId] = useState('');
  const [skillsText, setSkillsText] = useState('');
  const [showWorkspaceAdvanced, setShowWorkspaceAdvanced] = useState(false);
  const [soul, setSoul] = useState('');
  const [tools, setTools] = useState('');
  const [saving, setSaving] = useState(false);
  const [autofilling, setAutofilling] = useState(false);
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const next = await getBootstrapPreflight();
        if (!mounted) return;
        setPreflight(next);
      } catch (error) {
        if (!mounted) return;
        setPreflightError(error instanceof Error ? error.message : 'Unable to check Ollama right now.');
      } finally {
        if (mounted) setPreflightLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!saving) return;
    const timer = window.setInterval(() => {
      setStageIndex((current) => Math.min(current + 1, INIT_STEPS.length - 1));
    }, 900);
    return () => window.clearInterval(timer);
  }, [saving]);

  const autofillHint = useMemo(() => {
    if (!preflight) return 'AI autofill uses ollama/qwen3-vl:8b when it is available.';
    if (preflight.ollama.autofillModelReady) {
      return `AI autofill is ready on ${preflight.ollama.autofillModel}.`;
    }
    return `AI autofill will fall back to a local starter template because ${preflight.ollama.autofillModel} is not ready yet.`;
  }, [preflight]);

  const canSubmit = !!user.trim() && !!agentName.trim() && !saving;

  const handleAutofill = async () => {
    if (!agentName.trim()) {
      window.alert('Give your main agent a name first so I know what to generate.');
      return;
    }
    setAutofilling(true);
    try {
      const draft = await createBootstrapAgentDraft({
        name: agentName.trim(),
        description: agentDescription.trim() || undefined,
      });
      setMode('manual');
      setSystemPrompt(draft.systemPrompt);
      setPromptOverlay(draft.promptOverlay || '');
      setModelId(draft.modelId || '');
      setSkillsText((draft.skills || []).join(', '));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'AI autofill failed.');
    } finally {
      setAutofilling(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setStageIndex(0);
    const payload: BootstrapSetupRequest = {
      user: user.trim(),
      memory: memory.trim() || undefined,
      soul: showWorkspaceAdvanced ? soul.trim() || undefined : undefined,
      tools: showWorkspaceAdvanced ? tools.trim() || undefined : undefined,
      mainAgent: {
        name: agentName.trim(),
        description: agentDescription.trim() || undefined,
        mode,
        systemPrompt: mode === 'manual' ? systemPrompt.trim() || undefined : undefined,
        promptOverlay: mode === 'manual' ? promptOverlay.trim() || undefined : undefined,
        modelId: mode === 'manual' ? modelId.trim() || undefined : undefined,
        skills:
          mode === 'manual'
            ? skillsText
                .split(',')
                .map((item) => item.trim())
                .filter(Boolean)
            : undefined,
      },
    };
    const ok = await bootstrapWorkspace(payload);
    setSaving(false);
    if (!ok) {
      window.alert('Initialization failed. Check that the API and local model stack are running.');
      return;
    }
    await onComplete();
  };

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: '2rem' }}>
      <div className="glass-card" style={{ width: '100%', maxWidth: '980px', display: 'grid', gap: '1.1rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.35rem' }}>Fresh start setup</h1>
          <p style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            We’ll rebuild RawClaw like it’s opening for the first time: check Ollama, create the background agents, let you define the main agent, then drop you into the dashboard.
          </p>
        </div>

        <section style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: '1rem' }}>
          <div className="glass-card" style={{ display: 'grid', gap: '0.9rem' }}>
            <div>
              <div className="mono" style={{ fontSize: '0.72rem', marginBottom: '0.35rem' }}>
                USER PROFILE
              </div>
              <textarea
                value={user}
                onChange={(event) => setUser(event.target.value)}
                rows={7}
                placeholder="Tell RawClaw who you are, how you like to work, what you are building, and anything it should remember from day one."
                style={{ ...fieldStyle, resize: 'vertical' }}
              />
            </div>

            <div>
              <div className="mono" style={{ fontSize: '0.72rem', marginBottom: '0.35rem' }}>
                STARTER MEMORY (optional)
              </div>
              <textarea
                value={memory}
                onChange={(event) => setMemory(event.target.value)}
                rows={5}
                placeholder="Project facts, long-lived constraints, or useful context to seed at startup."
                style={{ ...fieldStyle, resize: 'vertical' }}
              />
            </div>

            <button
              type="button"
              className="btn-ghost"
              onClick={() => setShowWorkspaceAdvanced((current) => !current)}
              style={{ justifySelf: 'start' }}
            >
              {showWorkspaceAdvanced ? 'Hide workspace overrides' : 'Show workspace overrides'}
            </button>

            {showWorkspaceAdvanced ? (
              <div style={{ display: 'grid', gap: '0.8rem' }}>
                <textarea
                  value={soul}
                  onChange={(event) => setSoul(event.target.value)}
                  rows={4}
                  placeholder="Optional SOUL.md override"
                  style={{ ...fieldStyle, resize: 'vertical' }}
                />
                <textarea
                  value={tools}
                  onChange={(event) => setTools(event.target.value)}
                  rows={4}
                  placeholder="Optional TOOLS.md override"
                  style={{ ...fieldStyle, resize: 'vertical' }}
                />
              </div>
            ) : null}
          </div>

          <div className="glass-card" style={{ display: 'grid', gap: '0.8rem', alignContent: 'start' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem' }}>
              <h2 style={{ fontSize: '1rem', margin: 0 }}>Startup checks</h2>
              <span
                className="mono"
                style={{
                  fontSize: '0.7rem',
                  color:
                    preflight?.ollama.status === 'ready'
                      ? 'var(--success)'
                      : preflight?.ollama.status === 'degraded'
                        ? 'var(--warning)'
                        : 'var(--text-secondary)',
                }}
              >
                {preflightLoading ? 'Checking…' : preflight?.ollama.status.toUpperCase() || 'UNKNOWN'}
              </span>
            </div>
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              <div>Ollama URL: <span className="mono">{preflight?.ollama.baseUrl || 'http://localhost:11434'}</span></div>
              <div>Autofill model: <span className="mono">{preflight?.ollama.autofillModel || 'ollama/qwen3-vl:8b'}</span></div>
              <div>Available Ollama models: <span className="mono">{preflight?.ollama.availableModelCount ?? '—'}</span></div>
            </div>
            <div style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              {preflightError
                ? `Preflight check failed: ${preflightError}`
                : preflight?.ollama.error
                  ? preflight.ollama.error
                  : autofillHint}
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.55 }}>
              Background agents created automatically:
              <ul style={{ margin: '0.45rem 0 0 1rem', padding: 0 }}>
                <li>Research Scout</li>
                <li>Memory Keeper</li>
                <li>Task Pilot</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="glass-card" style={{ display: 'grid', gap: '0.95rem' }}>
          <div>
            <h2 style={{ fontSize: '1.15rem', marginBottom: '0.35rem' }}>Main agent</h2>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 1.55, margin: 0 }}>
              You name the main agent and describe its role. RawClaw handles the rest automatically unless you want to tune the prompt yourself.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.9rem' }}>
            <input
              value={agentName}
              onChange={(event) => setAgentName(event.target.value)}
              placeholder="Main agent name"
              style={fieldStyle}
            />
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button
                type="button"
                className={mode === 'auto' ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setMode('auto')}
                style={{ flex: 1 }}
              >
                Smart setup
              </button>
              <button
                type="button"
                className={mode === 'manual' ? 'btn-primary' : 'btn-ghost'}
                onClick={() => setMode('manual')}
                style={{ flex: 1 }}
              >
                Manual tune
              </button>
            </div>
          </div>

          <textarea
            value={agentDescription}
            onChange={(event) => setAgentDescription(event.target.value)}
            rows={4}
            placeholder="Describe what this main agent should focus on, how it should help you, and what kind of teammate feel you want."
            style={{ ...fieldStyle, resize: 'vertical' }}
          />

          <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn-ghost" disabled={autofilling} onClick={() => void handleAutofill()}>
              {autofilling ? 'Autofilling…' : 'AI autofill with qwen3-vl:8b'}
            </button>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{autofillHint}</span>
          </div>

          {mode === 'manual' ? (
            <div style={{ display: 'grid', gap: '0.8rem' }}>
              <textarea
                value={systemPrompt}
                onChange={(event) => setSystemPrompt(event.target.value)}
                rows={7}
                placeholder="System prompt"
                style={{ ...fieldStyle, resize: 'vertical' }}
              />
              <textarea
                value={promptOverlay}
                onChange={(event) => setPromptOverlay(event.target.value)}
                rows={3}
                placeholder="Prompt overlay / execution style"
                style={{ ...fieldStyle, resize: 'vertical' }}
              />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
                <input
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value)}
                  placeholder="Model id (optional)"
                  style={fieldStyle}
                />
                <input
                  value={skillsText}
                  onChange={(event) => setSkillsText(event.target.value)}
                  placeholder="Skills (comma separated)"
                  style={fieldStyle}
                />
              </div>
            </div>
          ) : null}
        </section>

        {saving ? (
          <section className="glass-card" style={{ display: 'grid', gap: '0.7rem' }}>
            <div className="mono" style={{ fontSize: '0.72rem' }}>INITIALIZING</div>
            {INIT_STEPS.map((step, index) => (
              <div key={step} style={{ color: index <= stageIndex ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                {index <= stageIndex ? '• ' : '○ '}
                {step}
              </div>
            ))}
          </section>
        ) : null}

        <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
          <button className="btn-primary" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {saving ? 'Initializing…' : 'Finish setup'}
          </button>
        </div>
      </div>
    </div>
  );
}
