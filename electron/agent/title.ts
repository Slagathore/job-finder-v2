/**
 * Pure conversation-title helper. Titles come from the first user message,
 * never from an extra LLM call — a title is not worth a round trip.
 * No electron/db imports so vitest can load this directly.
 */

const FALLBACK = 'Untitled conversation';

/** Strip code fences, markdown noise and runs of whitespace out of a message. */
function flatten(message: string): string {
  return String(message ?? '')
    .replace(/```[\s\S]*?```/g, ' ')       // fenced blocks carry no title value
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*[#>*\-+]+\s*/gm, '')     // heading / quote / bullet markers
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Turn the first user message into a short, readable conversation title.
 * Trims on a word boundary when it can, and adds an ellipsis only when the
 * text was actually cut.
 */
export function titleFromMessage(message: string, max = 48): string {
  const flat = flatten(message);
  if (!flat) return FALLBACK;
  if (flat.length <= max) return flat;

  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const body = (lastSpace >= Math.floor(max * 0.5) ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?-]+$/, '');
  return `${body || cut.trim()}...`;
}
