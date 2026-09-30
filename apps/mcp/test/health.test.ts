import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('mcp worker scaffold', () => {
  it('responds on /health', async () => {
    const res = await SELF.fetch('https://example.com/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'mcp' });
  });

  it('returns 404 elsewhere', async () => {
    const res = await SELF.fetch('https://example.com/');
    expect(res.status).toBe(404);
  });

  it('has the shared D1 binding', () => {
    expect(env.DB).toBeDefined();
  });
});
