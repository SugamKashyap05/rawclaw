import PromptConsole from './components/PromptConsole';

export default function App() {
  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="eyebrow">RawClaw AI Console</div>
        <h1>A Content Approval Dashboard</h1>
        <p>AI operations console with prompt workflows, run history, and approval surfaces.</p>
      </section>
      <PromptConsole />
    </main>
  );
}
