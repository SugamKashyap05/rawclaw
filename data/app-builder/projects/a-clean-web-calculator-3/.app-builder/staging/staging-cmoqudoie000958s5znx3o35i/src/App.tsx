import Calculator from './components/Calculator';

export default function App() {
  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="eyebrow">RawClaw App Builder</div>
        <h1>A Clean Web Calculator</h1>
        <p>Interactive calculator with keypad, expression display, history, and RawClaw control hooks.</p>
      </section>
      <Calculator />
    </main>
  );
}
