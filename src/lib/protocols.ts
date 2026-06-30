import { isDueSoon, isOverdue } from '@/lib/utils';
import type { Timestamp } from 'firebase/firestore';

export const WEEK_IDS = ['week-1', 'week-2', 'week-3', 'week-4', 'week-5'] as const;

export interface Reviewer {
  id: string;
  name: string;
  status: string;
  document_type?: string;
  form_type?: string;
  due_date?: string;
  completed_at?: Timestamp | null;
}

export interface Protocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  reviewer?: string;
  reviewers?: Reviewer[];
  due_date: string;
  status: string;
  protocol_file: string;
  document_type?: string;
  form_type?: string;
  created_at: string;
  research_title?: string;
  e_link?: string;
  course_program?: string;
  spup_rec_code?: string;
  principal_investigator?: string;
  adviser?: string;
  monthId: string;
  weekId: string;
  _path: string;
}

export interface WeekGroup {
  weekId: string;
  weekLabel: string;
  protocols: Protocol[];
}

export interface MonthGroup {
  monthId: string;
  monthLabel: string;
  protocols: Protocol[];
  weeks: WeekGroup[];
}

type ProtocolSourceData = Record<string, unknown> & Partial<Omit<Protocol, 'id' | 'monthId' | 'weekId' | '_path' | 'due_date'>> & {
  due_date?: unknown;
  reviewers?: Reviewer[];
};

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function ensureValidDueDate(dueDate: unknown): string {
  if (!dueDate) {
    return '';
  }

  if (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return dueDate;
  }

  if (dueDate && typeof dueDate === 'object' && 'toDate' in dueDate) {
    try {
      const date = (dueDate as { toDate: () => Date }).toDate();
      return date.toISOString().split('T')[0];
    } catch {
      return '';
    }
  }

  if (typeof dueDate === 'string' && dueDate.trim()) {
    const date = new Date(dueDate);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }

  return '';
}

export function getProtocolPathParts(path: string): { monthId: string; weekId: string } | null {
  const pathParts = path.split('/');

  if (pathParts.length < 4 || pathParts[0] !== 'protocols') {
    return null;
  }

  return {
    monthId: pathParts[1],
    weekId: pathParts[2],
  };
}

export function formatMonthLabel(monthId: string): string {
  const match = monthId.match(/^([A-Za-z]+)(\d{4})$/);

  if (!match) {
    return monthId;
  }

  const [, rawMonth, year] = match;
  const month = MONTH_NAMES.find((name) => name.toLowerCase() === rawMonth.toLowerCase());

  return month ? `${month} ${year}` : `${rawMonth} ${year}`;
}

export function formatWeekLabel(weekId: string): string {
  const weekNumber = weekId.match(/\d+/)?.[0];

  return weekNumber ? `Week ${weekNumber}` : weekId;
}

export function getWeekSortValue(weekId: string): number {
  return Number(weekId.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
}

export function getMonthSortValue(monthId: string): number {
  const match = monthId.match(/^([A-Za-z]+)(\d{4})$/);

  if (!match) {
    return 0;
  }

  const [, rawMonth, rawYear] = match;
  const year = Number(rawYear);
  const monthIndex = MONTH_NAMES.findIndex((name) => name.toLowerCase() === rawMonth.toLowerCase());

  if (!Number.isFinite(year) || monthIndex === -1) {
    return 0;
  }

  return year * 100 + monthIndex + 1;
}

export function normalizeProtocolData(
  id: string,
  data: ProtocolSourceData,
  monthId: string,
  weekId: string
): Protocol {
  const protocolName = data.research_title || data.protocol_name || '';
  const protocolFile = data.e_link || data.protocol_file || '';
  const dueDate = ensureValidDueDate(data.due_date);

  return {
    ...data,
    id,
    protocol_name: protocolName,
    protocol_file: protocolFile,
    release_period: `${formatMonthLabel(monthId)} ${formatWeekLabel(weekId)}`,
    academic_level: data.course_program || data.academic_level || '',
    due_date: dueDate,
    status: data.status || 'In Progress',
    created_at: data.created_at || new Date().toISOString(),
    research_title: data.research_title || protocolName,
    e_link: data.e_link || protocolFile,
    course_program: data.course_program || data.academic_level || '',
    spup_rec_code: data.spup_rec_code || id,
    principal_investigator: data.principal_investigator || '',
    monthId,
    weekId,
    _path: `${monthId}/${weekId}/${id}`,
  };
}

export function sortProtocols(protocols: Protocol[]): Protocol[] {
  return [...protocols].sort((left, right) => {
    const leftCode = left.spup_rec_code || left.id;
    const rightCode = right.spup_rec_code || right.id;

    return leftCode.localeCompare(rightCode);
  });
}

export function groupProtocolsByMonth(protocols: Protocol[]): MonthGroup[] {
  const monthMap = new Map<string, Protocol[]>();

  for (const protocol of protocols) {
    const monthProtocols = monthMap.get(protocol.monthId) ?? [];
    monthProtocols.push(protocol);
    monthMap.set(protocol.monthId, monthProtocols);
  }

  return Array.from(monthMap.entries())
    .map(([monthId, monthProtocols]) => {
      const weekMap = new Map<string, Protocol[]>();

      for (const protocol of monthProtocols) {
        const weekProtocols = weekMap.get(protocol.weekId) ?? [];
        weekProtocols.push(protocol);
        weekMap.set(protocol.weekId, weekProtocols);
      }

      return {
        monthId,
        monthLabel: formatMonthLabel(monthId),
        protocols: sortProtocols(monthProtocols),
        weeks: Array.from(weekMap.entries())
          .map(([weekId, weekProtocols]) => ({
            weekId,
            weekLabel: formatWeekLabel(weekId),
            protocols: sortProtocols(weekProtocols),
          }))
          .sort((left, right) => getWeekSortValue(left.weekId) - getWeekSortValue(right.weekId)),
      };
    })
    .sort((left, right) => getMonthSortValue(right.monthId) - getMonthSortValue(left.monthId));
}

export function getReviewerTotals(protocols: Protocol[]) {
  const total = protocols.reduce((sum, protocol) => sum + (protocol.reviewers?.length ?? 0), 0);
  const completed = protocols.reduce(
    (sum, protocol) => sum + (protocol.reviewers?.filter((reviewer) => reviewer.status === 'Completed').length ?? 0),
    0
  );

  return { total, completed };
}

export function getProtocolStatusCounts(protocols: Protocol[]) {
  return {
    total: protocols.length,
    completed: protocols.filter((protocol) => protocol.status === 'Completed').length,
    inProgress: protocols.filter((protocol) => protocol.status === 'In Progress').length,
    overdue: protocols.filter((protocol) => protocol.status !== 'Completed' && isOverdue(protocol.due_date)).length,
    dueSoon: protocols.filter((protocol) => protocol.status !== 'Completed' && isDueSoon(protocol.due_date)).length,
  };
}

export function buildNotificationProtocols(protocols: Protocol[]) {
  return protocols.map((protocol) => ({
    monthId: protocol.monthId,
    weekId: protocol.weekId,
    spup_rec_code: protocol.spup_rec_code || protocol.id,
    principal_investigator: protocol.principal_investigator || '',
    research_title: protocol.research_title || protocol.protocol_name,
    course_program: protocol.course_program || protocol.academic_level,
    e_link: protocol.e_link || protocol.protocol_file,
    reviewers: protocol.reviewers || [],
  }));
}
