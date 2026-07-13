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

// The self-extension pipeline's OWN guardrail files: the approval gate
// (electron/ipc/selfext.ts — sandbox-must-pass enforcement, mandatory confirm)
// and everything under electron/selfext/** (patcher's path-safety checks,
// the sandbox isolation, this scanner, apply/backup/rollback). There is
// deliberately no content-pattern rule that would catch a quiet one-line
// deletion of `if (!p.sandbox?.ok)` or similar — a patch to these files can be
// perfectly "clean" TypeScript with no eval/child_process/etc and still gut
// the safety mechanism. So flag by PATH ALONE, independent of content or mode
// (create/replace/delete all count — deleting the gate file is the most
// severe case, not an exempt one).
const GUARDRAIL_PATH_RE = /^electron\/selfext\/|^electron\/ipc\/selfext\.ts$/;

function normalizePatchPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** Does this patch file path fall inside the self-extension safety code? */
export function isSelfExtGuardrailPath(filePath: string): boolean {
  return GUARDRAIL_PATH_RE.test(normalizePatchPath(filePath));
}

/** Scan patch file contents for risky constructs. Pure — testable. */
export function scanPatch(set: PatchSet): { findings: Finding[]; counts: Record<Severity, number> } {
  const findings: Finding[] = [];
  for (const f of set.files) {
    if (isSelfExtGuardrailPath(f.path)) {
      findings.push({
        file: f.path,
        rule: 'selfext-guardrail-path',
        severity: 'high',
        line: 1,
        snippet: `patch ${f.mode}s the self-extension safety code itself (approval gate / sandbox / scanner)`,
      });
    }
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
