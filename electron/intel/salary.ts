import { generate, type ChatMessage } from '../llm/provider';
import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';
import { parseSalary, type SalaryParsed } from './parse';
import { blsMedianForSoc } from './bls';

export interface SalaryEstimate extends SalaryParsed {
  source: string;
  blsMedian?: number;   // real BLS OEWS national annual median for the SOC
  blsYear?: string;
}

const SYSTEM = `Estimate the annual total compensation range for a job from its title, company, and location.
Respond with ONLY: { "min": <number|null>, "max": <number|null>, "currency": "USD", "confidence": "low|medium|high", "note": "<1 sentence>", "soc": "<best-matching 6-digit SOC occupation code like 15-1252, or null>" }
This is an ESTIMATE — be honest about uncertainty via confidence. The soc code is used to look up real government wage data, so pick the closest standard occupation.`;

export function buildSalaryPrompt(job: { title: string; company: string; location_raw?: string | null }): ChatMessage[] {
  return [{ role: 'system', content: SYSTEM },
    { role: 'user', content: `Title: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location_raw ?? 'n/a'}` }];
}

export async function estimateSalary(jobId: number): Promise<SalaryEstimate | { error: string }> {
  const db = getDb();
  const job = db.prepare('SELECT id, title, company, location_raw FROM jobs WHERE id = ?').get(jobId) as any;
  if (!job) return { error: 'Job not found.' };
  try {
    const r = await generate(readSettings(), buildSalaryPrompt(job), { temperature: 0.2, maxTokens: 250 });
    const est: SalaryEstimate = { ...parseSalary(r.text), source: 'llm-estimate' };
    // Ground with real BLS OEWS data when the LLM mapped a SOC code. Fail-soft:
    // offline / no data just leaves the estimate unlabeled.
    if (est.soc) {
      const bls = await blsMedianForSoc(est.soc);
      if (bls) { est.blsMedian = bls.annualMedian; est.blsYear = bls.year; est.source = 'llm-estimate+bls'; }
    }
    db.prepare('UPDATE jobs SET salary_estimate = ? WHERE id = ?').run(JSON.stringify(est), jobId);
    return est;
  } catch (e: any) { return { error: e?.message ?? String(e) }; }
}
