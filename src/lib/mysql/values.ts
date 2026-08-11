export function idString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint' || typeof value === 'number') return String(value);
  throw new TypeError(`Expected a database ID, received ${typeof value}.`);
}

export function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function booleanValue(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

export function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

export function dateOnly(value: unknown): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? '';
}

export function isoDateTime(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();

  const text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.endsWith('Z') ? text : `${text}Z`;
  if (/^\d{4}-\d{2}-\d{2} /.test(text)) return `${text.replace(' ', 'T')}Z`;

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function displayStatus(value: unknown): string {
  return String(value).toLowerCase() === 'completed' ? 'Completed' : 'In Progress';
}

export function databaseStatus(value: unknown): 'completed' | 'in_progress' {
  return String(value).trim().toLowerCase() === 'completed' ? 'completed' : 'in_progress';
}

export function normalizeReviewerLookup(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

