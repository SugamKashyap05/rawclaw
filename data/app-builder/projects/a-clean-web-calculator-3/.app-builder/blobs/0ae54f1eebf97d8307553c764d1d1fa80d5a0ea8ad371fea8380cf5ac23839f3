import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('generated app shell', () => {
  it('renders the requested app title', () => {
    render(<App />);
    expect(screen.getByText("A Clean Web Calculator")).toBeInTheDocument();
  });

  it('renders the primary workflow surface', () => {
    render(<App />);
    expect(screen.getByText("A Clean Web Calculator", { exact: false })).toBeInTheDocument();
  });

  it('keeps the requested workflow visible to users', () => {
    render(<App />);
    const bodyText = document.body.textContent || '';
    expect(bodyText.toLowerCase()).toContain("addition".toLowerCase().split(' ')[0]);
  });
});
