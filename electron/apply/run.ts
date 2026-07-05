import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { tailorForJob } from './tailor';
import { renderResumeHtml, renderCoverHtml, type Candidate } from './render';
import { htmlFileToPdf } from './pdf';
import { saveApplicationDocs } from './store';
import { readSettings } from '../ipc/settings';

const slug = (s: string) => (s || 'job').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export interface TailorRunResult {
  ok: true; summary: string; bullets: number;
  cv: string; cover: string; pdf: boolean; pdfError: string | null;
}

/** Tailor a job, render CV + cover to HTML+PDF, save to history. Shared by the
 *  apply IPC and the agent console so both produce identical artifacts. */
export async function runTailor(jobId: number): Promise<TailorRunResult | { error: string }> {
  const ctx = await tailorForJob(jobId);
  if ('error' in ctx) return ctx;

  const s = readSettings();
  const cand: Candidate = {
    name: s.candidateName, email: s.candidateEmail, phone: s.candidatePhone,
    location: s.candidateLocation, links: s.candidateLinks,
  };
  const cvHtml = renderResumeHtml(cand, ctx.profile, ctx.tailored);
  const coverHtml = renderCoverHtml(cand, ctx.job, ctx.tailored);

  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(app.getPath('userData'), 'output', `${jobId}-${slug(ctx.job.company)}-${date}`);
  fs.mkdirSync(dir, { recursive: true });
  const cvHtmlPath = path.join(dir, 'cv.html');
  const coverHtmlPath = path.join(dir, 'cover.html');
  fs.writeFileSync(cvHtmlPath, cvHtml, 'utf-8');
  fs.writeFileSync(coverHtmlPath, coverHtml, 'utf-8');

  let cvPdf: string | null = null, coverPdf: string | null = null, pdfError: string | null = null;
  try {
    cvPdf = path.join(dir, 'cv.pdf'); await htmlFileToPdf(cvHtmlPath, cvPdf);
    coverPdf = path.join(dir, 'cover.pdf'); await htmlFileToPdf(coverHtmlPath, coverPdf);
  } catch (e: any) { pdfError = e?.message ?? String(e); }

  saveApplicationDocs(jobId, { cvHtml: cvHtmlPath, cvPdf, coverHtml: coverHtmlPath, coverPdf, tailored: ctx.tailored });

  return {
    ok: true, summary: ctx.tailored.summary,
    bullets: ctx.tailored.sections.reduce((n, s) => n + s.bullets.length, 0),
    cv: cvPdf || cvHtmlPath, cover: coverPdf || coverHtmlPath, pdf: !!cvPdf, pdfError,
  };
}
