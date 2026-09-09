import { getDb } from '../ipc/db';
import type { ChatMessage } from '../llm/provider';
import { titleFromMessage } from './title';
import { normalizeMode, type AgentMode } from './interview';

/**
 * Persistent agent-console conversations. Threads live in SQLite so a reload or
 * an app restart redraws the same chat, plans and step results included.
 */

/** How many past turns get replayed to the model. Deliberately bounded: the
 *  transcript on disk can be long, the prompt must not be. */
export const HISTORY_TURNS = 6;

export interface ConversationRow {
  id: number;
  title: string;
  mode: AgentMode;
  created_at: number;
  updated_at: number;
  message_count: number;
}

export interface StoredMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  plan?: any;
  results?: any[];
  created_at: number;
}

const parseJson = (s: string | null): any => {
  if (!s) return undefined;
  try { return JSON.parse(s); } catch { return undefined; }
};

export function listConversations(limit = 100): ConversationRow[] {
  const rows = getDb().prepare(`
    SELECT c.id, c.title, c.mode, c.created_at, c.updated_at,
           (SELECT COUNT(*) FROM agent_messages m WHERE m.conversation_id = c.id) AS message_count
    FROM agent_conversations c
    ORDER BY c.updated_at DESC, c.id DESC
    LIMIT ?`).all(limit) as any[];
  return rows.map(r => ({ ...r, mode: normalizeMode(r.mode) }));
}

export function createConversation(mode: AgentMode, firstMessage: string): number {
  const now = Date.now();
  const r = getDb().prepare('INSERT INTO agent_conversations (title, mode, created_at, updated_at) VALUES (?,?,?,?)')
    .run(titleFromMessage(firstMessage), normalizeMode(mode), now, now);
  return Number(r.lastInsertRowid);
}

export function getConversation(id: number): { id: number; title: string; mode: AgentMode; messages: StoredMessage[] } | null {
  const db = getDb();
  const conv = db.prepare('SELECT id, title, mode FROM agent_conversations WHERE id = ?').get(id) as any;
  if (!conv) return null;
  const rows = db.prepare(
    'SELECT id, role, content, plan, results, created_at FROM agent_messages WHERE conversation_id = ? ORDER BY id'
  ).all(id) as any[];
  return {
    id: conv.id,
    title: conv.title,
    mode: normalizeMode(conv.mode),
    messages: rows.map(r => ({
      id: r.id,
      role: r.role === 'user' ? 'user' : 'assistant',
      content: r.content,
      plan: parseJson(r.plan),
      results: parseJson(r.results),
      created_at: r.created_at,
    })),
  };
}

export function appendMessage(
  conversationId: number,
  msg: { role: 'user' | 'assistant'; content: string; plan?: any; results?: any[] }
): number {
  const db = getDb();
  const now = Date.now();
  const r = db.prepare('INSERT INTO agent_messages (conversation_id, role, content, plan, results, created_at) VALUES (?,?,?,?,?,?)')
    .run(conversationId, msg.role, msg.content ?? '', msg.plan ? JSON.stringify(msg.plan) : null,
      msg.results ? JSON.stringify(msg.results) : null, now);
  db.prepare('UPDATE agent_conversations SET updated_at = ? WHERE id = ?').run(now, conversationId);
  return Number(r.lastInsertRowid);
}

/** Persist the results of a run against the assistant turn that proposed it. */
export function saveResults(messageId: number, results: any[]): void {
  getDb().prepare('UPDATE agent_messages SET results = ? WHERE id = ?').run(JSON.stringify(results ?? []), messageId);
}

/** Replace one step result in place, for a confirm-gated step the user approved. */
export function saveStepResult(messageId: number, index: number, result: any): void {
  const db = getDb();
  const row = db.prepare('SELECT results FROM agent_messages WHERE id = ?').get(messageId) as { results: string | null } | undefined;
  if (!row) return;
  const results = parseJson(row.results);
  if (!Array.isArray(results) || index < 0 || index >= results.length) return;
  results[index] = result;
  db.prepare('UPDATE agent_messages SET results = ? WHERE id = ?').run(JSON.stringify(results), messageId);
}

export function deleteConversation(id: number): void {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM agent_messages WHERE conversation_id = ?').run(id);
    db.prepare('DELETE FROM agent_conversations WHERE id = ?').run(id);
  });
  tx();
}

/**
 * The bounded window sent to the model: the last few turns of this thread,
 * read back from disk rather than from renderer state.
 */
export function historyFor(conversationId: number, turns = HISTORY_TURNS): ChatMessage[] {
  const rows = getDb().prepare(
    'SELECT role, content FROM agent_messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?'
  ).all(conversationId, turns) as { role: string; content: string }[];
  return rows.reverse()
    .filter(r => (r.content ?? '').trim().length > 0)
    .map(r => ({ role: r.role === 'user' ? 'user' : 'assistant', content: r.content } as ChatMessage));
}
