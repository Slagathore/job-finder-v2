import { describe, it, expect, vi, afterEach } from 'vitest';
import { providerChain, generate } from '../electron/llm/provider';

const base = {
  openaiCompatUrl: 'http://127.0.0.1:11434/v1',
  openaiCompatKey: 'ollama',
  primaryModel: 'gemini-3-flash-preview:cloud',
  fallbackLocalModel: 'llama3.2',
  anthropicApiKey: '',
  anthropicModel: 'claude-sonnet-4-6',
  ollamaBaseUrl: 'http://127.0.0.1:11434',
  embeddingModel: 'nomic-embed-text',
};

describe('providerChain', () => {
  it('puts ollama cloud /v1 first', () => {
    const chain = providerChain(base);
    expect(chain[0].kind).toBe('openai-compat');
    expect(chain[0].model).toBe('gemini-3-flash-preview:cloud');
  });

  it('omits anthropic when no key, includes it when key present', () => {
    expect(providerChain(base).some(p => p.kind === 'anthropic')).toBe(false);
    const withKey = providerChain({ ...base, anthropicApiKey: 'sk-test' });
    expect(withKey.some(p => p.kind === 'anthropic')).toBe(true);
    // order: cloud → anthropic → local
    expect(withKey.map(p => p.kind)).toEqual(['openai-compat', 'anthropic', 'openai-compat']);
  });

  it('drops the local fallback when it equals the primary model', () => {
    const chain = providerChain({ ...base, fallbackLocalModel: 'gemini-3-flash-preview:cloud' });
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
      if (call === 1) return { ok: false, status: 502, text: async () => 'bad gateway' } as any;
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'local says hi' } }] }) } as any;
    }));

    const r = await generate(base, [{ role: 'user', content: 'hi' }]);
    expect(r.text).toBe('local says hi');
    expect(r.usedFallback).toBe(true);
    expect(r.model).toBe('llama3.2');
    expect(r.errors).toHaveLength(1);
  });

  it('throws only when every provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, text: async () => 'nope' } as any)));
    await expect(generate(base, [{ role: 'user', content: 'hi' }])).rejects.toThrow(/All LLM providers failed/);
  });
});
