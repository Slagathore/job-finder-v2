import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, Notification } from 'electron';
import * as path from 'path';
import { initDb } from './ipc/db';
import { registerSettingsHandlers, readSettings, writeSetting, migrateSecrets } from './ipc/settings';
import { registerLlmHandlers } from './ipc/llm';
import { registerJobHandlers } from './ipc/jobs';
import { registerBoardHandlers, seedBoardsIfEmpty } from './ipc/boards';
import { registerScanHandlers } from './ipc/scan';
import { registerExperienceHandlers } from './ipc/experience';
import { registerDiscoveryHandlers } from './ipc/discovery';
import { registerGeoHandlers } from './ipc/geo';
import { registerRuleHandlers } from './ipc/rules';
import { registerApplyHandlers } from './ipc/apply';
import { registerAgentHandlers } from './ipc/agent';
import { registerSelfExtHandlers } from './ipc/selfext';
import { registerBlocklistHandlers } from './ipc/blocklist';
import { registerPipelineHandlers } from './ipc/pipeline';
import { registerNotificationHandlers, addNotification } from './ipc/notifications';
import { registerGmailHandlers, handleOAuthCode } from './ipc/gmail';
import { ingestInbox } from './gmail/ingest';
import { registerIntelHandlers } from './ipc/intel';
import { registerFollowupHandlers } from './ipc/followups';
import { registerMaintenanceHandlers } from './ipc/maintenance';
import { runPrune } from './maintenance/prune';
import { registerDigestHandlers } from './ipc/digest';
import { registerActivityHandlers } from './ipc/activity';
import { registerSearchHandlers } from './ipc/searches';
import { registerExportHandlers } from './ipc/export';
import { registerWatchHandlers } from './ipc/watch';
import { startHubServer } from './server/http';
import { ingestJobs, ingestFields } from './ingest/jobs';
import { getDb, closeDb } from './ipc/db';
import { killAllChildren } from './selfext/exec';
import { randomUUID } from 'crypto';
import { runScan } from './scan/runner';
import { checkForUpdates, silenceUpdates } from './update/check';
import { runEmbeddings, discover } from './discovery/service';
import { discoverBoardsFromJobs } from './boards/autodiscover';
import { collapseAggregatorDupes } from './maintenance/dedupe';
import { runBackup } from './maintenance/backup';
import type { Server } from 'http';

// Dev = unpackaged AND not forced to prod. JF_PROD lets `npm start` / a smoke
// test run the BUILT renderer (loadFile) without a Vite dev server.
const isDev = !app.isPackaged && !process.env.JF_PROD;
const ICON = path.join(__dirname, '..', 'build', 'icon.png');

// JF_USER_DATA points the app at an alternate data directory (own DB, hub
// token, and single-instance lock) — lets tests/screenshots run beside a
// live instance without touching real data. Must be set before the lock check.
if (process.env.JF_USER_DATA) app.setPath('userData', process.env.JF_USER_DATA);

// Windows toasts are attributed by AppUserModelId; without matching the appId
// they can silently fail from the portable exe / dev runs.
if (process.platform === 'win32') app.setAppUserModelId('com.cole.jobfinder');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let closeToTray = true;
let quitting = false;
let scanTimer: NodeJS.Timeout | null = null;
let backupTimer: NodeJS.Timeout | null = null;
let hubServer: Server | null = null;
let shuttingDown = false;

// Single-instance: a second launch focuses the existing window instead of
// starting a duplicate (which would fight over the DB + hub port).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

/** Graceful teardown: stop timers, close the hub server, kill sandbox child
 *  processes, and checkpoint+close the DB. Idempotent. */
function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  if (backupTimer) { clearInterval(backupTimer); backupTimer = null; }
  if (embedTimer) { clearTimeout(embedTimer); embedTimer = null; }
  if (atsTimer) { clearTimeout(atsTimer); atsTimer = null; }
  try { hubServer?.closeAllConnections?.(); hubServer?.close(); } catch { /* */ }
  killAllChildren();
  try { tray?.destroy(); tray = null; } catch { /* */ }
  closeDb();
}

/** Hard stop: ensure absolutely everything is dead, then exit immediately. */
function forceQuit(): void {
  quitting = true;
  killAllChildren();
  shutdown();
  app.exit(0);
}

/** Send to the renderer only if the window is alive — avoids throwing after the
 *  window is hidden/destroyed (e.g. background scan finishing during shutdown). */
function send(channel: string, ...args: any[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.webContents.send(channel, ...args); } catch { /* renderer gone */ }
  }
}

