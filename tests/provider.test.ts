import { describe, it, expect, vi, afterEach } from 'vitest';
import { providerChain, generate } from '../electron/llm/provider';

const base = {
  primaryModel: 'kimi-k2.7-code:cloud',
  fallbackLocalModel: 'llama3.2',
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-4-6',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  embeddingModel: 'nomic-embed-text',
  think: false as const,
  showThinking: false,
};

/** Minimal native /api/chat response the ollama client will accept. */
function okChat(message: Record<string, unknown>) {
  return { ok: true, json: async () => ({ message }) } as any;
}
function httpError(status: number, body: string) {
  return {
    ok: false, status, statusText: 'error',
    headers: new Headers({ 'content-type': 'text/plain' }),
    text: async () => body,
  } as any;
}

describe('providerChain', () => {
  it('puts ollama cloud (native /api) first', () => {
    const chain = providerChain(base);
    expect(chain[0].kind).toBe('ollama');
    expect(chain[0].model).toBe('kimi-k2.7-code:cloud');
  });

  it('omits anthropic when no key, includes it when key present', () => {
    expect(providerChain(base).some(p => p.kind === 'anthropic')).toBe(false);
    const withKey = providerChain({ ...base, anthropicApiKey: 'sk-test' });
    expect(withKey.some(p => p.kind === 'anthropic')).toBe(true);
    // order: cloud → anthropic → local
    expect(withKey.map(p => p.kind)).toEqual(['ollama', 'anthropic', 'ollama']);
  });

  it('drops the local fallback when it equals the primary model', () => {
    const chain = providerChain({ ...base, fallbackLocalModel: 'kimi-k2.7-code:cloud' });
    expect(chain).toHaveLength(1);
  });

  it('honors a model override for the primary slot', () => {
    expect(providerChain(base, 'custom:cloud')[0].model).toBe('custom:cloud');
  });
});

describe('generate fallback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls through to the local model when the cloud call fails', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call++;
      if (call === 1) return httpError(502, 'bad gateway');
      return okChat({ role: 'assistant', content: 'local says hi' });
    }));

    const r = await generate(base, [{ role: 'user', content: 'hi' }]);
    expect(r.text).toBe('local says hi');
    expect(r.usedFallback).toBe(true);
    expect(r.model).toBe('llama3.2');
    expect(r.errors).toHaveLength(1);
  });

  it('throws only when every provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => httpError(500, 'nope')));
    await expect(generate(base, [{ role: 'user', content: 'hi' }])).rejects.toThrow(/All LLM providers failed/);
  });
});

describe('thinking wiring', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends think only when enabled, and never leaks thinking by default', async () => {
    const bodies: any[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: any, init?: any) => {
      bodies.push(JSON.parse(init?.body));
      return okChat({ role: 'assistant', content: 'answer', thinking: 'secret reasoning' });
    }));

    const r = await generate(base, [{ role: 'user', content: 'hi' }]);
    expect(r.text).toBe('answer');
    expect(r.thinking).toBeUndefined();          // showThinking off → dropped
    expect(bodies[0]).not.toHaveProperty('think'); // think off → flag omitted

    const r2 = await generate({ ...base, think: 'high', showThinking: true },
      [{ role: 'user', content: 'hi' }]);
    expect(r2.text).toBe('answer');
    expect(r2.thinking).toBe('secret reasoning');
    expect(bodies[1].think).toBe('high');
  });
});
