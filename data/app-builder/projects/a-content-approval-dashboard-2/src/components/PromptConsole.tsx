import { useState } from 'react';

type RunEntry = { prompt: string; status: string; summary: string };

export default function PromptConsole() {
  const [prompt, setPrompt] = useState('Review this release plan and propose safer rollout steps.');
  const [history, setHistory] = useState<RunEntry[]>([
    { prompt: 'Summarize the last approval queue.', status: 'completed', summary: '3 approvals pending, 1 high priority.' },
  ]);

  const runPrompt = () => {
    if (!prompt.trim()) return;
    setHistory((current) => [{ prompt, status: 'completed', summary: 'Run executed locally inside the generated console scaffold.' }, ...current].slice(0, 6));
  };

  return (
    <section className="grid two-up">
      <div className="console-panel">
        <div className="eyebrow">Prompt Composer</div>
        <h2>Run AI tool actions</h2>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} style={{ width: '100%', minHeight: 180, marginTop: '0.8rem', borderRadius: 18, padding: '1rem', background: 'rgba(255,255,255,0.04)', color: 'white', border: '1px solid rgba(255,255,255,0.08)' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.8rem' }}>
          <button type="button" className="key-btn primary" onClick={runPrompt}>Run tool</button>
        </div>
      </div>
      <div className="console-panel">
        <div className="eyebrow">Recent Runs</div>
        <div className="console-list" style={{ marginTop: '0.9rem' }}>
          {history.map((entry) => (
            <div key={entry.prompt} className="console-item">
              <div style={{ fontWeight: 700 }}>{entry.status}</div>
              <div style={{ color: 'var(--muted)', marginTop: '0.35rem' }}>{entry.prompt}</div>
              <div style={{ marginTop: '0.35rem' }}>{entry.summary}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
