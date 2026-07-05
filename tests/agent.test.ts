import { describe, it, expect } from 'vitest';
import { parsePlan } from '../electron/agent/planner';
import { TOOL_NAMES, capabilityOf } from '../electron/agent/tools';
import { chainHash } from '../electron/agent/hash';

describe('parsePlan', () => {
  it('parses a valid plan with known tools', () => {
    const r = parsePlan('Sure!\n```json\n{"summary":"scan then discover","steps":[{"tool":"scanBoards","args":{}},{"tool":"discover","args":{}},{"tool":"openTab","args":{"tab":"search"}}]}\n```');
    expect(r.intent).toBe('valid');
    expect(r.plan!.steps.map(s => s.tool)).toEqual(['scanBoards', 'discover', 'openTab']);
  });
  it('treats pure prose as an explanation', () => {
    const r = parsePlan('You currently have 40 jobs and a strong fit for Solutions Engineer roles.');
    expect(r.intent).toBe('explanation');
    expect(r.explanation).toContain('Solutions Engineer');
  });
  it('flags an unknown tool as malformed', () => {
    const r = parsePlan('{"summary":"x","steps":[{"tool":"deleteEverything","args":{}}]}');
    expect(r.intent).toBe('malformed');
  });
  it('defaults missing args to {}', () => {
    const r = parsePlan('{"summary":"x","steps":[{"tool":"discover"}]}');
    expect(r.plan!.steps[0].args).toEqual({});
  });
});

describe('tools', () => {
  it('has no apply tool (applying is manual) and maps capabilities', () => {
    expect(TOOL_NAMES.has('apply')).toBe(false);
    expect(capabilityOf('search')).toBe('search');
    expect(capabilityOf('tailor')).toBe('tailor_doc');
    expect(capabilityOf('openTab')).toBeNull();
  });
});

describe('chainHash', () => {
  it('is deterministic and chains on prev hash', () => {
    const e = { ts: 1000, actor: 'agent', action: 'search', payload: { tags: 'ai' } };
    const h1 = chainHash('genesis', e);
    expect(h1).toBe(chainHash('genesis', e));        // deterministic
    expect(chainHash('other', e)).not.toBe(h1);      // depends on prev
    expect(h1).toMatch(/^[0-9a-f]{64}$/);            // sha256 hex
  });
});
