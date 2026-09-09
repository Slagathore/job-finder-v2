import { describe, it, expect } from 'vitest';
import { titleFromMessage } from '../electron/agent/title';
import {
  normalizeMode, interviewSystemPrompt, buildInterviewPrompt, parseInterviewReply,
  pickMentionedJobs, AGENT_MODES, MODE_LABELS,
} from '../electron/agent/interview';
import { buildPromptForMode, parseForMode, plannerSystemPrompt } from '../electron/agent/planner';

describe('titleFromMessage', () => {
  it('uses a short message verbatim', () => {
    expect(titleFromMessage('scan all boards')).toBe('scan all boards');
  });
  it('collapses whitespace and markdown noise', () => {
    expect(titleFromMessage('  ## tailor   a resume\nfor job 12  ')).toBe('tailor a resume for job 12');
  });
  it('drops fenced code blocks', () => {
    expect(titleFromMessage('parse this\n```json\n{"a":1}\n```')).toBe('parse this');
  });
  it('trims long messages on a word boundary with an ellipsis', () => {
    const t = titleFromMessage('please scan every enabled board and then discover the best fits for me today', 40);
    expect(t.endsWith('...')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(43);
    expect(t).not.toMatch(/\s\.\.\.$/);
  });
  it('falls back when there is nothing usable', () => {
    expect(titleFromMessage('   ')).toBe('Untitled conversation');
    expect(titleFromMessage('```\ncode only\n```')).toBe('Untitled conversation');
  });
});

describe('mode routing', () => {
  it('normalizes anything that is not interview to agent', () => {
    expect(normalizeMode('interview')).toBe('interview');
    expect(normalizeMode('agent')).toBe('agent');
    expect(normalizeMode(undefined)).toBe('agent');
    expect(normalizeMode('nonsense')).toBe('agent');
    expect(AGENT_MODES).toEqual(['agent', 'interview']);
    expect(MODE_LABELS.interview).toBe('Interview prep');
  });

  // One system message on purpose, with the app context folded into it: the
  // default Ollama model drops a second system turn, which would leave the model
  // answering with no context at all. These assert that shape deliberately.
  it('sends the planner prompt in agent mode, with context folded in', () => {
    const msgs = buildPromptForMode('agent', 'scan boards', 'ctx');
    expect(msgs.filter(m => m.role === 'system')).toHaveLength(1);
    expect(msgs[0].content).toContain(plannerSystemPrompt());
    expect(msgs[0].content).toContain('Available tools');
    expect(msgs[0].content).toContain('ctx');
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'scan boards' });
  });

  it('sends the interview coach prompt in interview mode', () => {
    const msgs = buildPromptForMode('interview', 'I have an interview', 'ctx');
    expect(msgs.filter(m => m.role === 'system')).toHaveLength(1);
    expect(msgs[0].content).toContain(interviewSystemPrompt());
    expect(msgs[0].content).not.toContain('Available tools');
    expect(msgs[0].content).toContain('interview coach');
  });

  it('falls back to the planner prompt for an unknown mode', () => {
    const msgs = buildPromptForMode('nope' as any, 'hi', 'ctx');
    expect(msgs[0].content).toContain(plannerSystemPrompt());
  });

  it('carries the bounded history between the system turn and the new message', () => {
    const history = [{ role: 'user' as const, content: 'earlier' }, { role: 'assistant' as const, content: 'ok' }];
    const msgs = buildInterviewPrompt('now', 'ctx', history);
    expect(msgs.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(msgs[1].content).toBe('earlier');
    expect(msgs[msgs.length - 1]).toEqual({ role: 'user', content: 'now' });
  });
});

describe('interview prompt content', () => {
  const p = interviewSystemPrompt();
  it('states the coaching behavior the owner asked for', () => {
    expect(p).toContain('ONE question at a time');
    expect(p).toMatch(/park/i);
    expect(p).toMatch(/critical thinking/i);
    expect(p).toMatch(/ask the interviewer/i);
    expect(p).toMatch(/behavioral/i);
    expect(p).toMatch(/tender and understanding/i);
    expect(p).toMatch(/[Nn]ever sycophantic|sycophantic/);
    expect(p).toMatch(/posting URL/);
  });
  it('is written without em dashes or en dashes', () => {
    expect(p).not.toMatch(/[–—]/);
  });
});

describe('parseForMode', () => {
  const planJson = '{"summary":"scan","steps":[{"tool":"scanBoards","args":{}}]}';

  it('parses plan JSON in agent mode', () => {
    const r = parseForMode('agent', planJson);
    expect(r.intent).toBe('valid');
    expect(r.plan!.steps[0].tool).toBe('scanBoards');
  });

  it('never produces a plan in interview mode', () => {
    const r = parseForMode('interview', planJson);
    expect(r.intent).toBe('explanation');
    expect(r.plan).toBeUndefined();
    expect(r.explanation).toContain('scanBoards');
  });

  it('returns prose in interview mode and strips the thinking block', () => {
    const r = parseForMode('interview', '<think>plotting</think>Which company is the interview with?');
    expect(r.intent).toBe('explanation');
    expect(r.explanation).toBe('Which company is the interview with?');
  });

  it('treats an empty interview reply as an error rather than a blank bubble', () => {
    const r = parseInterviewReply('<think>only thinking</think>   ');
    expect(r.intent).toBe('malformed');
    expect(r.error).toBeTruthy();
    expect(r.explanation).toBeUndefined();
  });
});

describe('pickMentionedJobs', () => {
  const jobs = [
    { id: 1, title: 'Solutions Engineer', company: 'Acme Robotics' },
    { id: 2, title: 'Technical Account Manager', company: 'Globex' },
    { id: 3, title: 'Data Analyst', company: 'Initech' },
  ];

  it('matches on company name', () => {
    expect(pickMentionedJobs('I have an interview at Globex on Friday', jobs).map(j => j.id)).toEqual([2]);
  });
  it('matches on title words when the company is not named', () => {
    expect(pickMentionedJobs('it is a solutions engineer interview', jobs).map(j => j.id)).toEqual([1]);
  });
  it('ranks a company plus title match first', () => {
    const r = pickMentionedJobs('acme robotics solutions engineer role', jobs, 2);
    expect(r[0].id).toBe(1);
  });
  it('returns nothing when nothing matches', () => {
    expect(pickMentionedJobs('my dentist appointment', jobs)).toEqual([]);
    expect(pickMentionedJobs('', jobs)).toEqual([]);
  });
  it('honors the max', () => {
    expect(pickMentionedJobs('analyst engineer manager acme globex initech', jobs, 1)).toHaveLength(1);
  });
});
