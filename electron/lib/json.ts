/**
 * Tolerant JSON extraction for LLM output. Distilled from claw-deck's planner:
 * strips <think> blocks, repairs common small-model JSON dialect issues, and
 * pulls the first parseable JSON value from a fenced block or balanced braces.
 */

export function stripThinking(text: string): string {
  if (!text) return '';
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .trim();
}

export function repairJsonish(s: string): string {
  if (!s) return s;
  let out = s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/'([^'\\\n]*(?:\\.[^'\\\n]*)*)'/g, (_m, body) => `"${body.replace(/"/g, '\\"')}"`);
  out = out.replace(/([{,[]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:/g, '$1"$2":');
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return out;
}

/** Find the first balanced {...} or [...] substring starting at `open`. */
function balanced(text: string, open: '{' | '['): string | null {
  const close = open === '{' ? '}' : ']';
  const start = text.indexOf(open);
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/** Parse the first JSON value found in arbitrary LLM text. Returns null on failure. */
export function parseJsonLoose<T = any>(text: string): T | null {
  if (!text) return null;
  const cleaned = stripThinking(text);

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(cleaned);
  const candidates: string[] = [];
  if (fence) candidates.push(fence[1].trim());
  // whichever structural opener comes first
  const firstObj = cleaned.indexOf('{');
  const firstArr = cleaned.indexOf('[');
  if (firstArr >= 0 && (firstObj < 0 || firstArr < firstObj)) {
    const b = balanced(cleaned, '['); if (b) candidates.push(b);
  } else {
    const b = balanced(cleaned, '{'); if (b) candidates.push(b);
  }
  candidates.push(cleaned);

  for (const c of candidates) {
    for (const attempt of [c, repairJsonish(c)]) {
      try { return JSON.parse(attempt) as T; } catch { /* try next */ }
    }
  }
  return null;
}

/**
 * Recover a truncated JSON array-of-objects (common when a "thinking" model hits
 * its token cap mid-output): keep complete objects up to the last `}` and close
 * the bracket. Returns the parsed array, or null.
 */
export function recoverTruncatedArray<T = any>(text: string): T[] | null {
  if (!text) return null;
  const cleaned = stripThinking(text);
  const start = cleaned.indexOf('[');
  if (start < 0) return null;
  const body = cleaned.slice(start);
  const lastBrace = body.lastIndexOf('}');
  if (lastBrace < 0) return null;
  const slab = body.slice(0, lastBrace + 1) + ']';
  for (const attempt of [slab, repairJsonish(slab)]) {
    try { const v = JSON.parse(attempt); if (Array.isArray(v)) return v as T[]; } catch { /* */ }
  }
  return null;
}
