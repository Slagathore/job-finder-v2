/**
 * LLM provider abstraction with fallback chain (PLAN.md §5.4).
 *
 *   1. Ollama Cloud `kimi-k2.7-code:cloud` via the native Ollama API (/api/chat)
 *   2. Anthropic API (only if an API key is set)
 *   3. A smaller local Ollama model via the same native endpoint
 *
 * Chat goes through the official `ollama` npm client (the OpenAI-compat /v1
 * route is gone — 2026-07 model migration). kimi-k2.7 supports the `think`
 * parameter; the native API returns `message.thinking` separately from
 * `message.content`, so reasoning never leaks into stored/displayed output.
 */
import { Ollama } from 'ollama';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Thinking effort: off, on, or an explicit level (model support required). */
export type ThinkSetting = boolean | 'low' | 'medium' | 'high';

export interface GenerateOpts {
  temperature?: number;
  maxTokens?: number;
  model?: string;          // override the chain's model for this call
}

export interface ProviderDescriptor {
  name: string;            // human label for logs / health
  kind: 'ollama' | 'anthropic';
  baseUrl: string;
  apiKey: string;          // anthropic only; '' for ollama (local daemon needs none)
  model: string;
}

export interface GenerateResult {
  text: string;
  thinking?: string;       // only set when showThinking is enabled — never merged into text
  provider: string;
  model: string;
  usedFallback: boolean;
  errors: { provider: string; error: string }[];
}

interface SettingsLike {
  primaryModel: string;
  fallbackLocalModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  ollamaBaseUrl: string;
  embeddingModel: string;
  think?: ThinkSetting;    // default false — no reasoning pass
  showThinking?: boolean;  // default false — drop message.thinking entirely
}

/**
 * Build the ordered provider chain for the current settings. Pure + exported so
 * it can be unit-tested without any network. Anthropic is skipped when no key.
 */
export function providerChain(s: SettingsLike, modelOverride?: string): ProviderDescriptor[] {
  const chain: ProviderDescriptor[] = [];

  chain.push({
    name: 'ollama-cloud (native /api)',
    kind: 'ollama',
    baseUrl: s.ollamaBaseUrl,
    apiKey: '',
    model: modelOverride || s.primaryModel,
  });

  if (s.anthropicApiKey && s.anthropicApiKey.trim()) {
    chain.push({
      name: 'anthropic',
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: s.anthropicApiKey.trim(),
      model: s.anthropicModel,
    });
  }

  // Local fallback model on the same native Ollama surface, only if it differs
  // from the primary (otherwise it's a pointless retry of the same thing).
  const localModel = s.fallbackLocalModel;
  if (localModel && localModel !== (modelOverride || s.primaryModel)) {
    chain.push({
      name: `ollama-local (${localModel})`,
      kind: 'ollama',
      baseUrl: s.ollamaBaseUrl,
      apiKey: '',
      model: localModel,
    });
  }

  return chain;
}

async function chatOllama(
  p: ProviderDescriptor, messages: ChatMessage[], opts: GenerateOpts, think?: ThinkSetting
): Promise<{ content: string; thinking?: string }> {
  const client = new Ollama({
    host: p.baseUrl,
    // A hung model server must not freeze the scan→embed→discover chain forever.
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(120_000) }),
  });
  const res = await client.chat({
    model: p.model,
    messages,
    // Omit `think` when off — non-thinking fallback models reject the flag.
    ...(think ? { think } : {}),
    options: {
      temperature: opts.temperature ?? 0.4,
      num_predict: opts.maxTokens ?? 2048,
    },
  });
  return { content: res.message?.content ?? '', thinking: res.message?.thinking };
}

async function chatAnthropic(
  p: ProviderDescriptor, messages: ChatMessage[], opts: GenerateOpts
): Promise<string> {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const turns = messages.filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }));
  const res = await fetch(`${p.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': p.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: p.model,
      system: system || undefined,
      messages: turns,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 2048,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: any = await res.json();
  const parts = Array.isArray(j?.content) ? j.content : [];
  return parts.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
}

/** Generate text, walking the fallback chain. Throws only if every provider fails. */
export async function generate(
  s: SettingsLike, messages: ChatMessage[], opts: GenerateOpts = {}
): Promise<GenerateResult> {
  const chain = providerChain(s, opts.model);
  const errors: { provider: string; error: string }[] = [];

  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    try {
      if (p.kind === 'anthropic') {
        const text = await chatAnthropic(p, messages, opts);
        return { text, provider: p.name, model: p.model, usedFallback: i > 0, errors };
      }
      const r = await chatOllama(p, messages, opts, s.think);
      return {
        text: r.content,
        // Reasoning is surfaced separately, and only when explicitly enabled.
        ...(s.showThinking && r.thinking ? { thinking: r.thinking } : {}),
        provider: p.name, model: p.model, usedFallback: i > 0, errors,
      };
    } catch (e: any) {
      errors.push({ provider: p.name, error: e?.message ?? String(e) });
    }
  }
  throw new Error(`All LLM providers failed: ${errors.map(e => `${e.provider}: ${e.error}`).join(' | ')}`);
}

export interface HealthStatus {
  ollamaUp: boolean;
  baseUrl: string;
  primaryModel: string;
  primaryModelPresent: boolean | null;  // null = couldn't determine (e.g. cloud tag)
  anthropicConfigured: boolean;
  detail: string;
}

/** Probe Ollama reachability + whether the primary model tag is available. */
export async function health(s: SettingsLike): Promise<HealthStatus> {
  const base = s.ollamaBaseUrl.replace(/\/$/, '');
  const status: HealthStatus = {
    ollamaUp: false,
    baseUrl: base,
    primaryModel: s.primaryModel,
    primaryModelPresent: null,
    anthropicConfigured: !!(s.anthropicApiKey && s.anthropicApiKey.trim()),
    detail: '',
  };
  try {
    const ver = await fetch(`${base}/api/version`, { signal: AbortSignal.timeout(4000) });
    status.ollamaUp = ver.ok;
    if (ver.ok) {
      const tags = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (tags.ok) {
        const j: any = await tags.json();
        const names: string[] = (j?.models ?? []).map((m: any) => m?.name).filter(Boolean);
        // Cloud-tagged models (":cloud") may not appear in local tags — leave null.
        status.primaryModelPresent = s.primaryModel.includes(':cloud')
          ? null
          : names.includes(s.primaryModel);
      }
      status.detail = 'Ollama reachable';
    } else {
      status.detail = `Ollama responded ${ver.status}`;
    }
  } catch (e: any) {
    status.detail = `Ollama unreachable: ${e?.message ?? e}` +
      (status.anthropicConfigured ? ' — will fall back to Anthropic' : '');
  }
  return status;
}

/** Local embeddings via Ollama's native /api/embed (PLAN.md §5.4 / phase 4). */
export async function embed(s: SettingsLike, texts: string[]): Promise<number[][]> {
  const base = s.ollamaBaseUrl.replace(/\/$/, '');
  const res = await fetch(`${base}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: s.embeddingModel, input: texts }),
    signal: AbortSignal.timeout(120_000), // cold model load can be slow, but never hang forever
  });
  if (!res.ok) throw new Error(`embed HTTP ${res.status}`);
  const j: any = await res.json();
  return j?.embeddings ?? [];
}
