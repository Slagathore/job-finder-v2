import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseJsonLoose, repairJsonish, recoverTruncatedArray } from '../electron/lib/json';
import { parseLineItems, digestSource } from '../electron/experience/digest';
import { parseProfileResult, parseQuestions } from '../electron/experience/profile';

const settings: any = {
  openaiCompatUrl: 'http://127.0.0.1:11434/v1', openaiCompatKey: 'ollama',
  primaryModel: 'gemini-3-flash-preview:cloud', fallbackLocalModel: 'llama3.2',
  anthropicApiKey: '', anthropicModel: 'claude-sonnet-4-6',
  ollamaBaseUrl: 'http://127.0.0.1:11434', embeddingModel: 'nomic-embed-text',
};

describe('parseJsonLoose', () => {
  it('reads a fenced json array', () => {
    expect(parseJsonLoose('```json\n[1,2,3]\n```')).toEqual([1, 2, 3]);
  });
  it('reads a balanced object amid prose', () => {
    expect(parseJsonLoose('Sure! {"a": 1} done')).toEqual({ a: 1 });
  });
  it('repairs single quotes + trailing commas', () => {
    expect(parseJsonLoose("{'a': 1, 'b': [2,],}")).toEqual({ a: 1, b: [2] });
  });
  it('returns null on garbage', () => {
    expect(parseJsonLoose('no json here')).toBeNull();
  });
  it('strips <think> blocks', () => {
    expect(parseJsonLoose('<think>hmm</think>[true]')).toEqual([true]);
  });
});

describe('recoverTruncatedArray', () => {
  it('salvages complete objects from a token-capped (truncated) array', () => {
    const truncated = '[{"kind":"skill","text":"Python"},{"kind":"tool","text":"SQL"},{"kind":"accomplish';
    const r = recoverTruncatedArray(truncated)!;
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual({ kind: 'tool', text: 'SQL' });
  });
  it('parseLineItems uses recovery when JSON is truncated', () => {
    const truncated = '[{"kind":"accomplishment","text":"Cut latency 40%"},{"kind":"skill","text":"Go"},{"kind":"too';
    expect(parseLineItems(truncated)).toHaveLength(2);
  });
});

describe('repairJsonish', () => {
  it('quotes barewords in arrays of objects', () => {
    expect(JSON.parse(repairJsonish('[{kind: "skill", text: "x"}]'))).toEqual([{ kind: 'skill', text: 'x' }]);
  });
});

describe('parseLineItems', () => {
  it('normalises kind and drops empty text', () => {
    const out = parseLineItems(JSON.stringify([
      { kind: 'skill', text: 'Python' },
      { kind: 'weird', text: 'Led migration' },   // unknown kind → accomplishment
      { kind: 'tool', text: '' },                   // dropped
    ]));
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ kind: 'skill', text: 'Python' });
    expect(out[1].kind).toBe('accomplishment');
  });
  it('accepts {items:[...]} envelope', () => {
    expect(parseLineItems('{"items":[{"kind":"domain","text":"Healthcare"}]}')).toHaveLength(1);
  });
});

describe('parseProfileResult', () => {
  it('parses profile + clamps confidence', () => {
    const r = parseProfileResult(JSON.stringify({
      profile: { skills: ['a'], domains: ['b'], seniority: 'senior', total_yoe: 8, narrative: 'n' },
      role_fits: [{ role_family: 'Solutions Engineer', industry: 'SaaS', confidence: 1.4, rationale: 'x' }],
    }));
    expect(r.profile.skills).toEqual(['a']);
    expect(r.roleFits[0].confidence).toBe(1); // clamped
  });
  it('tolerates missing fields', () => {
    const r = parseProfileResult('{}');
    expect(r.profile.skills).toEqual([]);
    expect(r.roleFits).toEqual([]);
  });
});

describe('parseQuestions', () => {
  it('extracts up to 8 string questions', () => {
    expect(parseQuestions('["Q1","Q2"]')).toEqual(['Q1', 'Q2']);
  });
});

describe('digestSource (mocked LLM)', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('digests text into line items via the provider chain', async () => {
    const content = JSON.stringify([{ kind: 'accomplishment', text: 'Cut latency 40%', employer: 'Acme' }]);
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ choices: [{ message: { content } }] }),
    } as any)));
    const items = await digestSource(settings, 'resume text', 'file:cv.pdf');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'accomplishment', text: 'Cut latency 40%', employer: 'Acme' });
  });
});
