import { describe, it, expect, vi, afterEach } from 'vitest';
import { parseJsonLoose, repairJsonish, recoverTruncatedArray } from '../electron/lib/json';
import { parseLineItems, propagateJobContext, digestSource, type LineItem } from '../electron/experience/digest';
import { parseProfileResult, parseQuestions } from '../electron/experience/profile';

const settings: any = {
  primaryModel: 'kimi-k2.7-code:cloud', fallbackLocalModel: 'llama3.2',
  anthropicApiKey: '', anthropicModel: 'claude-sonnet-4-6',
  ollamaBaseUrl: 'http://127.0.0.1:11434', embeddingModel: 'nomic-embed-text',
  think: false, showThinking: false,
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
  // A resume bullet does not restate its own job's employer/role/dates; only the
  // header above the block of bullets does. parseLineItems has to fill those in
  // from context or the vast majority of items come back with no dates at all.
  it('inherits employer/role/dates from the preceding item in document order', () => {
    const out = parseLineItems(JSON.stringify([
      { kind: 'accomplishment', text: 'Led the migration', employer: 'Acme', role: 'Engineer', start_date: '2020', end_date: '2022' },
      { kind: 'skill', text: 'Kubernetes' },
      { kind: 'tool', text: 'Terraform' },
    ]));
    expect(out.map(i => i.employer)).toEqual(['Acme', 'Acme', 'Acme']);
    expect(out.map(i => i.role)).toEqual(['Engineer', 'Engineer', 'Engineer']);
    expect(out.map(i => i.start_date)).toEqual(['2020', '2020', '2020']);
    expect(out.map(i => i.end_date)).toEqual(['2022', '2022', '2022']);
  });
});

describe('propagateJobContext', () => {
  const item = (over: Partial<LineItem>): LineItem => ({
    kind: 'accomplishment', text: 'x', role: null, employer: null,
    start_date: null, end_date: null, metrics: null, seniority_signal: null, ...over,
  });

  it('leaves a fully-specified item unchanged', () => {
    const out = propagateJobContext([item({ employer: 'Acme', role: 'Eng', start_date: '2020', end_date: '2021' })]);
    expect(out[0]).toMatchObject({ employer: 'Acme', role: 'Eng', start_date: '2020', end_date: '2021' });
  });

  it('fills a gap from the nearest preceding item that has it', () => {
    const out = propagateJobContext([
      item({ employer: 'Acme', role: 'Eng', start_date: '2020', end_date: '2021' }),
      item({}),
    ]);
    expect(out[1]).toMatchObject({ employer: 'Acme', role: 'Eng', start_date: '2020', end_date: '2021' });
  });

  it('a later job header overrides the context for everything after it', () => {
    const out = propagateJobContext([
      item({ employer: 'Acme', start_date: '2018', end_date: '2020' }),
      item({}),
      item({ employer: 'Globex', start_date: '2020', end_date: 'present' }),
      item({}),
    ]);
    expect(out[1].employer).toBe('Acme');
    expect(out[3].employer).toBe('Globex');
    expect(out[3].start_date).toBe('2020');
    expect(out[3].end_date).toBe('present');
  });

  it('never invents a date: a gap with nothing preceding it stays a gap', () => {
    const out = propagateJobContext([item({}), item({ employer: 'Acme' })]);
    expect(out[0].employer).toBeNull();
    expect(out[0].start_date).toBeNull();
  });

  it('does not propagate across separate calls (separate source documents)', () => {
    propagateJobContext([item({ employer: 'Acme', start_date: '2020' })]);
    const out2 = propagateJobContext([item({})]);
    expect(out2[0].employer).toBeNull();
    expect(out2[0].start_date).toBeNull();
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
  it('tolerates missing fields when anything usable came back', () => {
    const r = parseProfileResult(JSON.stringify({ profile: { skills: ['a'] } }));
    expect(r.profile.skills).toEqual(['a']);
    expect(r.profile.domains).toEqual([]);
    expect(r.roleFits).toEqual([]);
  });
  // A wholly empty result must surface as an error rather than rendering a blank
  // profile card that looks like the Analyze button did nothing.
  it('throws when the response has nothing usable in it', () => {
    expect(() => parseProfileResult('{}')).toThrow(/no usable profile/i);
    expect(() => parseProfileResult('sorry, I cannot help with that')).toThrow(/no usable profile/i);
  });
  // A thinking model's reasoning eats the completion budget, so with a big
  // corpus the response is often cut off mid role_fits array and the outer
  // object never closes. A strict parse of the whole response then fails
  // outright, but the complete "profile" object written earlier, and the
  // role_fits objects that did make it through before the cutoff, should
  // both still be recovered instead of the whole result being thrown away.
  it('recovers profile and a truncated role_fits array instead of throwing', () => {
    const truncated = '{"profile": {"skills": ["a", "b"], "domains": ["Healthcare"], "narrative": "n"}, '
      + '"role_fits": [{"role_family": "Solutions Engineer", "industry": "SaaS", "confidence": 0.8, "rationale": "x"}, '
      + '{"role_family": "Sales Engineer", "industry": "Cloud", "confidence": 0.7, "rationale": "y"}, '
      + '{"role_family": "Technical Account';
    const r = parseProfileResult(truncated);
    expect(r.profile.skills).toEqual(['a', 'b']);
    expect(r.profile.narrative).toBe('n');
    expect(r.roleFits).toHaveLength(2);
    expect(r.roleFits[0].role_family).toBe('Solutions Engineer');
    expect(r.roleFits[1].role_family).toBe('Sales Engineer');
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
      ok: true, json: async () => ({ message: { role: 'assistant', content } }),
    } as any)));
    const items = await digestSource(settings, 'resume text', 'file:cv.pdf');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'accomplishment', text: 'Cut latency 40%', employer: 'Acme' });
  });
});
