/**
 * LLM provider abstraction with fallback chain (PLAN.md §5.4).
 *
 *   1. Ollama Cloud `gemini-3-flash-preview:cloud` via OpenAI-compatible /v1
 *   2. Anthropic API (only if an API key is set)
 *   3. A smaller local Ollama model via the same /v1 endpoint
 *
 * The OpenAI-compatible `/v1/chat/completions` path is REQUIRED for the cloud
 * Gemini-3 model: the native /api path drops Gemini-3's `thought_signature` on
 * tool-call round-trips (Ollama #14567). Tool-calling support will round-trip
 * assistant turns verbatim when added; this phase is text-first.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateOpts {
  temperature?: number;
  maxTokens?: number;
  model?: string;          // override the chain's model for this call
}

export interface ProviderDescriptor {
  name: string;            // human label for logs / health
  kind: 'openai-compat' | 'anthropic';
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface GenerateResult {
  text: string;
  provider: string;
  model: string;
  usedFallback: boolean;
  errors: { provider: string; error: string }[];
}

interface SettingsLike {
  openaiCompatUrl: string;
  openaiCompatKey: string;
  primaryModel: string;
  fallbackLocalModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  ollamaBaseUrl: string;
  embeddingModel: string;
}

/**
 * Build the ordered provider chain for the current settings. Pure + exported so
 * it can be unit-tested without any network. Anthropic is skipped when no key.
 */
export function providerChain(s: SettingsLike, modelOverride?: string): ProviderDescriptor[] {
  const chain: ProviderDescriptor[] = [];

  chain.push({
    name: 'ollama-cloud (openai /v1)',
    kind: 'openai-compat',
    baseUrl: s.openaiCompatUrl,
    apiKey: s.openaiCompatKey || 'ollama',
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

  // Local fallback model on the same OpenAI-compat surface, only if it differs
  // from the primary (otherwise it's a pointless retry of the same thing).
  const localModel = s.fallbackLocalModel;
  if (localModel && localModel !== (modelOverride || s.primaryModel)) {
    chain.push({
      name: `ollama-local (${localModel})`,
      kind: 'openai-compat',
      baseUrl: s.openaiCompatUrl,
      apiKey: s.openaiCompatKey || 'ollama',
      model: localModel,
    });
  }

  return chain;
}

async function chatOpenAICompat(
  p: ProviderDescriptor, messages: ChatMessage[], opts: GenerateOpts
): Promise<string> {
  const url = `${p.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
    body: JSON.stringify({
      model: p.model,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 2048,
    }),
  });
  if (!res.ok) throw new Error(`openai-compat HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: any = await res.json();
  const msg = j?.choices?.[0]?.message;
  const content = msg?.content;
  if (typeof content === 'string' && content.trim()) return content;
  // Gemini-3 thinking-mode fallback: surface reasoning over an empty answer.
  if (typeof msg?.reasoning === 'string' && msg.reasoning.trim()) return msg.reasoning;
  return content ?? '';
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
      const text = p.kind === 'anthropic'
        ? await chatAnthropic(p, messages, opts)
        : await chatOpenAICompat(p, messages, opts);
      return { text, provider: p.name, model: p.model, usedFallback: i > 0, errors };
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
  });
  if (!res.ok) throw new Error(`embed HTTP ${res.status}`);
  const j: any = await res.json();
  return j?.embeddings ?? [];
}
