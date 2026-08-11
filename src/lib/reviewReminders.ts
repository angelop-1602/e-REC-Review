export type ReminderFrequency = 'daily' | 'weekly' | 'twice-weekly';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function parseDateOnly(value: string): number | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, rawYear, rawMonth, rawDay] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return timestamp;
}

export function getDateInTimeZone(date: Date, timeZone = 'Asia/Manila'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${values.year}-${values.month}-${values.day}`;
}

export function getDaysUntilDueDate(dueDate: string, currentDate: string): number | null {
  const dueTimestamp = parseDateOnly(dueDate);
  const currentTimestamp = parseDateOnly(currentDate);

  if (dueTimestamp === null || currentTimestamp === null) {
    return null;
  }

  return Math.round((dueTimestamp - currentTimestamp) / MILLISECONDS_PER_DAY);
}

export function isIncompleteReview(status: unknown): boolean {
  return typeof status !== 'string' || status.trim().toLowerCase() !== 'completed';
}

export function isDueForReminder(
  dueDate: string,
  currentDate: string,
  dueSoonThreshold: number
): boolean {
  const daysUntilDue = getDaysUntilDueDate(dueDate, currentDate);

  return daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= dueSoonThreshold;
}

export function shouldRunReminderOnDate(frequency: ReminderFrequency, currentDate: string): boolean {
  const timestamp = parseDateOnly(currentDate);

  if (timestamp === null) {
    return false;
  }

  const dayOfWeek = new Date(timestamp).getUTCDay();

  if (frequency === 'weekly') {
    return dayOfWeek === 1;
  }

  if (frequency === 'twice-weekly') {
    return dayOfWeek === 1 || dayOfWeek === 4;
  }

  return true;
}

export function wasReminderRunToday(
  lastRun: unknown,
  currentDate: string,
  timeZone = 'Asia/Manila'
): boolean {
  if (!lastRun) {
    return false;
  }

  let lastRunDate: Date | null = null;

  if (typeof lastRun === 'string') {
    const parsed = new Date(lastRun);
    lastRunDate = Number.isNaN(parsed.getTime()) ? null : parsed;
  } else if (typeof lastRun === 'object' && 'toDate' in lastRun) {
    try {
      lastRunDate = (lastRun as { toDate: () => Date }).toDate();
    } catch {
      lastRunDate = null;
    }
  }

  return lastRunDate ? getDateInTimeZone(lastRunDate, timeZone) === currentDate : false;
}
