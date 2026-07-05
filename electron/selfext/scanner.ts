import type { PatchSet } from './patcher';

export type Severity = 'low' | 'medium' | 'high';
export interface Finding { file: string; rule: string; severity: Severity; line: number; snippet: string; }

// Advisory heuristics (PLAN.md §6.15). These are NOT hard blocks — the app
// legitimately uses child_process etc. They surface in the approval UI so Cole
// can judge. The mandatory human approval is the real safeguard.
const RULES: { rule: string; severity: Severity; re: RegExp }[] = [
  { rule: 'eval', severity: 'high', re: /\beval\s*\(/ },
  { rule: 'new-Function', severity: 'high', re: /new\s+Function\s*\(/ },
  { rule: 'base64-decode', severity: 'medium', re: /from\s*\(\s*[^,]+,\s*['"]base64['"]\s*\)/ },
  { rule: 'child_process', severity: 'medium', re: /child_process|\bspawn\s*\(|\bexecSync?\s*\(/ },
  { rule: 'fs-delete', severity: 'medium', re: /\b(rmSync|unlinkSync|rm)\s*\(|rmdirSync/ },
  { rule: 'shell-true', severity: 'medium', re: /shell\s*:\s*true/ },
  { rule: 'remote-fetch', severity: 'low', re: /fetch\s*\(\s*[`'"]https?:\/\/(?!127\.0\.0\.1|localhost)/ },
  { rule: 'env-access', severity: 'low', re: /process\.env\b/ },
];

/** Scan patch file contents for risky constructs. Pure — testable. */
export function scanPatch(set: PatchSet): { findings: Finding[]; counts: Record<Severity, number> } {
  const findings: Finding[] = [];
  for (const f of set.files) {
    if (f.mode === 'delete' || typeof f.contents !== 'string') continue;
    const lines = f.contents.split('\n');
    lines.forEach((text, i) => {
      for (const r of RULES) {
        if (r.re.test(text)) findings.push({ file: f.path, rule: r.rule, severity: r.severity, line: i + 1, snippet: text.trim().slice(0, 160) });
      }
    });
  }
  const counts: Record<Severity, number> = { low: 0, medium: 0, high: 0 };
  for (const f of findings) counts[f.severity]++;
  return { findings, counts };
}
