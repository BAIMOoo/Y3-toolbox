import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public Vite proxy contract', () => {
  const config = readFileSync('vite.web.config.ts', 'utf8');

  it('does not proxy protected diagnostics through the public web origin', () => {
    expect(config).toContain("req.url?.startsWith('/api/diagnostics')");
    expect(config).toContain('res.statusCode = 404');
    expect(config).toContain("res.end('Not found')");
    expect(config).toContain('return false');
  });
});
