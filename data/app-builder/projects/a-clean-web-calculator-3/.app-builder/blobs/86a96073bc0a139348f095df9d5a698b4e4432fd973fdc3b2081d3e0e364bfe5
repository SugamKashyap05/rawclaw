import { describe, expect, it } from 'vitest';
import { rawClawManifest } from './rawclaw-sdk';

const expectedCommands = ["calculator.press_digit","calculator.press_operator","calculator.evaluate","calculator.clear","calculator.backspace","calculator.percent","calculator.get_state","calculator.get_history"] as string[];

describe('RawClaw manifest contract', () => {
  it('declares control endpoints and routes', () => {
    expect(rawClawManifest.appId).toBeTruthy();
    expect(rawClawManifest.controlEndpoints.commands).toBeTruthy();
    expect(rawClawManifest.controlEndpoints.events).toBeTruthy();
    expect(rawClawManifest.routes.length).toBeGreaterThan(0);
  });

  it('exposes every prompt-derived capability once', () => {
    const commands = rawClawManifest.capabilities.map((capability) => capability.command);
    expect(commands).toEqual(expect.arrayContaining(expectedCommands));
    expect(new Set(commands).size).toBe(commands.length);
  });

  it('keeps capabilities executable through structured commands', () => {
    for (const capability of rawClawManifest.capabilities) {
      expect(capability.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(capability.command).toMatch(/^[a-z][a-z0-9_.]*$/);
      expect(typeof capability.description).toBe('string');
    }
  });
});
