import { useEffect, useMemo, useState } from 'react';
import { emitRawClawEvent } from '../rawclaw-sdk';

type HistoryEntry = { expression: string; result: string };

const KEYS = [
  ['C', 'DEL', '%', '/'],
  ['7', '8', '9', '*'],
  ['4', '5', '6', '-'],
  ['1', '2', '3', '+'],
  ['0', '.', '='],
];

function safeEvaluate(expression: string): string {
  if (!expression.trim()) return '0';
  const normalized = expression.replace(/%/g, '/100');
  try {
    const result = Function('return (' + normalized + ')')();
    if (typeof result !== 'number' || !Number.isFinite(result)) return 'Error';
    return String(Number(result.toFixed(12)));
  } catch {
    return 'Error';
  }
}

export default function Calculator() {
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState('0');
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const canEvaluate = useMemo(() => /\d/.test(expression), [expression]);

  const pushHistory = (nextExpression: string, nextResult: string) => {
    setHistory((current) => [{ expression: nextExpression, result: nextResult }, ...current].slice(0, 8));
  };

  const emitState = (type: string, payload: Record<string, unknown>) => {
    emitRawClawEvent(type, payload);
  };

  const handleDigit = (value: string) => {
    setExpression((current) => {
      const next = current + value;
      emitState('expression.changed', { expression: next });
      return next;
    });
  };

  const handleAction = (value: string) => {
    if (value === 'C') {
      setExpression('');
      setResult('0');
      emitState('calculator.cleared', { expression: '', result: '0' });
      return;
    }
    if (value === 'DEL') {
      setExpression((current) => {
        const next = current.slice(0, -1);
        emitState('expression.changed', { expression: next });
        return next;
      });
      return;
    }
    if (value === '=') {
      if (!canEvaluate) return;
      const nextResult = safeEvaluate(expression);
      setResult(nextResult);
      pushHistory(expression, nextResult);
      emitState('result.calculated', { expression, result: nextResult });
      return;
    }
    handleDigit(value);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((/^[0-9.]$/).test(event.key)) {
        handleDigit(event.key);
      } else if (['+', '-', '*', '/', '%'].includes(event.key)) {
        handleDigit(event.key);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        handleAction('=');
      } else if (event.key === 'Backspace') {
        handleAction('DEL');
      } else if (event.key.toLowerCase() === 'c') {
        handleAction('C');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [expression, canEvaluate]);

  return (
    <section className="calculator-shell">
      <div className="grid">
        <div className="display-panel workspace-panel">
          <div className="eyebrow">Expression</div>
          <div className="display-expression">{expression || '0'}</div>
          <div className="display-value">{result}</div>
        </div>
        <div className="keypad-panel">
          <div className="eyebrow" style={{ marginBottom: '0.75rem' }}>Keypad</div>
          <div className="keypad-grid">
            {KEYS.flat().map((key) => (
              <button
                key={key}
                type="button"
                className={['key-btn', key === '=' ? 'primary' : ['+', '-', '*', '/', '%'].includes(key) ? 'accent' : ''].join(' ').trim()}
                onClick={() => handleAction(key)}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      </div>
      <aside className="history-panel">
        <div className="eyebrow">History</div>
        <div className="history-list" style={{ marginTop: '0.9rem' }}>
          {history.length ? history.map((entry) => (
            <div key={entry.expression + entry.result} className="history-item">
              <div style={{ color: 'var(--muted)' }}>{entry.expression}</div>
              <div style={{ fontWeight: 700 }}>{entry.result}</div>
            </div>
          )) : <div style={{ color: 'var(--muted)' }}>Your latest calculations appear here.</div>}
        </div>
      </aside>
    </section>
  );
}