function showWindow() {
  if (!mainWindow) { createWindow(); return; }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
}

function buildTray() {
  if (tray) return;
  let image = nativeImage.createFromPath(ICON);
  if (image.isEmpty()) { try { image = nativeImage.createEmpty(); } catch { /* */ } }
  else image = image.resize({ width: 16, height: 16 });
  try {
    tray = new Tray(image);
  } catch {
    tray = null;
    return;
  }
  tray.setToolTip('Job Finder');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Job Finder', click: () => showWindow() },
    { label: 'Scan now', click: () => scheduledTick('manual').catch(err => console.error('[tray] scan failed:', err?.message ?? err)) },
    { label: 'Open Search', click: () => { showWindow(); send('open-tab', 'search'); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
    { label: 'Force Quit (kill background)', click: () => forceQuit() },
  ]));
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

/** Desktop notification that focuses the app (optionally on a tab) on click. */
function notify(body: string, tab?: string) {
  try {
    const n = new Notification({ title: 'Job Finder', body });
    n.on('click', () => { showWindow(); if (tab) send('open-tab', tab); });
    n.show();
  } catch { /* headless / notifications disabled */ }
}

/**
 * The full "works while you sleep" chain (PLAN.md §6.19, upgraded): scan the
 * ATS boards, collapse aggregator dupes into the fresh ATS rows, embed anything
 * new, surface the best fits, and tell Cole what's actually worth looking at —
 * not just how many rows landed.
 */
let tickRunning = false;
async function scheduledTick(trigger: 'manual' | 'scheduled'): Promise<void> {
  // Reentrancy guard: a slow cycle (many boards, cold embed model) must not
  // stack with the next interval firing — skip instead of overlapping.
  if (tickRunning) { console.log('[scheduler] previous cycle still running — tick skipped'); return; }
  tickRunning = true;
  try {
    const s = await runScan(trigger);
    console.log(`[scheduler] scan: +${s.added} jobs (${s.found} found, ${s.scanned} boards)`);
    try { collapseAggregatorDupes(); } catch (e: any) { console.error('[dedupe]', e?.message ?? e); }
    if (s.added > 0) {
      let topLine = '';
      try {
        await runEmbeddings(false);
        const d = await discover(20);
        const top = (d.results ?? [])[0];
        if (top?.sim) topLine = ` · top fit ${Math.round(top.sim * 100)}%: ${top.title} @ ${top.company}`;
      } catch (e: any) { console.error('[scheduler] embed/discover skipped:', e?.message ?? e); }
      try { addNotification('jobs', { added: s.added, found: s.found, scanned: s.scanned, topLine }); } catch { /* */ }
      if (readSettings().notifyOnNewJobs) {
        notify(`${s.added} new job${s.added === 1 ? '' : 's'} from the latest scan${topLine}`, 'search');
      }
      send('scan:done', s);
      send('notify');
    }
  } finally {
    tickRunning = false;
  }
}

/**
 * Background scheduler (PLAN.md §6.19): on the configured cadence, runs the
 * scan→dedupe→embed→discover chain and (when Gmail is connected) a mail
 * ingest, surfacing notifications. Re-armed whenever the interval changes.
 */
let mailRunning = false;

function armScheduler() {
  if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
  const minutes = Number(readSettings().scanIntervalMinutes) || 0;
  if (minutes <= 0) return;
  scanTimer = setInterval(() => {
    scheduledTick('scheduled').catch(err => console.error('[scheduler] scan failed:', err?.message ?? err));
    // Opportunistic retention prune (safe: untouched old discovered jobs only).
    try { runPrune(); } catch { /* */ }
    // Also ingest mail on the same cadence when Gmail is connected.
    // Same reentrancy rule: never launch a second ingest over a slow one.
    if (readSettings().gmailRefreshToken && !mailRunning) {
      mailRunning = true;
      ingestInbox()
        .then(r => { if (r.advanced > 0) send('notify'); })
        .catch(err => console.error('[scheduler] mail ingest failed:', err?.message ?? err))
        .finally(() => { mailRunning = false; });
    }
  }, minutes * 60_000);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0f1115',
    icon: ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5177'); // 5173 belongs to DungeonMaster on this machine.
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('close', (e) => {
    if (!quitting && closeToTray) {
      e.preventDefault();
      mainWindow?.hide();
      // One-time hint: without this, the first hide-to-tray reads as "the app
      // won't close" to a new user.
      try {
        if (!readSettings().trayHintShown) {
          writeSetting('trayHintShown', true);
          notify('Job Finder is still running in the system tray — scheduled scans and the extension keep working. Right-click the tray icon to quit, or turn this off in Settings.');
        }
      } catch { /* */ }
    } else {
      // Close-to-tray off: closing the window means quit — without this,
      // window-all-closed leaves a headless process running behind the tray.
      quitting = true;
    }
  });

  // Renderer crash recovery: reload the window instead of leaving it blank.
  // Throttled so a crash loop can't spin the CPU.
  let lastRendererReload = 0;
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    console.error('[renderer] process gone:', details.reason);
    const now = Date.now();
    if (now - lastRendererReload > 30_000 && mainWindow && !mainWindow.isDestroyed()) {
      lastRendererReload = now;
      mainWindow.webContents.reload();
    }
  });
}

