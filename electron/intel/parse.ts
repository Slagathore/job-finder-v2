import { parseJsonLoose, recoverTruncatedArray } from '../lib/json';

// Pure parsers for career-intel LLM output — no electron/db imports (testable).

const conf = (x: any) => (['low', 'medium', 'high'].includes(x) ? x : 'low');
const lvl = (x: any) => (['low', 'medium', 'high'].includes(x) ? x : 'medium');

export interface SalaryParsed { min: number | null; max: number | null; currency: string; confidence: string; note: string; }
export function parseSalary(text: string): SalaryParsed {
  const p = parseJsonLoose<any>(text) ?? {};
  const num = (x: any) => (typeof x === 'number' ? x : null);
  return { min: num(p.min), max: num(p.max), currency: typeof p.currency === 'string' ? p.currency : 'USD', confidence: conf(p.confidence), note: typeof p.note === 'string' ? p.note : '' };
}

export interface CompanyIntel { company: string; rating: number | null; pros: string[]; cons: string[]; summary: string; confidence: string; source: string; }
export function parseCompanyIntel(text: string, company: string): CompanyIntel {
  const p = parseJsonLoose<any>(text) ?? {};
  const arr = (x: any) => (Array.isArray(x) ? x.map(String) : []);
  return {
    company,
    rating: typeof p.rating === 'number' ? Math.max(0, Math.min(5, p.rating)) : null,
    pros: arr(p.pros), cons: arr(p.cons),
    summary: typeof p.summary === 'string' ? p.summary : '', confidence: conf(p.confidence), source: 'llm-estimate',
  };
}

export interface Move { role_family: string; industry: string | null; rationale: string; pay_outlook: string; remote_friendly: boolean; confidence: string; }
export function parseMoves(text: string): Move[] {
  const p = parseJsonLoose<any>(text);
  const a = Array.isArray(p) ? p : Array.isArray(p?.moves) ? p.moves : (recoverTruncatedArray(text) ?? []);
  return a.filter((m: any) => m && typeof m.role_family === 'string' && m.role_family.trim())
    .map((m: any) => ({ role_family: m.role_family.trim(), industry: m.industry ?? null, rationale: typeof m.rationale === 'string' ? m.rationale : '', pay_outlook: lvl(m.pay_outlook), remote_friendly: !!m.remote_friendly, confidence: conf(m.confidence) }))
    .slice(0, 10);
}

export interface Cert { certificate: string; lift: string; effort: string; rationale: string; confidence: string; }
export function parseCerts(text: string): Cert[] {
  const p = parseJsonLoose<any>(text);
  const a = Array.isArray(p) ? p : Array.isArray(p?.certs) ? p.certs : (recoverTruncatedArray(text) ?? []);
  return a.filter((c: any) => c && typeof c.certificate === 'string' && c.certificate.trim())
    .map((c: any) => ({ certificate: c.certificate.trim(), lift: lvl(c.lift), effort: lvl(c.effort), rationale: typeof c.rationale === 'string' ? c.rationale : '', confidence: conf(c.confidence) }))
    .slice(0, 8);
}
