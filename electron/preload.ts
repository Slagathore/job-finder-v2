import { contextBridge, ipcRenderer } from 'electron';

const invoke = (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: () => invoke('settings:get'),
    set: (patch: any) => invoke('settings:set', patch),
  },
  llm: {
    health: () => invoke('llm:health'),
    generate: (messages: any[], opts?: any) => invoke('llm:generate', { messages, opts }),
    embed: (texts: string[]) => invoke('llm:embed', texts),
  },
  jobs: {
    list: (q?: any) => invoke('jobs:list', q ?? {}),
    counts: () => invoke('jobs:counts'),
    setStar: (id: number, starred: boolean) => invoke('jobs:setStar', { id, starred }),
  },
  geo: {
    resolve: (query: string) => invoke('geo:resolve', query),
    geocodeJobs: (limit?: number) => invoke('geo:geocodeJobs', limit),
  },
  discovery: {
    embed: (force?: boolean) => invoke('discovery:embed', force),
    search: (params: any) => invoke('discovery:search', params),
    discover: (limit?: number) => invoke('discovery:discover', limit),
    grade: (jobId: number) => invoke('discovery:grade', jobId),
  },
  boards: {
    list: () => invoke('boards:list'),
    add: (b: { name: string; url: string }) => invoke('boards:add', b),
    setEnabled: (id: number, enabled: boolean) => invoke('boards:setEnabled', { id, enabled }),
    delete: (id: number) => invoke('boards:delete', id),
    reseed: () => invoke('boards:reseed'),
    probe: (url: string, id?: number) => invoke('boards:probe', { url, id }),
    learn: (url: string, id?: number) => invoke('boards:learn', { url, id }),
  },
  scan: {
    run: (trigger?: string) => invoke('scan:run', trigger ?? 'manual'),
    busy: () => invoke('scan:busy'),
  },
  experience: {
    importText: (text: string, sourceRef?: string) => invoke('experience:importText', { text, sourceRef }),
    importFile: (filePath: string) => invoke('experience:importFile', filePath),
    list: () => invoke('experience:list'),
    delete: (id: number) => invoke('experience:delete', id),
    clear: () => invoke('experience:clear'),
    infer: () => invoke('experience:infer'),
    getProfile: () => invoke('experience:getProfile'),
    suggestQuestions: () => invoke('experience:suggestQuestions'),
    roast: () => invoke('experience:roast'),
  },
  rules: {
    list: () => invoke('rules:list'),
    add: (scope: string, text: string) => invoke('rules:add', { scope, text }),
    delete: (id: number) => invoke('rules:delete', id),
  },
  apply: {
    tailor: (jobId: number) => invoke('apply:tailor', jobId),
    get: (jobId: number) => invoke('apply:get', jobId),
    prepareBatch: (jobIds: number[]) => invoke('apply:prepareBatch', jobIds),
    submit: (jobId: number) => invoke('apply:submit', jobId),
    apply: (jobId: number) => invoke('apply:apply', jobId),
    applyBatch: (jobIds: number[]) => invoke('apply:applyBatch', jobIds),
    prep: (jobId: number) => invoke('apply:prep', jobId),
  },
  followups: {
    list: () => invoke('followups:list'),
  },
  maintenance: {
    stats: () => invoke('maintenance:stats'),
    prune: () => invoke('maintenance:prune'),
  },
  digest: {
    get: () => invoke('digest:get'),
    today: () => invoke('digest:today'),
  },
  activity: { heatmap: (weeks?: number) => invoke('activity:heatmap', weeks) },
  searches: {
    save: (name: string, params: any) => invoke('searches:save', { name, params }),
    list: () => invoke('searches:list'),
    delete: (id: number) => invoke('searches:delete', id),
    log: (params: any) => invoke('searches:log', params),
    history: () => invoke('searches:history'),
  },
  exportData: { pipeline: () => invoke('export:pipeline') },
  watch: {
    list: () => invoke('watch:list'),
    add: (name: string) => invoke('watch:add', { name }),
    remove: (id: number) => invoke('watch:remove', id),
  },
  blocklist: {
    list: () => invoke('blocklist:list'),
    add: (name: string, reason?: string) => invoke('blocklist:add', { name, reason }),
    remove: (id: number) => invoke('blocklist:remove', id),
  },
  pipeline: {
    board: () => invoke('pipeline:board'),
    move: (jobId: number, state: string) => invoke('pipeline:move', { jobId, state }),
  },
  gmail: {
    authUrl: () => invoke('gmail:authUrl'),
    status: () => invoke('gmail:status'),
    ingest: () => invoke('gmail:ingest'),
    disconnect: () => invoke('gmail:disconnect'),
  },
  intel: {
    salary: (jobId: number) => invoke('intel:salary', jobId),
    company: (company: string, force?: boolean) => invoke('intel:company', { company, force }),
    moves: () => invoke('intel:moves'),
    certs: (field: string, force?: boolean) => invoke('intel:certs', { field, force }),
  },
  notifications: {
    list: () => invoke('notifications:list'),
    unseen: () => invoke('notifications:unseen'),
    markSeen: (id: number) => invoke('notifications:markSeen', id),
    markAllSeen: () => invoke('notifications:markAllSeen'),
    onNotify: (cb: () => void) => {
      const l = () => cb();
      ipcRenderer.on('notify', l);
      return () => ipcRenderer.removeListener('notify', l);
    },
  },
  agent: {
    plan: (message: string, history?: any[]) => invoke('agent:plan', { message, history }),
    run: (steps: any[]) => invoke('agent:run', steps),
    runStep: (step: any) => invoke('agent:runStep', step),
    permissions: () => invoke('agent:permissions'),
    setPermission: (capability: string, mode: string) => invoke('agent:setPermission', { capability, mode }),
    memory: () => invoke('agent:memory'),
  },
  selfext: {
    propose: (instruction: string) => invoke('selfext:propose', instruction),
    sandbox: (id: number) => invoke('selfext:sandbox', id),
    list: () => invoke('selfext:list'),
    get: (id: number) => invoke('selfext:get', id),
    approve: (id: number) => invoke('selfext:approve', id),
    reject: (id: number) => invoke('selfext:reject', id),
    rollback: (id: number) => invoke('selfext:rollback', id),
  },
  update: {
    check: () => invoke('update:check'),
    silence: (mode: 'until-next' | 'forever' | 'clear') => invoke('update:silence', mode),
  },
  career: {
    insights: () => invoke('career:insights'),
    doctor: () => invoke('career:doctor'),
    project: (idea: string) => invoke('career:project', idea),
    training: (course: string) => invoke('career:training', course),
    deep: (company: string, role: string) => invoke('career:deep', { company, role }),
  },
  stories: {
    list: () => invoke('stories:list'),
    add: (prompt: string, story: string, tags?: string) => invoke('stories:add', { prompt, story, tags }),
    delete: (id: number) => invoke('stories:delete', id),
  },
  contacts: {
    list: (company?: string) => invoke('contacts:list', company),
    add: (c: any) => invoke('contacts:add', c),
    delete: (id: number) => invoke('contacts:delete', id),
    discover: (company: string, role?: string) => invoke('contacts:discover', { company, role }),
    outreach: (contactId: number, jobId?: number) => invoke('contacts:outreach', { contactId, jobId }),
  },
  app: {
    version: () => invoke('app:version'),
    hubInfo: () => invoke('app:hubInfo'),
    openPath: (p: string) => invoke('app:openPath', p),
    openExternal: (url: string) => invoke('app:openExternal', url),
    quit: () => invoke('app:quit'),
    show: () => invoke('app:show'),
    setCloseToTray: (v: boolean) => invoke('app:setCloseToTray', v),
    rearmScheduler: () => invoke('app:rearmScheduler'),
    rotateHubToken: () => invoke('app:rotateHubToken'),
    pickPath: (opts?: any) => invoke('app:pickPath', opts ?? {}),
    onOpenTab: (cb: (tab: string) => void) => {
      const l = (_e: any, tab: string) => cb(tab);
      ipcRenderer.on('open-tab', l);
      return () => ipcRenderer.removeListener('open-tab', l);
    },
  },
});