/** Generate + persist a hub token on first boot so the extension can pair. */
function ensureHubToken(): string {
  let token = readSettings().hubToken;
  if (!token) {
    token = randomUUID();
    writeSetting('hubToken', token);
  }
  return token;
}

// Auto-embed after extension harvests (PLAN §6.18 without the manual “Embed”
// click): debounced so a burst of pages triggers one embedding run at the end.
let embedTimer: NodeJS.Timeout | null = null;
function scheduleAutoEmbed() {
  if (embedTimer) clearTimeout(embedTimer);
  embedTimer = setTimeout(() => {
    embedTimer = null;
    runEmbeddings(false)
      .then(r => {
        if (r.jobsEmbedded > 0) { console.log(`[auto-embed] ${r.jobsEmbedded} jobs embedded`); send('notify'); }
      })
      .catch(err => console.error('[auto-embed] failed (LLM down is fine):', err?.message ?? err));
  }, 20_000);
}

// One stale alarm per site per 6h — a broken scraper shouldn't spam.
const staleAlerted = new Map<string, number>();
function scraperStale(site: string, url: string) {
  const last = staleAlerted.get(site) ?? 0;
  if (Date.now() - last < 6 * 3600_000) return;
  staleAlerted.set(site, Date.now());
  try { addNotification('scraper-stale', { site, url }); } catch { /* */ }
  notify(`${site} scraper found 0 jobs on a results page — selectors may be stale.`);
  send('notify');
}

// Indeed→ATS bridge: after harvests settle, probe the new companies for public
// Greenhouse/Lever/Ashby boards and add hits as durable API feeds. Debounced
// behind the embed timer window; a few companies per pass keeps it polite.
let atsTimer: NodeJS.Timeout | null = null;
function scheduleAtsDiscovery() {
  if (atsTimer) clearTimeout(atsTimer);
  atsTimer = setTimeout(() => {
    atsTimer = null;
    discoverBoardsFromJobs(5)
      .then(found => {
        if (!found.length) return;
        try { addNotification('boards', { added: found.length, names: found.map(f => f.company) }); } catch { /* */ }
        notify(`Found ${found.length} direct company board${found.length === 1 ? '' : 's'}: ${found.map(f => f.company).join(', ')} — future scans cover them automatically.`, 'boards');
        send('notify');
      })
      .catch(err => console.error('[ats-discover] failed:', err?.message ?? err));
  }, 30_000);
}

function startIngressServer() {
  ensureHubToken();
  const port = Number(readSettings().hubPort) || 17893;
  hubServer = startHubServer(() => ({
    token: readSettings().hubToken,
    ingestJobs: (jobs: any[]) => {
      const r = ingestJobs(jobs);
      if (r.added > 0 || r.updated > 0) { send('notify'); scheduleAutoEmbed(); scheduleAtsDiscovery(); }
      return r;
    },
    ingestFields,
    scraperStale,
    status: () => ({ jobs: (getDb().prepare('SELECT COUNT(*) n FROM jobs').get() as { n: number }).n }),
    appVersion: app.getVersion(),
    oauthCallback: async (code: string) => {
      const msg = await handleOAuthCode(code);
      send('notify');
      return msg;
    },
  }), port);
  // A port collision means the extension silently can't pair — tell the user
  // instead of burying it in the console.
  hubServer.on('error', (err: any) => {
    if (err?.code === 'EADDRINUSE') {
      try { addNotification('hub', { error: `Port ${port} is already in use — extension pairing is offline.` }); } catch { /* */ }
      notify(`Extension hub couldn't start: port ${port} is in use. Close the other program or change the hub port in Settings.`, 'settings');
      send('notify');
    }
  });
}

