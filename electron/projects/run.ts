/**
 * Project ingestion runs: GitHub repos, a local folder, or a deployed web app.
 *
 * Every source ends in the same place, `insertItemsDeduped`, so projects merge
 * with the rest of the experience corpus instead of forming a second island.
 * Provenance rides in source_ref: `github:<owner>/<repo>`, `folder:<basename>`,
 * `url:<host>`.
 *
 * Long runs report progress the way the updater does: a callback out to main,
 * which forwards it to the renderer. Nothing here blocks the UI thread, and a
 * repo already done at the requested depth is skipped so a rerun resumes.
 */

import * as path from 'path';
import type { Settings } from '../ipc/settings';
import { generate } from '../llm/provider';
import { insertItemsDeduped } from '../experience/store';
import { fetchHtml } from '../boards/fetch-html';
import { chunkFiles, type SourceFile } from './filter';
import {
  buildChunkPrompt, buildDeepPrompt, buildMediumPrompt, parseProjectItems, progressPercent,
  type ProjectDepth, type ProjectFacts,
} from './prompt';
import { fetchDeepSource, fetchMediumFacts, getRepo, type GhRepo } from './github';
import { listRepos, markDigested, pendingRepos, setRepoState } from './store';
import { extractPageSignals, signalsToFacts, urlHost } from './webapp';
import { languageMix, readFolderManifest, readFolderReadme, readFolderSource, topLevelEntries, walkFolder } from './walk';

export interface ProjectProgress {
  running: boolean;
  phase: string;          // short user-facing line, e.g. "Reading source"
  current: string;        // which repo/folder is in flight
  done: number;
  total: number;
  percent: number;
}

export type ProgressSink = (p: ProjectProgress) => void;

export interface DigestOutcome { items: number; added: number; merged: number }

/** One scan or deep dive at a time: they share the API budget and the LLM. */
let running = false;
export function isRunning(): boolean { return running; }

/**
 * Ask the LLM for line items and store them, deduped against everything else.
 *
 * Digesting the same source_ref again (a repeat GitHub scan of the same repo,
 * a medium pass followed by a deep dive, a re-run folder or URL digest)
 * supersedes the previous pass rather than appending a second, near-duplicate
 * description of the same project: see insertItemsDeduped's supersedeSourceRef.
 */
async function storeItems(
  llmText: string, projectName: string, sourceRef: string
): Promise<DigestOutcome> {
  const items = parseProjectItems(llmText, projectName);
  const { added, merged } = insertItemsDeduped(
    items.map(i => ({ ...i, source_ref: sourceRef })) as any,
    { supersedeSourceRef: sourceRef }
  );
  return { items: items.length, added, merged };
}

/** Medium dive over one repo: metadata, README, manifest, languages, top tree. */
export async function digestRepoMedium(s: Settings, token: string, repo: GhRepo): Promise<DigestOutcome> {
  const { readme, languages, tree, manifest } = await fetchMediumFacts(token, repo);
  const facts: ProjectFacts = {
    name: repo.full_name,
    description: repo.description,
    url: repo.html_url,
    isPrivate: repo.private,
    language: repo.language,
    languages,
    pushedAt: repo.pushed_at,
    readme,
    manifestName: manifest?.name ?? null,
    manifest: manifest?.content ?? null,
    tree,
  };
  const r = await generate(s, buildMediumPrompt(facts), { temperature: 0.2, maxTokens: 9000 });
  return storeItems(r.text, repo.full_name, `github:${repo.full_name}`);
}

/**
 * Summarize the read source in chunks, so a big repo still fits a context.
 * `onChunk(i, n)` fires before each chunk's LLM call (1-indexed i, of n total)
 * so a caller can report "summarizing chunk 3 of 12" instead of a flat phase
 * label that never changes for however long the chunk loop takes.
 */
async function summarizeSource(
  s: Settings, projectName: string, files: SourceFile[], onChunk?: (i: number, n: number) => void
): Promise<string[]> {
  const notes: string[] = [];
  const chunks = chunkFiles(files);
  for (let i = 0; i < chunks.length; i++) {
    onChunk?.(i + 1, chunks.length);
    const r = await generate(s, buildChunkPrompt(projectName, chunks[i]), { temperature: 0.2, maxTokens: 3000 });
    const text = r.text.trim();
    if (text) notes.push(text);
  }
  return notes;
}

