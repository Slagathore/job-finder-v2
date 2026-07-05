import { BrowserWindow } from 'electron';
import { getDb } from '../ipc/db';
import { readSettings } from '../ipc/settings';

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Build label→value answers from candidate settings + learned field memory. */
function buildAnswers(jobId: number): { answers: Record<string, string>; resumePath: string | null } {
  const s = readSettings();
  const links = (s.candidateLinks || '').split(',').map((x: string) => x.trim()).filter(Boolean);
  const linkedin = links.find((l: string) => /linkedin/i.test(l)) || '';
  const github = links.find((l: string) => /github/i.test(l)) || '';
  const website = links.find((l: string) => !/linkedin|github/i.test(l)) || links[0] || '';
  const parts = (s.candidateName || '').trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ');

  const answers: Record<string, string> = {
    'first name': firstName, 'last name': lastName, 'full name': s.candidateName, 'name': s.candidateName,
    'email': s.candidateEmail, 'e-mail': s.candidateEmail,
    'phone': s.candidatePhone, 'mobile': s.candidatePhone, 'phone number': s.candidatePhone,
    'location': s.candidateLocation, 'city': s.candidateLocation,
    'linkedin': linkedin, 'github': github, 'website': website, 'portfolio': website,
  };
  for (const m of getDb().prepare('SELECT normalized_label, value FROM field_memory').all() as any[]) {
    if (m.normalized_label && m.value) answers[m.normalized_label] = m.value;
  }
  const app = getDb().prepare('SELECT tailored_cv_path FROM applications WHERE job_id = ?').get(jobId) as any;
  return { answers, resumePath: app?.tailored_cv_path || null };
}

// ── Scripts injected into the real page (third-party apply form) ──────────────

// Detect a personality/aptitude/psychometric assessment — we deliberately do NOT
// auto-answer these (no engineering a result); the user completes them.
const ASSESS_CHECK = `(() => {
  const t = (document.title + ' ' + location.href + ' ' + (document.body ? document.body.innerText.slice(0,4000) : '')).toLowerCase();
  const kw = ['personality test','personality assessment','aptitude test','cognitive assessment','predictive index',
    'culture index','wonderlic','hogan assessment','disc assessment','mbti','myers-briggs','psychometric',
    'behavioral assessment','situational judgement','situational judgment'];
  return kw.some(k => t.includes(k));
})()`;

const CLICK_THROUGH = `(() => {
  const hasForm = !!document.querySelector('input[type=file]') ||
    document.querySelectorAll('input[type=text],input[type=email],textarea').length >= 3;
  if (hasForm) return false;
  const texts = ['apply for this job','apply now','easy apply','apply','start application',"i'm interested"];
  const els = Array.from(document.querySelectorAll('a,button,[role=button],input[type=submit]'));
  for (const t of texts) for (const el of els) {
    const lab = (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().toLowerCase();
    if (lab && lab.length < 40 && (lab === t || lab.startsWith(t))) { el.click(); return true; }
  }
  return false;
})()`;

function fillScript(answersJson: string): string {
  return `(() => {
    const A = ${answersJson};
    const norm = s => (s||'').toLowerCase().replace(/[*:#]/g,'').replace(/\\s+/g,' ').trim();
    const isEEO = l => /gender|race|ethnic|hispanic|latino|veteran|disabilit|sexual orientation/i.test(l);
    const DECLINE = /decline|prefer not|don.?t wish|do not wish|not to answer|not disclos|rather not/i;
    const labelFor = el => {
      if (el.id) { const l = document.querySelector('label[for="'+CSS.escape(el.id)+'"]'); if (l && l.textContent.trim()) return l.textContent; }
      const w = el.closest('label'); if (w && w.textContent.trim()) return w.textContent;
      return el.getAttribute('aria-label') || el.placeholder || el.name || '';
    };
    const valueFor = label => {
      const n = norm(label); if (!n) return null;
      if (A[n] != null && A[n] !== '') return A[n];
      for (const k of Object.keys(A)) { if (A[k] && (n.includes(k) || k.includes(n))) return A[k]; }
      return null;
    };
    const setNative = (el, v) => {
      const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, String(v));
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    const filled = [], skipped = [];
    // text / textarea
    for (const el of document.querySelectorAll('input,textarea')) {
      const type = (el.type || '').toLowerCase();
      if (['hidden','submit','button','file','password','checkbox','radio','image','reset'].includes(type)) continue;
      if (el.value && String(el.value).trim()) continue;
      const label = labelFor(el); const v = valueFor(label);
      if (v == null) { if (label && label.trim()) skipped.push(label.trim().slice(0,60)); continue; }
      try { setNative(el, v); filled.push(label.trim().slice(0,60)); } catch (e) {}
    }
    // selects (incl. EEO → choose a decline option)
    for (const sel of document.querySelectorAll('select')) {
      if (sel.value && sel.selectedIndex > 0) continue;
      const label = labelFor(sel);
      const opts = Array.from(sel.options);
      let pick = null;
      if (isEEO(label)) pick = opts.find(o => DECLINE.test(o.textContent || ''));
      else { const v = valueFor(label); if (v != null) { const nv = norm(v); pick = opts.find(o => norm(o.textContent).includes(nv) || norm(o.value).includes(nv)); } }
      if (pick) { try { setNative(sel, pick.value); filled.push((label||'select').trim().slice(0,60)); } catch (e) {} }
    }
    return { filled, skipped, fileInputs: document.querySelectorAll('input[type=file]').length };
  })()`;
}