function registerAppHandlers() {
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:hubInfo', () => {
    const s = readSettings();
    return { port: s.hubPort, token: s.hubToken, url: `http://127.0.0.1:${s.hubPort}` };
  });
  ipcMain.handle('app:quit', () => { quitting = true; app.quit(); });
  ipcMain.handle('app:show', () => showWindow());
  ipcMain.handle('app:openPath', (_e, p: string) => shell.openPath(p));
  // Job URLs come from scraped/external sources — never hand file:/javascript:/
  // custom-protocol strings to the OS shell.
  ipcMain.handle('app:openExternal', (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;
    return shell.openExternal(url);
  });
  ipcMain.handle('app:setCloseToTray', (_e, v: boolean) => { closeToTray = !!v; return closeToTray; });
  ipcMain.handle('app:rearmScheduler', () => { armScheduler(); return true; });
  // Invalidates the old extension pairing immediately; re-pair via the popup.
  ipcMain.handle('app:rotateHubToken', () => {
    const token = randomUUID();
    writeSetting('hubToken', token);
    return token;
  });
  ipcMain.handle('app:pickPath', async (_e, opts: Electron.OpenDialogOptions = {}) => {
    const r = await dialog.showOpenDialog(mainWindow ?? undefined as any, opts);
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle('update:check', () => checkForUpdates());
  ipcMain.handle('update:silence', (_e, mode: 'until-next' | 'forever' | 'clear') => silenceUpdates(mode));
}

// Crash safety net: log instead of dying silently. Boot failures get a visible
// error box (otherwise a throw before createWindow leaves a headless zombie).
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));

app.whenReady().then(async () => {
  // Default File/Edit menu bar clashes with the dark UI; keep it in dev for the
  // reload/devtools accelerators.
  if (!isDev) Menu.setApplicationMenu(null);
  initDb();
  migrateSecrets();
  seedBoardsIfEmpty();
  closeToTray = !!readSettings().closeToTray;
  registerSettingsHandlers();
  registerLlmHandlers();
  registerJobHandlers();
  registerBoardHandlers();
  registerScanHandlers();
  registerExperienceHandlers();
  registerDiscoveryHandlers();
  registerGeoHandlers();
  registerRuleHandlers();
  registerApplyHandlers();
  registerAgentHandlers();
  registerSelfExtHandlers();
  registerBlocklistHandlers();
  registerPipelineHandlers();
  registerNotificationHandlers();
  registerGmailHandlers();
  registerIntelHandlers();
  registerFollowupHandlers();
  registerMaintenanceHandlers();
  registerDigestHandlers();
  registerActivityHandlers();
  registerSearchHandlers();
  registerExportHandlers();
  registerWatchHandlers();
  registerAppHandlers();
  try { const p = runPrune(); if (p.jobsDeleted || p.notificationsDeleted) console.log(`[prune] boot: -${p.jobsDeleted} jobs, -${p.notificationsDeleted} notifs`); } catch { /* */ }
  // Daily rotating DB backup — the whole job search lives in one SQLite file.
  runBackup().then(b => {
    if (b.ok && !b.skipped) console.log(`[backup] ${b.path}`);
    else if (!b.ok) console.error('[backup] failed:', b.error);
  }).catch(err => console.error('[backup] failed:', err?.message ?? err));
  // Close-to-tray keeps the process alive for weeks, so boot-only backups go
  // stale — re-check every 6h (runBackup skips if today's file exists).
  backupTimer = setInterval(() => {
    runBackup().catch(err => console.error('[backup] failed:', err?.message ?? err));
  }, 6 * 60 * 60 * 1000);
  // Collapse any aggregator/ATS duplicate pairs that accumulated while off.
  try { collapseAggregatorDupes(); } catch (e: any) { console.error('[dedupe] boot:', e?.message ?? e); }
  startIngressServer();
  createWindow();
  buildTray();
  armScheduler();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((err) => {
  console.error('[boot] fatal:', err);
  try { dialog.showErrorBox('Job Finder failed to start', String(err?.stack ?? err)); } catch { /* */ }
  app.exit(1);
});

// Graceful teardown on every real quit path.
app.on('before-quit', () => { quitting = true; shutdown(); });
process.on('exit', () => shutdown());
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => forceQuit());

app.on('window-all-closed', () => {
  // With close-to-tray we keep running (window hidden, tray alive); only quit
  // when the user explicitly chose to.
  if (process.platform !== 'darwin' && quitting) app.quit();
});