/**
 * Deep dive over one repo: everything the medium pass reads, plus a bounded
 * walk of the actual source (see filter.ts for the caps), summarized in chunks
 * and then synthesized into a richer set of line items.
 *
 * `onPhase(phase, fraction)` reports both a human phase label and how far
 * through THIS repo's deep dive we are (0-1), so a caller can move a progress
 * bar within one long-running item instead of it sitting still until the
 * whole thing finishes.
 */
export async function digestRepoDeep(
  s: Settings, token: string, repo: GhRepo, onPhase?: (phase: string, fraction: number) => void
): Promise<DigestOutcome> {
  onPhase?.('Reading metadata', 0.05);
  const { readme, languages, tree, manifest } = await fetchMediumFacts(token, repo);
  onPhase?.('Reading source', 0.15);
  const files = await fetchDeepSource(token, repo);
  const facts: ProjectFacts = {
    name: repo.full_name,
    description: repo.description,
    url: repo.html_url,
    isPrivate: repo.private,
    language: repo.language,
    languages,
    pushedAt: repo.pushed_at,
    readme,
    manifestName: manifest?.name ?? null,
    manifest: manifest?.content ?? null,
    tree,
  };
  if (!files.length) {
    onPhase?.('No readable source, falling back to metadata', 0.5);
    const r = await generate(s, buildMediumPrompt(facts), { temperature: 0.2, maxTokens: 9000 });
    return storeItems(r.text, repo.full_name, `github:${repo.full_name}`);
  }
  onPhase?.(`Summarizing ${files.length} source files`, 0.3);
  const notes = await summarizeSource(s, repo.full_name, files, (i, n) =>
    onPhase?.(`Summarizing chunk ${i} of ${n}`, 0.3 + (i / n) * 0.5));
  onPhase?.('Writing line items', 0.9);
  const r = await generate(s, buildDeepPrompt(facts, notes), { temperature: 0.25, maxTokens: 12_000 });
  return storeItems(r.text, repo.full_name, `github:${repo.full_name}`);
}

export interface ScanResult {
  scanned: number;
  skipped: number;
  failed: number;
  added: number;
  merged: number;
  errors: { repo: string; error: string }[];
}

/**
 * Digest every repo that is not already done at this depth. One repo failing
 * does not stop the run: its error is stored on the row and the scan moves on.
 */
export async function scanRepos(
  s: Settings, token: string, depth: ProjectDepth, onProgress: ProgressSink
): Promise<ScanResult> {
  const todo = pendingRepos(depth);
  const skipped = listRepos().length - todo.length;
  const result: ScanResult = { scanned: 0, skipped, failed: 0, added: 0, merged: 0, errors: [] };
  const total = todo.length;

  const emit = (phase: string, current: string, done: number, fraction = 0) =>
    onProgress({ running: true, phase, current, done, total, percent: progressPercent(done, total, fraction) });

  emit('Starting', '', 0);
  for (let i = 0; i < todo.length; i++) {
    const row = todo[i];
    emit('Digesting', row.full_name, i);
    setRepoState(row.full_name, 'running');
    try {
      const repo = await getRepo(token, row.full_name);
      const out = depth === 'deep'
        ? await digestRepoDeep(s, token, repo, (ph, frac) => emit(ph, row.full_name, i, frac))
        : await digestRepoMedium(s, token, repo);
      markDigested(row.full_name, depth, out.items);
      result.scanned++;
      result.added += out.added;
      result.merged += out.merged;
    } catch (e: any) {
      const msg = String(e?.message ?? e).slice(0, 400);
      setRepoState(row.full_name, 'error', msg);
      result.failed++;
      result.errors.push({ repo: row.full_name, error: msg });
    }
    emit('Digesting', row.full_name, i + 1);
  }
  onProgress({ running: false, phase: 'Done', current: '', done: total, total, percent: 100 });
  return result;
}

