import { generate, type ChatMessage } from '../llm/provider';
import { readSettings } from '../ipc/settings';
import { getProfile, getRoleFits } from '../experience/store';
import { parseMoves, type Move } from './parse';

export type { Move };

const SYSTEM = `Suggest ADJACENT and cross-industry career moves the candidate could realistically make, beyond
the obvious. The candidate prioritizes high pay + remote work — favor those. Be honest about reach.
Respond with ONLY a JSON array:
[ { "role_family": "...", "industry": "...|null", "rationale": "<why it fits, 1 sentence>",
    "pay_outlook": "low|medium|high", "remote_friendly": true|false, "confidence": "low|medium|high" } ]`;

export function buildMovesPrompt(profile: any, roleFits: any[]): ChatMessage[] {
  const skills = (profile?.skills ?? []).slice(0, 30).join(', ');
  const roles = roleFits.slice(0, 10).map((r: any) => r.role_family).join(', ');
  return [{ role: 'system', content: SYSTEM },
    { role: 'user', content: `Profile: ${profile?.narrative ?? 'n/a'} (seniority ${profile?.seniority ?? '?'}).\nSkills: ${skills || 'n/a'}.\nKnown role fits: ${roles || 'none'}.\n\nSuggest moves (max 10).` }];
}

export async function suggestMoves(): Promise<{ moves: Move[] } | { error: string }> {
  const profile = getProfile();
  if (!profile) return { error: 'No profile yet — analyze your experience first.' };
  try {
    const r = await generate(readSettings(), buildMovesPrompt(profile, getRoleFits()), { temperature: 0.5, maxTokens: 3000 });
    return { moves: parseMoves(r.text) };
  } catch (e: any) { return { error: e?.message ?? String(e) }; }
}
