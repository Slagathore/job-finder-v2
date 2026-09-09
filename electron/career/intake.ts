/**
 * Career direction preference intake (pure, no db or electron imports).
 *
 * The direction feature cannot tell someone what to do for work without first
 * asking the things no resume contains: what pay is acceptable, whether he will
 * relocate, whether he wants to manage people, what he refuses to work on. The
 * list is deliberately short so it gets finished in one sitting, and the answers
 * are persisted so it never asks twice.
 */

export type IntakeFieldType = 'number' | 'text' | 'single' | 'multi';

export interface IntakeQuestion {
  id: string;
  label: string;
  help?: string;
  type: IntakeFieldType;
  options?: string[];
  required?: boolean;
  placeholder?: string;
}

export type IntakeAnswers = Record<string, string | number | string[]>;

export const INTAKE_QUESTIONS: IntakeQuestion[] = [
  { id: 'pay_floor', type: 'number', required: true, placeholder: '65000',
    label: 'Lowest yearly pay you would actually accept',
    help: 'Total pay, in dollars per year. Be honest, this sets the floor on every search made from your direction report.' },
  { id: 'pay_target', type: 'number', placeholder: '95000',
    label: 'Pay you are aiming for',
    help: 'What good looks like a year or two from now.' },
  { id: 'work_mode', type: 'multi', required: true, options: ['onsite', 'hybrid', 'remote'],
    label: 'Work modes you will take' },
  { id: 'location', type: 'text', placeholder: 'Dallas Fort Worth',
    label: 'Where you want to work',
    help: 'City or metro. Leave blank if you only want remote.' },
  { id: 'relocate', type: 'single', required: true, options: ['no', 'for the right job', 'yes, anywhere'],
    label: 'Would you relocate' },
  { id: 'customer_facing', type: 'single', options: ['prefer it', 'fine either way', 'avoid it'],
    label: 'Customer facing work' },
  { id: 'work_style', type: 'single', options: ['mostly solo', 'small team', 'big team', 'no preference'],
    label: 'Solo or team' },
  { id: 'manage_people', type: 'single', required: true, options: ['want to', 'open to it', 'no'],
    label: 'Do you want to manage people' },
  { id: 'industries_want', type: 'text', placeholder: 'games, healthcare, logistics',
    label: 'Industries you want',
    help: 'Comma separated. Leave blank if you are open.' },
  { id: 'industries_avoid', type: 'text', placeholder: 'door to door sales, insurance',
    label: 'Industries you refuse',
    help: 'Comma separated. These get excluded from every recommendation.' },
  { id: 'schedule', type: 'text', placeholder: 'no overnight shifts, school runs at 3pm',
    label: 'Schedule constraints' },
  { id: 'retraining', type: 'single', required: true,
    options: ['none, I need work now', 'a few weeks', 'a few months', 'a year or more'],
    label: 'How much retraining are you willing to do' },
];

const BY_ID = new Map(INTAKE_QUESTIONS.map(q => [q.id, q]));

function toNumber(v: any): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.round(v);
  if (typeof v !== 'string') return undefined;
  const n = Number(v.replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
}

/**
 * Coerce whatever the renderer sent into the shape the prompt builder expects.
 * Unknown keys and values outside a question's options are dropped rather than
 * stored, so a stale UI can never poison the saved answers.
 */
export function normalizeIntake(raw: any): IntakeAnswers {
  const out: IntakeAnswers = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const q of INTAKE_QUESTIONS) {
    const v = (raw as any)[q.id];
    if (v === undefined || v === null) continue;
    if (q.type === 'number') {
      const n = toNumber(v);
      if (n !== undefined) out[q.id] = n;
    } else if (q.type === 'multi') {
      const list = (Array.isArray(v) ? v : [v])
        .filter((x: any) => typeof x === 'string')
        .map((x: string) => x.trim())
        .filter((x: string) => (q.options ?? []).includes(x));
      if (list.length) out[q.id] = Array.from(new Set(list));
    } else if (q.type === 'single') {
      if (typeof v === 'string' && (q.options ?? []).includes(v.trim())) out[q.id] = v.trim();
    } else {
      if (typeof v === 'string' && v.trim()) out[q.id] = v.trim();
    }
  }
  return out;
}

/** Ids of the required questions still unanswered. */
export function missingRequired(answers: IntakeAnswers): string[] {
  return INTAKE_QUESTIONS.filter(q => q.required && answers[q.id] === undefined).map(q => q.id);
}

export function intakeComplete(answers: IntakeAnswers): boolean {
  return missingRequired(answers).length === 0;
}

/** Labels for the missing ids, for a message a person can act on. */
export function missingLabels(ids: string[]): string[] {
  return ids.map(id => BY_ID.get(id)?.label ?? id);
}

export function splitList(v: any): string[] {
  if (Array.isArray(v)) return v.map(String).map(s => s.trim()).filter(Boolean);
  if (typeof v !== 'string') return [];
  return v.split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

/** The intake rendered as plain lines for the synthesis prompt. */
export function describeIntake(answers: IntakeAnswers): string {
  return INTAKE_QUESTIONS.map(q => {
    const v = answers[q.id];
    const text = v === undefined ? 'not answered'
      : Array.isArray(v) ? v.join(', ')
      : q.type === 'number' ? `$${Number(v).toLocaleString('en-US')}`
      : String(v);
    return `- ${q.label}: ${text}`;
  }).join('\n');
}