/** Deep dive one named repo, on demand from the dropdown. */
export async function deepDiveRepo(
  s: Settings, token: string, fullName: string, onProgress: ProgressSink
): Promise<DigestOutcome> {
  const emit = (phase: string, fraction = 0) =>
    onProgress({ running: true, phase, current: fullName, done: 0, total: 1, percent: progressPercent(0, 1, fraction) });
  emit('Starting', 0);
  setRepoState(fullName, 'running');
  try {
    const repo = await getRepo(token, fullName);
    const out = await digestRepoDeep(s, token, repo, emit);
    markDigested(fullName, 'deep', out.items);
    onProgress({ running: false, phase: 'Done', current: fullName, done: 1, total: 1, percent: 100 });
    return out;
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 400);
    setRepoState(fullName, 'error', msg);
    onProgress({ running: false, phase: 'Failed', current: fullName, done: 1, total: 1, percent: 100 });
    throw e;
  }
}

/** Deep dive a folder on disk, using the same bounded walk as a repo. */
export async function digestFolder(
  s: Settings, root: string, onProgress: ProgressSink
): Promise<DigestOutcome> {
  const base = path.basename(root.replace(/[\\/]+$/, '')) || root;
  const sourceRef = `folder:${base}`;
  const emit = (phase: string, percent: number) =>
    onProgress({ running: true, phase, current: base, done: 0, total: 1, percent });

  emit('Walking the folder', 10);
  const walked = walkFolder(root);
  const files = readFolderSource(root);
  const mix = languageMix(walked);
  const manifest = readFolderManifest(root);
  const facts: ProjectFacts = {
    name: base,
    description: null,
    url: null,
    language: Object.entries(mix).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    languages: mix,
    readme: readFolderReadme(root),
    manifestName: manifest?.name ?? null,
    manifest: manifest?.content ?? null,
    tree: topLevelEntries(root),
  };
  let notes: string[] = [];
  if (files.length) {
    emit(`Summarizing ${files.length} source files`, 40);
    notes = await summarizeSource(s, base, files, (i, n) =>
      emit(`Summarizing chunk ${i} of ${n}`, 40 + Math.round((i / n) * 40)));
  }
  emit('Writing line items', 85);
  const messages = notes.length ? buildDeepPrompt(facts, notes) : buildMediumPrompt(facts);
  const r = await generate(s, messages, { temperature: 0.25, maxTokens: 12_000 });
  const out = await storeItems(r.text, base, sourceRef);
  onProgress({ running: false, phase: 'Done', current: base, done: 1, total: 1, percent: 100 });
  return out;
}

/** Digest a deployed web app from its page text and visible tech signals. */
export async function digestWebApp(
  s: Settings, url: string, onProgress: ProgressSink
): Promise<DigestOutcome> {
  const host = urlHost(url);
  if (!host) throw new Error('That does not look like a URL. Include the https:// part.');
  const emit = (phase: string, percent: number) =>
    onProgress({ running: true, phase, current: host, done: 0, total: 1, percent });

  emit('Fetching the page', 20);
  const html = await fetchHtml(url);
  if (!html.trim()) throw new Error(`Nothing came back from ${host}. Check the URL is reachable.`);
  const signals = extractPageSignals(html);
  if (!signals.text && !signals.title) {
    throw new Error(`${host} returned a page with no readable text, so there is nothing to digest.`);
  }
  emit('Writing line items', 70);
  const facts: ProjectFacts = {
    name: signals.title || host,
    description: signals.description || null,
    url,
    language: null,
    readme: signalsToFacts(url, signals),
    tree: signals.tech.length ? signals.tech : null,
  };
  const r = await generate(s, buildMediumPrompt(facts), { temperature: 0.25, maxTokens: 9000 });
  const out = await storeItems(r.text, host, `url:${host}`);
  onProgress({ running: false, phase: 'Done', current: host, done: 1, total: 1, percent: 100 });
  return out;
}

/** Guard so two runs never share the API budget. Returns false when busy. */
export function acquire(): boolean {
  if (running) return false;
  running = true;
  return true;
}
export function release(): void { running = false; }
