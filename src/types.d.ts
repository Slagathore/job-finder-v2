export interface LlmMessage { role: 'system' | 'user' | 'assistant'; content: string; }

export interface ScanSummary {
  scanned: number;
  found: number;
  filteredTitle: number;
  duplicates: number;
  added: number;
  errors: { company: string; error: string }[];
  added_jobs: { company: string; title: string; location: string; source: string }[];
}

export interface ProjectRepo {
  id: number;
  full_name: string;
  private: number;
  description: string | null;
  language: string | null;
  pushed_at: string | null;
  html_url: string | null;
  default_branch: string | null;
  state: 'pending' | 'running' | 'done' | 'error';
  depth: 'medium' | 'deep' | null;
  items: number;
  digested_at: number | null;
  last_error: string | null;
  updated_at: number;
}

// ── Portfolio review (what the ingested projects prove) ─────────────────
export interface PortfolioProject {
  project: string;
  source: string | null;
  proves: string;
  roles: string[];
  industries: string[];
  resume_line: string;
  weaknesses: string[];
  strength: string;
}
export interface PortfolioTheme { theme: string; evidence: string[]; sells_to: string[]; }
export interface PortfolioGap { gap: string; why: string; first_step: string; }
export interface PortfolioReview {
  summary: string;
  projects: PortfolioProject[];
  themes: PortfolioTheme[];
  gap: PortfolioGap | null;
}
export interface PortfolioResult {
  review: PortfolioReview;
  itemCount: number;
  projectCount: number;
  cachedAt: number;
  fromCache: boolean;
}
export interface PortfolioEmpty { empty: true; message: string; reason: 'no-projects' | 'no-review'; }

// ── Career direction deep dive ──────────────────────────────────────────
export interface IntakeQuestion {
  id: string;
  label: string;
  help?: string;
  type: 'number' | 'text' | 'single' | 'multi';
  options?: string[];
  required?: boolean;
  placeholder?: string;
}
export type IntakeAnswers = Record<string, string | number | string[]>;
export interface IntakeState {
  questions: IntakeQuestion[];
  answers: IntakeAnswers;
  missing: string[];
  missingLabels: string[];
  updatedAt: number | null;
}
export interface Direction {
  title: string;
  kind: 'core' | 'adjacency';
  fit: number;
  why: string;
  evidence: string[];
  gaps: string[];
  pay: string;
  demand: string;
  next_step: string;
  titles: string[];
  industries: string[];
  role_fits: { role_family: string; industry: string | null; confidence: number; rationale: string }[];
}
export interface DirectionReport {
  summary: string;
  directions: Direction[];
  honest_note: string;
  adjacency_note: string;
}
export interface StoredDirection { report: DirectionReport; itemCount: number; createdAt: number; }
export interface SearchWritePlan {
  direction: string;
  name: string;
  params: Record<string, any>;
  existingNames: string[];
}
export interface FitWritePlan {
  direction: string;
  additions: { role_family: string; industry: string | null; confidence: number; rationale: string }[];
  alreadyPresent: string[];
}

/** Progress of the automatic LLM fit-grading pass over the top search hits. */
export interface GradeProgress {
  running: boolean;
  done: number;
  total: number;
  jobId?: number;
  grade?: string;
  rationale?: string;
  note?: string;
}

export interface ProjectProgress {
  running: boolean;
  phase: string;
  current: string;
  done: number;
  total: number;
  percent: number;
}

