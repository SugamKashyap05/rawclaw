import { MCPService } from './mcp.service';

describe('MCPService env masking', () => {
  it('returns env presence only and never includes values', () => {
    const service = new MCPService({} as any, {} as any, {} as any) as any;
    const env = service.toEnvPresence({ API_KEY: 'secret-value', EMPTY: '' });

    expect(env).toEqual([
      { name: 'API_KEY', isSet: true },
      { name: 'EMPTY', isSet: false },
    ]);
    expect(JSON.stringify(env)).not.toContain('secret-value');
    expect(env.some((entry: any) => Object.prototype.hasOwnProperty.call(entry, 'value'))).toBe(false);
  });
});
