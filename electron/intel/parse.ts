import { parseJsonLoose, recoverTruncatedArray } from '../lib/json';

// Pure parsers for career-intel LLM output — no electron/db imports (testable).

const conf = (x: any) => (['low', 'medium', 'high'].includes(x) ? x : 'low');
const lvl = (x: any) => (['low', 'medium', 'high'].includes(x) ? x : 'medium');

export interface SalaryParsed { min: number | null; max: number | null; currency: string; confidence: string; note: string; soc: string | null; }
/** Valid 6-digit SOC occupation code like '15-1252' (used for BLS grounding). */
export function normalizeSoc(x: any): string | null {
  if (typeof x !== 'string') return null;
  const m = x.trim().match(/^(\d{2})-?(\d{4})$/);
  return m ? `${m[1]}-${m[2]}` : null;
}
export function parseSalary(text: string): SalaryParsed {
  const p = parseJsonLoose<any>(text) ?? {};
  const num = (x: any) => (typeof x === 'number' ? x : null);
  return { min: num(p.min), max: num(p.max), currency: typeof p.currency === 'string' ? p.currency : 'USD', confidence: conf(p.confidence), note: typeof p.note === 'string' ? p.note : '', soc: normalizeSoc(p.soc) };
}

/**
 * Guarantee a usable range. A null min/max renders as "est ?–?" in the UI, which
 * tells the user nothing — so fill the gap: prefer the real BLS median (±30%),
 * else widen from whichever bound we did get, else fall back to a deliberately
 * broad generic band. Anything backfilled is forced to low confidence and says so.
 */
export function backfillRange(
  est: { min: number | null; max: number | null; confidence: string; note: string; blsMedian?: number }
): void {
  if (est.min != null && est.max != null) return;
  const round = (n: number) => Math.round(n / 1000) * 1000;
  if (est.min == null && est.max != null) est.min = round(est.max * 0.7);
  else if (est.max == null && est.min != null) est.max = round(est.min * 1.4);
  else if (est.blsMedian) { est.min = round(est.blsMedian * 0.7); est.max = round(est.blsMedian * 1.3); }
  else { est.min = 40_000; est.max = 150_000; }
  est.confidence = 'low';
  est.note = [est.note, 'Range widened because the model returned no usable figure.'].filter(Boolean).join(' ');
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

/** Trimmed string list, capped. Anything that is not a non-empty string is dropped. */
export function strList(x: any, cap = 6): string[] {
  if (!Array.isArray(x)) return [];
  return x.filter((v: any) => typeof v === 'string' && v.trim()).map((v: string) => v.trim()).slice(0, cap);
}

export interface Move {
  role_family: string; industry: string | null; rationale: string; pay_outlook: string;
  remote_friendly: boolean; confidence: string;
  /** Industries this move would make the candidate a stronger applicant in. */
  industries: string[];
  /** Actual job titles to search for once the move is made. */
  titles: string[];
}
export function parseMoves(text: string): Move[] {
  const p = parseJsonLoose<any>(text);
  const a = Array.isArray(p) ? p : Array.isArray(p?.moves) ? p.moves : (recoverTruncatedArray(text) ?? []);
  const moves = a.filter((m: any) => m && typeof m.role_family === 'string' && m.role_family.trim())
    .map((m: any) => ({
      role_family: m.role_family.trim(), industry: m.industry ?? null,
      rationale: typeof m.rationale === 'string' ? m.rationale : '',
      pay_outlook: lvl(m.pay_outlook), remote_friendly: !!m.remote_friendly, confidence: conf(m.confidence),
      industries: strList(m.industries), titles: strList(m.titles),
    }))
    .slice(0, 10);
  // A silently empty list renders as a blank table and reads as a dead button.
  if (!moves.length) throw new Error('The model returned no usable moves. Check the LLM connection on the Dashboard and try again.');
  return moves;
}

export type CertTrack = 'promotion' | 'lateral';
export interface Cert {
  certificate: string; lift: string; effort: string; rationale: string; confidence: string;
  /** Industries this credential opens up or strengthens. */
  industries: string[];
  /** Specific job titles it makes the candidate a stronger applicant for. */
  titles: string[];
  /** 'promotion' means a step up in seniority or scope, not a sideways move. */
  track: CertTrack;
}

/** Normalize one cert object, including rows cached before the shape grew. */
export function normalizeCert(raw: any): Cert {
  return {
    certificate: String(raw?.certificate ?? '').trim(),
    lift: lvl(raw?.lift), effort: lvl(raw?.effort),
    rationale: typeof raw?.rationale === 'string' ? raw.rationale : '',
    confidence: conf(raw?.confidence),
    industries: strList(raw?.industries), titles: strList(raw?.titles),
    track: raw?.track === 'promotion' ? 'promotion' : 'lateral',
  };
}

const RANK: Record<string, number> = { low: 0, medium: 1, high: 2 };

/**
 * Guarantee the set names a promotion track option. If the model marked none,
 * pick the best impact-per-effort suggestion and label it, so the advice always
 * answers "which one of these moves me up" rather than only "which is easiest".
 */
export function ensurePromotionTrack(certs: Cert[]): Cert[] {
  if (!certs.length || certs.some(c => c.track === 'promotion')) return certs;
  const score = (c: Cert) => RANK[c.lift] * 2 - RANK[c.effort];
  let best = 0;
  for (let i = 1; i < certs.length; i++) if (score(certs[i]) > score(certs[best])) best = i;
  return certs.map((c, i) => (i === best ? { ...c, track: 'promotion' as CertTrack } : c));
}

export function parseCerts(text: string): Cert[] {
  const p = parseJsonLoose<any>(text);
  const a = Array.isArray(p) ? p : Array.isArray(p?.certs) ? p.certs : (recoverTruncatedArray(text) ?? []);
  const certs = a.filter((c: any) => c && typeof c.certificate === 'string' && c.certificate.trim())
    .map(normalizeCert)
    .slice(0, 8);
  if (!certs.length) throw new Error('The model returned no usable credential advice. Check the LLM connection on the Dashboard and try again.');
  return ensurePromotionTrack(certs);
}
