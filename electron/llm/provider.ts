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
  /** The model hit its output budget. Text may be partial, so parse defensively. */
  truncated?: boolean;
  provider: string;
  model: string;
  usedFallback: boolean;
  errors: { provider: string; error: string }[];
}

export const DEFAULT_MAX_TOKENS = 2048;
/** Ceiling for a retry after an empty truncated response. */
export const MAX_RETRY_TOKENS = 32_000;

/** The budget to retry with after a thinking model returned nothing. Pure, so it is testable. */
export function expandedBudget(requested: number | undefined): number {
  const base = requested ?? DEFAULT_MAX_TOKENS;
  return Math.min(Math.max(base * 3, 12_000), MAX_RETRY_TOKENS);
}

/**
 * How long to allow one request, scaled to how much output was asked for.
 *
 * A flat two minute cap silently killed the big structured calls: a 30k token
 * review on a thinking model legitimately runs for several minutes, and the
 * abort surfaced as "all LLM providers failed", which reads like the model is
 * down. Small calls keep the short timeout so a genuinely hung server still
 * fails fast.
 */
export function requestTimeoutMs(maxTokens: number | undefined): number {
  const budget = maxTokens ?? DEFAULT_MAX_TOKENS;
  return Math.min(900_000, Math.max(120_000, Math.round(budget * 20)));
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
): Promise<{ content: string; thinking?: string; truncated: boolean }> {
  const client = new Ollama({
    host: p.baseUrl,
    // A hung model server must not freeze the scan→embed→discover chain forever,
    // but the cap has to scale with how much output was requested.
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(requestTimeoutMs(opts.maxTokens)) }),
  });
  const res = await client.chat({
    model: p.model,
    messages,
    // Omit `think` when off — non-thinking fallback models reject the flag.
    ...(think ? { think } : {}),
    options: {
      temperature: opts.temperature ?? 0.4,
      num_predict: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    },
  });
  return {
    content: res.message?.content ?? '',
    thinking: res.message?.thinking,
    truncated: (res as any)?.done_reason === 'length',
  };
}

async function chatAnthropic(
  p: ProviderDescriptor, messages: ChatMessage[], opts: GenerateOpts
): Promise<{ content: string; truncated: boolean }> {
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
      max_tokens: opts.maxTokens ?? DEFAULT_MAX_TOKENS,
    }),
    signal: AbortSignal.timeout(requestTimeoutMs(opts.maxTokens)),
  });
  if (!res.ok) throw new Error(`anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: any = await res.json();
  const parts = Array.isArray(j?.content) ? j.content : [];
  return {
    content: parts.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join(''),
    truncated: j?.stop_reason === 'max_tokens',
  };
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
      // A thinking model spends its output budget on reasoning before it writes
      // anything, so a budget that is merely tight comes back EMPTY rather than
      // short. That used to surface to the user as "check the LLM connection",
      // which is wrong and sends them debugging a connection that is fine. Retry
      // once with a much larger budget, then report the real cause.
      let attemptOpts = opts;
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = p.kind === 'anthropic'
          ? { ...(await chatAnthropic(p, messages, attemptOpts)), thinking: undefined as string | undefined }
          : await chatOllama(p, messages, attemptOpts, s.think);

        const empty = !r.content.trim();
        if (r.truncated && empty && attempt === 0) {
          attemptOpts = { ...opts, maxTokens: expandedBudget(opts.maxTokens) };
          continue;
        }
        if (r.truncated && empty) {
          throw new Error(
            `The model used its entire ${attemptOpts.maxTokens ?? DEFAULT_MAX_TOKENS} token output budget on reasoning and returned nothing. ` +
            'This is a token budget problem, not a connection problem. Raise the budget for this request or send it less input.'
          );
        }
        return {
          text: r.content,
          truncated: r.truncated,
          // Reasoning is surfaced separately, and only when explicitly enabled.
          ...(s.showThinking && r.thinking ? { thinking: r.thinking } : {}),
          provider: p.name, model: p.model, usedFallback: i > 0, errors,
        };
      }
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
      (status.anthropicConfigured ? ', will fall back to Anthropic' : '');
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
