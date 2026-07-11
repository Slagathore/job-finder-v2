import { getDb } from '../ipc/db';

/**
 * Persistent STAR story bank (career-ops interview-prep/story-bank.md, made
 * durable): stories accumulate across every interview prep instead of being
 * regenerated and forgotten per job.
 */

export interface Story {
  id: number;
  prompt: string;
  story: string;
  tags: string | null;
  source_job: number | null;
  created_at: number;
  last_used: number | null;
}

export function listStories(): Story[] {
  return getDb().prepare('SELECT * FROM story_bank ORDER BY COALESCE(last_used, created_at) DESC').all() as Story[];
}

export function addStory(prompt: string, story: string, tags?: string, sourceJob?: number): Story {
  const db = getDb();
  const now = Date.now();
  const r = db.prepare('INSERT INTO story_bank (prompt, story, tags, source_job, created_at) VALUES (?,?,?,?,?)')
    .run(prompt.trim(), story.trim(), tags?.trim() || null, sourceJob ?? null, now);
  return db.prepare('SELECT * FROM story_bank WHERE id = ?').get(r.lastInsertRowid) as Story;
}

export function deleteStory(id: number): void {
  getDb().prepare('DELETE FROM story_bank WHERE id = ?').run(id);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();

/** Persist freshly generated prep stories, skipping prompts already banked. */
export function saveGeneratedStories(jobId: number, stories: { q: string; a: string }[]): number {
  const db = getDb();
  const existing = new Set((db.prepare('SELECT prompt FROM story_bank').all() as { prompt: string }[]).map(r => norm(r.prompt)));
  const ins = db.prepare('INSERT INTO story_bank (prompt, story, source_job, created_at) VALUES (?,?,?,?)');
  const now = Date.now();
  let added = 0;
  const tx = db.transaction(() => {
    for (const s of stories) {
      if (!s.q?.trim() || !s.a?.trim() || existing.has(norm(s.q))) continue;
      existing.add(norm(s.q));
      ins.run(s.q.trim(), s.a.trim(), jobId, now);
      added++;
    }
  });
  tx();
  return added;
}

/** Mark bank stories as used (they were offered to a prep run). */
export function touchStories(ids: number[]): void {
  if (!ids.length) return;
  const db = getDb();
  const upd = db.prepare('UPDATE story_bank SET last_used = ? WHERE id = ?');
  const now = Date.now();
  const tx = db.transaction(() => { for (const id of ids) upd.run(now, id); });
  tx();
}