export interface Api {
  settings: {
    get: () => Promise<Record<string, any>>;
    set: (patch: Record<string, any>) => Promise<Record<string, any>>;
  };
  llm: {
    health: () => Promise<{
      ollamaUp: boolean; baseUrl: string; primaryModel: string;
      primaryModelPresent: boolean | null; anthropicConfigured: boolean; detail: string;
    }>;
    generate: (messages: LlmMessage[], opts?: { temperature?: number; maxTokens?: number; model?: string }) =>
      Promise<{ text: string; provider: string; model: string; usedFallback: boolean; errors: any[] } | { error: string }>;
    embed: (texts: string[]) => Promise<{ vectors: number[][] } | { error: string }>;
  };
  jobs: {
    list: (q?: { status?: string; limit?: number }) => Promise<any[]>;
    counts: () => Promise<{ total: number; byStatus: { status: string; n: number }[] }>;
    setStar: (id: number, starred: boolean) => Promise<{ ok: boolean }>;
  };
  geo: {
    resolve: (query: string) => Promise<{ lat: number; lng: number; label: string; source: string } | { error: string }>;
    geocodeJobs: (limit?: number) => Promise<{ resolved: number; failed: number; remaining: number } | { error: string }>;
  };
  discovery: {
    embed: (force?: boolean) => Promise<{ jobsEmbedded: number; itemsEmbedded: number } | { error: string }>;
    search: (params: {
      tags?: string; roleFamily?: string; workModes?: string[]; payMin?: number;
      keyword?: string; excludeKeyword?: string; sort?: 'fit' | 'pay' | 'date' | 'distance'; limit?: number;
      location?: { lat: number; lng: number } | null; radiusMi?: number;
    }) => Promise<{ results: any[]; total: number; embeddedCoverage: { jobs: number; jobsTotal: number; items: number }; usedQueryVector: boolean } | { error: string }>;
    discover: (limit?: number) => Promise<{ results: any[]; note?: string } | { error: string }>;
    grade: (jobId: number) => Promise<{ grade: string; rationale: string } | { error: string }>;
    gradeTop: (jobIds: number[], force?: boolean) => Promise<{ graded: number; note?: string } | { error: string }>;
    onGradeProgress: (cb: (p: GradeProgress) => void) => () => void;
  };
  boards: {
    list: () => Promise<any[]>;
    add: (b: { name: string; url: string }) => Promise<{ ok: boolean; detected: string | null }>;
    setEnabled: (id: number, enabled: boolean) => Promise<{ ok: boolean }>;
    delete: (id: number) => Promise<{ ok: boolean }>;
    reseed: () => Promise<{ c: number }>;
    probe: (url: string, id?: number) => Promise<{ ingress: string; method: string; count: number; sample: any[]; jsRendered?: boolean; note?: string } | { error: string }>;
    learn: (url: string, id?: number) => Promise<{ adapter: any; sample: any[]; count: number } | { error: string }>;
  };
  scan: {
    run: (trigger?: string) => Promise<ScanSummary | { error: string }>;
    busy: () => Promise<{ scanning: boolean }>;
  };
  experience: {
    importText: (text: string, sourceRef?: string) => Promise<{ added: number; merged: number; items: number } | { error: string }>;
    importFile: (filePath: string) => Promise<{ added: number; merged: number; items: number; source: string } | { error: string }>;
    list: () => Promise<any[]>;
    delete: (id: number) => Promise<{ ok: boolean }>;
    clear: () => Promise<{ ok: boolean }>;
    infer: () => Promise<{ profile: any; roleFits: any[] } | { error: string }>;
    getProfile: () => Promise<{ profile: any | null; roleFits: any[] }>;
    suggestQuestions: () => Promise<{ questions: string[] } | { error: string }>;
    roast: () => Promise<{ text: string } | { error: string }>;
  };
  projects: {
    status: () => Promise<{
      ghInstalled: boolean; ghVersion: string; ghAuthenticated: boolean; login: string;
      scopes: string[]; missingScopes: string[]; ghDetail: string;
      tokenSaved: boolean; source: 'gh' | 'token' | 'none'; connected: boolean; running: boolean;
      counts: { total: number; done: number; error: number; pending: number };
    }>;
    list: () => Promise<ProjectRepo[]>;
    installGh: () => Promise<{ ok: boolean; message: string }>;
    saveToken: (token: string) => Promise<{ ok: true; login: string } | { error: string }>;
    clearToken: () => Promise<{ ok: boolean }>;
    refresh: () => Promise<{ total: number; privateCount: number; added: number; updated: number; source: string } | { error: string }>;
    scan: (depth?: 'medium' | 'deep') => Promise<{ started: true; depth: string } | { error: string }>;
    deepDive: (fullName: string) => Promise<{ items: number; added: number; merged: number } | { error: string }>;
    digestFolder: (folder: string) => Promise<{ items: number; added: number; merged: number; source: string } | { error: string }>;
    digestUrl: (url: string) => Promise<{ items: number; added: number; merged: number } | { error: string }>;
    onProgress: (cb: (p: ProjectProgress) => void) => () => void;
  };
  rules: {
    list: () => Promise<any[]>;
    add: (scope: string, text: string) => Promise<{ ok: boolean } | { error: string }>;
    delete: (id: number) => Promise<{ ok: boolean }>;
  };
  apply: {
    tailor: (jobId: number) => Promise<{ ok: boolean; summary: string; bullets: number; cv: string; cover: string; pdf: boolean; pdfError: string | null } | { error: string }>;
    get: (jobId: number) => Promise<any | null>;
    prepareBatch: (jobIds: number[]) => Promise<{ items: any[] }>;
    submit: (jobId: number) => Promise<{ ok: boolean; url?: string; reason?: string }>;
    apply: (jobId: number) => Promise<{ ok: boolean; reason?: string; filled?: number; skipped?: number; fileUploaded?: boolean; submitted?: boolean; assessment?: boolean; error?: string }>;
    applyBatch: (jobIds: number[]) => Promise<{ results: { jobId: number; ok: boolean; reason?: string; filled?: number; skipped?: number; fileUploaded?: boolean; submitted?: boolean; assessment?: boolean }[] }>;
    prep: (jobId: number) => Promise<{ prep: { questions: string[]; stories: { q: string; a: string }[]; askThem: string[] }; path: string } | { error: string }>;
  };
  followups: {
    list: () => Promise<{ appId: number; jobId: number; company: string; title: string; url?: string; state: string; daysSince: number; due: boolean; action: string }[]>;
  };
  maintenance: {
    stats: () => Promise<{ jobs: number; applications: number; starred: number; notifications: number; prunable: number }>;
    prune: () => Promise<{ jobsDeleted: number; notificationsDeleted: number; skipped?: string }>;
  };
  digest: {
    get: () => Promise<{ newToday: number; jobsTotal: number; surfaced: number; starred: number; followupsDue: number; unseenNotifs: number; interviewsOffers: number; byState: Record<string, number> }>;
    today: () => Promise<{
      followups: { appId: number; jobId: number; company: string; title: string; url?: string; state: string; daysSince: number; action: string }[];
      freshFits: { id: number; company: string; title: string; url: string; fit_score: string | null; work_mode: string | null }[];
      staleApps: { appId: number; jobId: number; company: string; title: string; url: string; daysSince: number }[];
    }>;
  };
  activity: { heatmap: (weeks?: number) => Promise<{ grid: { date: string; count: number }[]; streak: number; total: number }> };
  searches: {
    save: (name: string, params: any) => Promise<{ ok: boolean } | { error: string }>;
    list: () => Promise<{ id: number; name: string; params: any; created_at: number }[]>;
    delete: (id: number) => Promise<{ ok: boolean }>;
    log: (params: any) => Promise<{ ok: boolean }>;
    history: () => Promise<{ id: number; params: any; ts: number }[]>;
  };
  exportData: { pipeline: () => Promise<{ csv: string; html: string; rows: number }> };
  watch: {
    list: () => Promise<{ id: number; normalized_name: string; label: string }[]>;
    add: (name: string) => Promise<{ ok: boolean } | { error: string }>;
    remove: (id: number) => Promise<{ ok: boolean }>;
  };
  blocklist: {
    list: () => Promise<any[]>;
    add: (name: string, reason?: string) => Promise<{ ok: boolean } | { error: string }>;
    remove: (id: number) => Promise<{ ok: boolean }>;
  };
  pipeline: {
    board: () => Promise<{ columns: Record<string, any[]>; counts: Record<string, number>; order: string[] }>;
    move: (jobId: number, state: string) => Promise<{ ok: boolean }>;
  };
  gmail: {
    authUrl: () => Promise<{ url: string } | { error: string }>;
    status: () => Promise<{ connected: boolean; email: string }>;
    ingest: () => Promise<{ processed: number; matched: number; advanced: number; error?: string }>;
    disconnect: () => Promise<{ ok: boolean }>;
  };
  intel: {
    salary: (jobId: number) => Promise<{ min: number | null; max: number | null; currency: string; confidence: string; note: string; source: string; soc?: string | null; blsMedian?: number; blsYear?: string } | { error: string }>;
    company: (company: string, force?: boolean) => Promise<any | { error: string }>;
    moves: () => Promise<{ moves: any[] } | { error: string }>;
    certs: (field: string, force?: boolean) => Promise<{ certs: any[] } | { error: string }>;
    portfolio: () => Promise<PortfolioResult | PortfolioEmpty>;
    portfolioRun: (force?: boolean) => Promise<PortfolioResult | PortfolioEmpty | { error: string }>;
  };
  notifications: {
    list: () => Promise<any[]>;
    unseen: () => Promise<number>;
    markSeen: (id: number) => Promise<{ ok: boolean }>;
    markAllSeen: () => Promise<{ ok: boolean }>;
    onNotify: (cb: () => void) => () => void;
  };
  agent: {
    plan: (p: { message: string; conversationId?: number | null; mode?: string }) =>
      Promise<{ intent: 'valid' | 'explanation' | 'malformed'; plan?: { summary: string; steps: any[] }; explanation?: string; error?: string; conversationId: number; messageId: number }>;
    run: (steps: any[], messageId?: number | null) => Promise<{ results: { tool: string; ok: boolean; summary: string; error?: string; data?: any; openTab?: string; needsConfirm?: boolean; args?: any }[] }>;
    runStep: (step: any, messageId?: number | null, index?: number) => Promise<{ tool: string; ok: boolean; summary: string; error?: string; data?: any; openTab?: string; needsConfirm?: boolean; args?: any }>;
    permissions: () => Promise<{ capability: string; mode: string }[]>;
    setPermission: (capability: string, mode: string) => Promise<{ capability: string; mode: string }[]>;
    memory: () => Promise<any[]>;
    conversations: () => Promise<{ id: number; title: string; mode: string; created_at: number; updated_at: number; message_count: number }[]>;
    conversation: (id: number) => Promise<{ id: number; title: string; mode: string; messages: { id: number; role: 'user' | 'assistant'; content: string; plan?: any; results?: any[]; created_at: number }[] } | null>;
    deleteConversation: (id: number) => Promise<{ id: number; title: string; mode: string; created_at: number; updated_at: number; message_count: number }[]>;
  };
  selfext: {
    propose: (instruction: string) => Promise<{ id: number; patch: any; scan: any } | { error: string }>;
    sandbox: (id: number) => Promise<{ ok: boolean; stage: string; output: string; durationMs: number } | { error: string }>;
    list: () => Promise<any[]>;
    get: (id: number) => Promise<any | null>;
    approve: (id: number) => Promise<{ ok: boolean; changed?: string[]; error?: string }>;
    reject: (id: number) => Promise<{ ok: boolean }>;
    rollback: (id: number) => Promise<{ ok: boolean; error?: string }>;
  };
  career: {
    insights: () => Promise<{
      applied: number; responded: number; interviews: number; offers: number; rejected: number; pending: number;
      byFit: any[]; byWorkMode: any[]; bySource: any[]; notes: string[];
    }>;
    doctor: () => Promise<{ name: string; ok: boolean; detail: string }[]>;
    project: (idea: string) => Promise<{ eval: any } | { error: string }>;
    training: (course: string) => Promise<{ eval: any } | { error: string }>;
    deep: (company: string, role: string) => Promise<{ prompt: string } | { error: string }>;
    intakeGet: () => Promise<IntakeState>;
    intakeSave: (answers: IntakeAnswers) => Promise<IntakeState>;
    directionGet: () => Promise<StoredDirection | null>;
    direction: (force?: boolean) => Promise<StoredDirection | { error: string }>;
    directionPlan: (index: number, kind: 'searches' | 'fits') =>
      Promise<SearchWritePlan | FitWritePlan | { error: string }>;
    directionApply: (index: number, kind: 'searches' | 'fits') =>
      Promise<{ created: { id: number; name: string }[] } | { added: { id: number; role_family: string }[] } | { error: string }>;
    directionUndo: (p: { searchIds?: number[]; fitIds?: number[] }) =>
      Promise<{ searchesRemoved: number; fitsRemoved: number }>;
  };
  stories: {
    list: () => Promise<any[]>;
    add: (prompt: string, story: string, tags?: string) => Promise<any | { error: string }>;
    delete: (id: number) => Promise<boolean>;
  };
  contacts: {
    list: (company?: string) => Promise<any[]>;
    add: (c: any) => Promise<any | { error: string }>;
    delete: (id: number) => Promise<boolean>;
    discover: (company: string, role?: string) => Promise<{
      added: any[]; found: number;
      diagnosis: 'ok' | 'consent' | 'captcha' | 'no-results' | 'network-error';
      usedQuery: 'strict' | 'broad' | null;
      message: string;
    } | { error: string }>;
    outreach: (contactId: number, jobId?: number) => Promise<{ message: string; alternate: string } | { error: string }>;
  };
  update: {
    check: () => Promise<{
      available: boolean; latestVersion: string; summary: string;
      emergency: boolean; emergencyMessage: string; repoUrl: string;
      canInstall: boolean; installBlockedReason: string;
    } | null>;
    silence: (mode: 'until-next' | 'forever' | 'clear') => Promise<boolean>;
    install: () => Promise<{
      ok: boolean;
      stage: 'unsupported' | 'busy' | 'check' | 'download' | 'installing';
      error?: string; version?: string;
    }>;
    onProgress: (cb: (p: { percent: number; transferred: number; total: number; bytesPerSecond: number }) => void) => () => void;
    onError: (cb: (message: string) => void) => () => void;
  };
  app: {
    version: () => Promise<string>;
    capabilities: () => Promise<{ selfExtend: boolean; selfExtendReason: string }>;
    hubInfo: () => Promise<{ port: number; token: string; url: string }>;
    openPath: (p: string) => Promise<string>;
    openExternal: (url: string) => Promise<string>;
    quit: () => Promise<void>;
    show: () => Promise<void>;
    setCloseToTray: (v: boolean) => Promise<boolean>;
    rearmScheduler: () => Promise<boolean>;
    rotateHubToken: () => Promise<string>;
    pickPath: (opts?: any) => Promise<string | null>;
    onOpenTab: (cb: (tab: string) => void) => () => void;
  };
}

declare global {
  interface Window { api: Api; }
}