function submitIfCompleteScript(): string {
  return `(() => {
    const req = Array.from(document.querySelectorAll('[required],[aria-required="true"]')).filter(el => {
      const t = (el.type||'').toLowerCase();
      if (t==='checkbox'||t==='radio') { const n = el.name; return n ? !document.querySelector('input[name="'+CSS.escape(n)+'"]:checked') : !el.checked; }
      if (t==='file') return !el.files || el.files.length===0;
      if (el.tagName==='SELECT') return el.selectedIndex<=0;
      return !el.value || !String(el.value).trim();
    });
    if (req.length > 0) return { submitted:false, requiredEmpty:req.length };
    const texts = ['submit application','submit','send application','finish','apply'];
    const els = Array.from(document.querySelectorAll('button,input[type=submit],[role=button]'));
    for (const t of texts) for (const el of els) {
      const lab = (el.innerText || el.value || '').trim().toLowerCase();
      if (lab && lab.length < 40 && (lab===t || lab.startsWith(t))) { el.click(); return { submitted:true, requiredEmpty:0 }; }
    }
    return { submitted:false, requiredEmpty:0, noButton:true };
  })()`;
}

/** Upload a file into the first file input via CDP (JS can't set file inputs). */
async function uploadResume(win: BrowserWindow, filePath: string): Promise<boolean> {
  const dbg = win.webContents.debugger;
  try { dbg.attach('1.3'); } catch { /* already attached */ }
  try {
    await dbg.sendCommand('DOM.enable');
    const doc: any = await dbg.sendCommand('DOM.getDocument', { depth: -1 });
    const q: any = await dbg.sendCommand('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
    if (q && q.nodeId) { await dbg.sendCommand('DOM.setFileInputFiles', { files: [filePath], nodeId: q.nodeId }); return true; }
    return false;
  } finally { try { dbg.detach(); } catch { /* */ } }
}

export interface ApplyFillResult {
  ok: boolean; filled: number; skipped: number; fileUploaded: boolean;
  submitted?: boolean; assessment?: boolean; error?: string;
}

/**
 * Open the posting in a real Electron session window, click through to the form,
 * auto-fill known fields (incl. selects + EEO→decline), upload the tailored
 * résumé, and — only if `autoSubmitWhenComplete` is on and nothing required is
 * left empty — click Submit. Personality/aptitude ASSESSMENTS are detected and
 * left for the user (never auto-answered / engineered). Window stays open.
 */
export async function applyInWindow(jobId: number): Promise<ApplyFillResult> {
  const db = getDb();
  const job = db.prepare('SELECT id, company, url FROM jobs WHERE id = ?').get(jobId) as any;
  if (!job?.url) return { ok: false, filled: 0, skipped: 0, fileUploaded: false, error: 'No URL for this job.' };

  const { answers, resumePath } = buildAnswers(jobId);
  const win = new BrowserWindow({
    width: 1120, height: 920, title: `Apply — ${job.company}`,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  try {
    await win.loadURL(job.url, { timeout: 30_000 } as any);
    await wait(1600);

    if (await win.webContents.executeJavaScript(ASSESS_CHECK, true).catch(() => false)) {
      return { ok: true, assessment: true, filled: 0, skipped: 0, fileUploaded: false };
    }

    let clicked = false;
    try { clicked = await win.webContents.executeJavaScript(CLICK_THROUGH, true); } catch { /* */ }
    if (clicked) await wait(2200);
    // After clicking through, re-check for an assessment step.
    if (await win.webContents.executeJavaScript(ASSESS_CHECK, true).catch(() => false)) {
      return { ok: true, assessment: true, filled: 0, skipped: 0, fileUploaded: false };
    }

    const res: any = await win.webContents.executeJavaScript(fillScript(JSON.stringify(answers)), true);
    let fileUploaded = false;
    if (res.fileInputs > 0 && resumePath) { try { fileUploaded = await uploadResume(win, resumePath); } catch { /* */ } }

    let submitted = false;
    if (readSettings().autoSubmitWhenComplete) {
      await wait(600);
      try { const r: any = await win.webContents.executeJavaScript(submitIfCompleteScript(), true); submitted = !!r.submitted; } catch { /* */ }
    }

    return { ok: true, filled: res.filled.length, skipped: res.skipped.length, fileUploaded, submitted, assessment: false };
  } catch (e: any) {
    return { ok: false, filled: 0, skipped: 0, fileUploaded: false, error: e?.message ?? String(e) };
  }
}
