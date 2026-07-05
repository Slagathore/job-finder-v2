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
      keyword?: string; sort?: 'fit' | 'pay' | 'date' | 'distance'; limit?: number;
      location?: { lat: number; lng: number } | null; radiusMi?: number;
    }) => Promise<{ results: any[]; embeddedCoverage: { jobs: number; jobsTotal: number; items: number }; usedQueryVector: boolean } | { error: string }>;
    discover: (limit?: number) => Promise<{ results: any[]; note?: string } | { error: string }>;
    grade: (jobId: number) => Promise<{ grade: string; rationale: string } | { error: string }>;
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
    importText: (text: string, sourceRef?: string) => Promise<{ added: number; items: number } | { error: string }>;
    importFile: (filePath: string) => Promise<{ added: number; items: number; source: string } | { error: string }>;
    list: () => Promise<any[]>;
    delete: (id: number) => Promise<{ ok: boolean }>;
    clear: () => Promise<{ ok: boolean }>;
    infer: () => Promise<{ profile: any; roleFits: any[] } | { error: string }>;
    getProfile: () => Promise<{ profile: any | null; roleFits: any[] }>;
    suggestQuestions: () => Promise<{ questions: string[] } | { error: string }>;
    roast: () => Promise<{ text: string } | { error: string }>;
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
  digest: { get: () => Promise<{ newToday: number; jobsTotal: number; surfaced: number; starred: number; followupsDue: number; unseenNotifs: number; interviewsOffers: number; byState: Record<string, number> }> };
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
    salary: (jobId: number) => Promise<{ min: number | null; max: number | null; currency: string; confidence: string; note: string; source: string } | { error: string }>;
    company: (company: string, force?: boolean) => Promise<any | { error: string }>;
    moves: () => Promise<{ moves: any[] } | { error: string }>;
    certs: (field: string, force?: boolean) => Promise<{ certs: any[] } | { error: string }>;
  };
  notifications: {
    list: () => Promise<any[]>;
    unseen: () => Promise<number>;
    markSeen: (id: number) => Promise<{ ok: boolean }>;
    markAllSeen: () => Promise<{ ok: boolean }>;
    onNotify: (cb: () => void) => () => void;
  };
  agent: {
    plan: (message: string, history?: { role: string; content: string }[]) =>
      Promise<{ intent: 'valid' | 'explanation' | 'malformed'; plan?: { summary: string; steps: any[] }; explanation?: string; error?: string }>;
    run: (steps: any[]) => Promise<{ results: { tool: string; ok: boolean; summary: string; error?: string; data?: any; openTab?: string; needsConfirm?: boolean; args?: any }[] }>;
    runStep: (step: any) => Promise<{ tool: string; ok: boolean; summary: string; error?: string; data?: any; openTab?: string; needsConfirm?: boolean; args?: any }>;
    permissions: () => Promise<{ capability: string; mode: string }[]>;
    setPermission: (capability: string, mode: string) => Promise<{ capability: string; mode: string }[]>;
    memory: () => Promise<any[]>;
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
  app: {
    version: () => Promise<string>;
    hubInfo: () => Promise<{ port: number; token: string; url: string }>;
    openPath: (p: string) => Promise<string>;
    openExternal: (url: string) => Promise<string>;
    quit: () => Promise<void>;
    show: () => Promise<void>;
    setCloseToTray: (v: boolean) => Promise<boolean>;
    rearmScheduler: () => Promise<boolean>;
    pickPath: (opts?: any) => Promise<string | null>;
  };
}

declare global {
  interface Window { api: Api; }
}
