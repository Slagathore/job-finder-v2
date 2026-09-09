import { generate, type ChatMessage } from '../llm/provider';
import { readSettings } from '../ipc/settings';
import { getProfile, getRoleFits } from '../experience/store';
import { parseMoves, type Move } from './parse';

export type { Move };

const SYSTEM = `Suggest ADJACENT and cross-industry career moves the candidate could realistically make, beyond
the obvious. The candidate prioritizes high pay + remote work, so favor those. Be honest about reach.

For every move you MUST say what it makes the candidate a candidate FOR: "industries" is the list of
industries that hire for it, and "titles" is the list of real posting titles they could apply to
(what a job board actually calls the role, not a vague family name).

Respond with ONLY a JSON array:
[ { "role_family": "...", "industry": "...|null", "rationale": "<why it fits, 1 sentence>",
    "pay_outlook": "low|medium|high", "remote_friendly": true|false, "confidence": "low|medium|high",
    "industries": ["..."], "titles": ["..."] } ]`;

export function buildMovesPrompt(profile: any, roleFits: any[]): ChatMessage[] {
  const skills = (profile?.skills ?? []).slice(0, 30).join(', ');
  const roles = roleFits.slice(0, 10).map((r: any) => r.role_family).join(', ');
  return [{ role: 'system', content: SYSTEM },
    { role: 'user', content: `Profile: ${profile?.narrative ?? 'n/a'} (seniority ${profile?.seniority ?? '?'}).\nSkills: ${skills || 'n/a'}.\nKnown role fits: ${roles || 'none'}.\n\nSuggest moves (max 10).` }];
}

export async function suggestMoves(): Promise<{ moves: Move[] } | { error: string }> {
  const profile = getProfile();
  if (!profile) return { error: 'No profile yet. Analyze your experience first.' };
  try {
    const r = await generate(readSettings(), buildMovesPrompt(profile, getRoleFits()), { temperature: 0.5, maxTokens: 3000 });
    return { moves: parseMoves(r.text) };
  } catch (e: any) { return { error: e?.message ?? String(e) }; }
}
