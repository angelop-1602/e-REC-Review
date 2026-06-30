'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { collection, collectionGroup, getDocs, query } from 'firebase/firestore';
import {
  HiOutlineArrowRight,
  HiOutlineArrowUpTray,
  HiOutlineBellAlert,
  HiOutlineCheckCircle,
  HiOutlineClipboardDocumentList,
  HiOutlineClock,
  HiOutlineDocumentText,
  HiOutlineExclamationTriangle,
  HiOutlineFolderOpen,
  HiOutlineUsers,
} from 'react-icons/hi2';
import { db } from '@/lib/firebaseconfig';
import {
  WEEK_IDS,
  formatMonthLabel,
  formatWeekLabel,
  getProtocolPathParts,
  groupProtocolsByMonth,
  normalizeProtocolData,
  type MonthGroup,
  type Protocol,
} from '@/lib/protocols';
import { formatDate, isDueSoon, isOverdue } from '@/lib/utils';

type NoticeType = 'success' | 'warning' | 'danger' | 'neutral';

interface ReviewAssignment {
  id: string;
  protocolId: string;
  spupRecCode: string;
  title: string;
  reviewerId: string;
  reviewerName: string;
  status: string;
  dueDate: string;
  monthId: string;
  weekId: string;
  monthLabel: string;
  weekLabel: string;
}

interface MonthActivity {
  month: MonthGroup;
  reviewTotal: number;
  reviewCompleted: number;
  active: number;
  overdue: number;
}

interface ReviewerSpeed {
  reviewerId: string;
  reviewerName: string;
  assignedCount: number;
  completedCount: number;
  pendingCount: number;
  overdueCount: number;
  scoreDays: number | null;
  completedAverageDays: number | null;
  longestOpenDays: number | null;
  completionRate: number;
}

function getWeekHref(monthId: string, weekId: string): string {
  return `/admin/protocols/months/${encodeURIComponent(monthId)}/weeks/${encodeURIComponent(weekId)}`;
}

function safeFormatDate(date: string): string {
  return date ? formatDate(date) : 'No date set';
}

function getDateValue(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'object' && 'toDate' in value) {
    try {
      const date = (value as { toDate: () => Date }).toDate();

      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }

  return null;
}

function getDayDifference(start: Date, end: Date): number {
  const diff = end.getTime() - start.getTime();

  return Math.max(diff / (1000 * 60 * 60 * 24), 0);
}

function getCompletionPercent(completed: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  return Math.round((completed / total) * 100);
}

function formatCompactDays(days: number | null): string {
  if (days === null) {
    return 'N/A';
  }

  return `${days.toFixed(1)}d`;
}

function getProtocolReviewTotals(protocol: Protocol) {
  if (protocol.reviewers && protocol.reviewers.length > 0) {
    return {
      total: protocol.reviewers.length,
      completed: protocol.reviewers.filter((reviewer) => reviewer.status === 'Completed').length,
    };
  }

  return {
    total: protocol.reviewer ? 1 : 0,
    completed: protocol.status === 'Completed' ? 1 : 0,
  };
}

function getProtocolState(protocol: Protocol): 'Completed' | 'Partially Completed' | 'In Progress' | 'Overdue' | 'Due Soon' {
  const reviewTotals = getProtocolReviewTotals(protocol);

  if (reviewTotals.total > 0 && reviewTotals.completed === reviewTotals.total) {
    return 'Completed';
  }

  if (protocol.status === 'Completed') {
    return 'Completed';
  }

  if (protocol.reviewers?.some((reviewer) => reviewer.status !== 'Completed' && isOverdue(reviewer.due_date || protocol.due_date))) {
    return 'Overdue';
  }

  if (protocol.due_date && isOverdue(protocol.due_date)) {
    return 'Overdue';
  }

  if (protocol.reviewers?.some((reviewer) => reviewer.status !== 'Completed' && isDueSoon(reviewer.due_date || protocol.due_date))) {
    return 'Due Soon';
  }

  if (protocol.due_date && isDueSoon(protocol.due_date)) {
    return 'Due Soon';
  }

  if (reviewTotals.completed > 0) {
    return 'Partially Completed';
  }

  return 'In Progress';
}

function getReviewAssignments(protocols: Protocol[]): ReviewAssignment[] {
  return protocols.flatMap((protocol) => {
    const base = {
      protocolId: protocol.id,
      spupRecCode: protocol.spup_rec_code || protocol.id,
      title: protocol.research_title || protocol.protocol_name || 'Untitled protocol',
      monthId: protocol.monthId,
      weekId: protocol.weekId,
      monthLabel: formatMonthLabel(protocol.monthId),
      weekLabel: formatWeekLabel(protocol.weekId),
    };

    if (protocol.reviewers && protocol.reviewers.length > 0) {
      return protocol.reviewers.map((reviewer, index) => ({
        ...base,
        id: `${protocol.monthId}/${protocol.weekId}/${protocol.id}/${reviewer.id || index}`,
        reviewerId: reviewer.id || reviewer.name || 'reviewer',
        reviewerName: reviewer.name || reviewer.id || 'Unassigned reviewer',
        status: reviewer.status || 'In Progress',
        dueDate: reviewer.due_date || protocol.due_date,
      }));
    }

    if (protocol.reviewer) {
      return [{
        ...base,
        id: `${protocol.monthId}/${protocol.weekId}/${protocol.id}/${protocol.reviewer}`,
        reviewerId: protocol.reviewer,
        reviewerName: protocol.reviewer,
        status: protocol.status || 'In Progress',
        dueDate: protocol.due_date,
      }];
    }

    return [];
  });
}

function sortByDueDate(left: ReviewAssignment, right: ReviewAssignment) {
  const leftDate = left.dueDate || '9999-12-31';
  const rightDate = right.dueDate || '9999-12-31';

  return leftDate.localeCompare(rightDate);
}

function getBadgeClasses(type: NoticeType): string {
  const classes: Record<NoticeType, string> = {
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
    neutral: 'bg-slate-50 text-slate-700 border-slate-200',
  };

  return classes[type];
}

function getProtocolStatusStyle(status: ReturnType<typeof getProtocolState>) {
  if (status === 'Completed') {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  }

  if (status === 'Overdue') {
    return 'bg-red-50 text-red-700 border-red-200';
  }

  if (status === 'Due Soon') {
    return 'bg-amber-50 text-amber-700 border-amber-200';
  }

  if (status === 'Partially Completed') {
    return 'bg-sky-50 text-sky-700 border-sky-200';
  }

  return 'bg-slate-50 text-slate-700 border-slate-200';
}

function StatTile({
  label,
  value,
  hint,
  tone,
  icon,
}: {
  label: string;
  value: string | number;
  hint: string;
  tone: NoticeType;
  icon: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-normal text-slate-950">{value}</p>
          <p className="mt-1 text-sm text-slate-500">{hint}</p>
        </div>
        <div className={`rounded-md border p-2 ${getBadgeClasses(tone)}`}>
          {icon}
        </div>
      </div>
    </section>
  );
}

function SectionHeader({
  title,
  detail,
  href,
  action,
}: {
  title: string;
  detail?: string;
  href?: string;
  action?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-4 py-3">
      <div>
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        {detail && <p className="mt-1 text-sm text-slate-500">{detail}</p>}
      </div>
      {href && action && (
        <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-900">
          {action}
          <HiOutlineArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="px-4 py-8 text-center text-sm text-slate-500">
      {message}
    </div>
  );
}

function MonthStatusChart({ activity }: { activity: MonthActivity[] }) {
  if (activity.length === 0) {
    return <EmptyState message="No month activity available for charting." />;
  }

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap gap-3 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" />
          Completed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />
          Active
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-red-500" />
          Overdue
        </span>
      </div>

      <div className="space-y-4">
        {activity.map((item) => {
          const total = Math.max(item.reviewTotal, 1);
          const completed = item.reviewCompleted;
          const overdue = item.overdue;
          const active = Math.max(item.active - item.overdue, 0);
          const completedWidth = getCompletionPercent(completed, total);
          const overdueWidth = getCompletionPercent(overdue, total);
          const activeWidth = Math.max(0, 100 - completedWidth - overdueWidth);

          return (
            <div key={item.month.monthId} className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">{item.month.monthLabel}</p>
                  <p className="text-xs text-slate-500">{item.month.protocols.length} protocols</p>
                </div>
                <p className="text-xs font-medium text-slate-500">{item.reviewTotal} reviews</p>
              </div>

              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                {completed > 0 && (
                  <div
                    className="inline-block h-full bg-emerald-600 align-top"
                    style={{ width: `${completedWidth}%` }}
                  />
                )}
                {active > 0 && (
                  <div
                    className="inline-block h-full bg-sky-500 align-top"
                    style={{ width: `${activeWidth}%` }}
                  />
                )}
                {overdue > 0 && (
                  <div
                    className="inline-block h-full bg-red-500 align-top"
                    style={{ width: `${overdueWidth}%` }}
                  />
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs text-slate-500">
                <span>{completed} completed</span>
                <span>{active} active</span>
                <span>{overdue} overdue</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReviewerSpeedChart({ reviewers }: { reviewers: ReviewerSpeed[] }) {
  if (reviewers.length === 0) {
    return <EmptyState message="No reviewer assignments with usable upload dates are available yet." />;
  }

  const scoredReviewers = reviewers.filter((reviewer) => reviewer.scoreDays !== null);
  const fastestScore = scoredReviewers.length > 0 ? Math.min(...scoredReviewers.map((reviewer) => reviewer.scoreDays ?? 0)) : 0;
  const slowestScore = scoredReviewers.length > 0 ? Math.max(...scoredReviewers.map((reviewer) => reviewer.scoreDays ?? 0), fastestScore + 1) : fastestScore + 1;
  const scoreRange = Math.max(slowestScore - fastestScore, 1);
  const pendingTotal = reviewers.reduce((sum, reviewer) => sum + reviewer.pendingCount, 0);
  const overdueTotal = reviewers.reduce((sum, reviewer) => sum + reviewer.overdueCount, 0);

  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-slate-200 bg-slate-50 text-xs">
        <div className="border-r border-slate-200 px-3 py-2">
          <p className="text-slate-500">Reviewers</p>
          <p className="mt-1 text-base font-semibold text-slate-950">{reviewers.length}</p>
        </div>
        <div className="border-r border-slate-200 px-3 py-2">
          <p className="text-slate-500">Pending</p>
          <p className="mt-1 text-base font-semibold text-amber-700">{pendingTotal}</p>
        </div>
        <div className="px-3 py-2">
          <p className="text-slate-500">Overdue</p>
          <p className="mt-1 text-base font-semibold text-red-700">{overdueTotal}</p>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Score uses completed review days plus pending reviews counted as days open today. Lower score means faster response with less open delay.
      </p>

      <div className="max-h-96 overflow-y-auto rounded-md border border-slate-200">
        <div className="divide-y divide-slate-100">
          {reviewers.map((reviewer, index) => {
            const speedPercent = reviewer.scoreDays === null
              ? 18
              : Math.max(18, Math.round(100 - ((reviewer.scoreDays - fastestScore) / scoreRange) * 72));
            const barClass = reviewer.overdueCount > 0
              ? 'bg-red-500'
              : reviewer.pendingCount > reviewer.completedCount
                ? 'bg-amber-500'
                : index < 3
                  ? 'bg-emerald-600'
                  : 'bg-sky-500';

            return (
              <div key={reviewer.reviewerId} className="grid grid-cols-1 gap-3 px-3 py-2.5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-center">
                <div className="min-w-0 space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-semibold text-slate-600">
                        {index + 1}
                      </span>
                      <p className="truncate text-sm font-semibold text-slate-950">{reviewer.reviewerName}</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold text-slate-950">{formatCompactDays(reviewer.scoreDays)}</p>
                  </div>

                  <div className="h-2 rounded-full bg-slate-100">
                    <div className={`h-2 rounded-full ${barClass}`} style={{ width: `${speedPercent}%` }} />
                  </div>

                  <p className="truncate text-xs text-slate-500">
                    Completed avg {formatCompactDays(reviewer.completedAverageDays)} - longest open {formatCompactDays(reviewer.longestOpenDays)}
                  </p>
                </div>

                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div className="rounded-md bg-slate-50 px-2 py-1.5">
                    <p className="text-slate-500">Done</p>
                    <p className="mt-1 font-semibold text-slate-950">
                      {reviewer.completedCount}/{reviewer.assignedCount}
                    </p>
                  </div>
                  <div className="rounded-md bg-slate-50 px-2 py-1.5">
                    <p className="text-slate-500">Rate</p>
                    <p className="mt-1 font-semibold text-slate-950">{reviewer.completionRate}%</p>
                  </div>
                  <div className="rounded-md bg-amber-50 px-2 py-1.5">
                    <p className="text-amber-700">Pending</p>
                    <p className="mt-1 font-semibold text-amber-900">{reviewer.pendingCount}</p>
                  </div>
                  <div className="rounded-md bg-red-50 px-2 py-1.5">
                    <p className="text-red-700">Late</p>
                    <p className="mt-1 font-semibold text-red-900">{reviewer.overdueCount}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [reviewerCount, setReviewerCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        setError(null);

        const fetchedProtocols: Protocol[] = [];

        for (const weekId of WEEK_IDS) {
          const protocolsGroupQuery = query(collectionGroup(db, weekId));
          const protocolsGroupSnapshot = await getDocs(protocolsGroupQuery);

          for (const protocolDoc of protocolsGroupSnapshot.docs) {
            const pathParts = getProtocolPathParts(protocolDoc.ref.path);

            if (!pathParts) {
              continue;
            }

            fetchedProtocols.push(
              normalizeProtocolData(protocolDoc.id, protocolDoc.data(), pathParts.monthId, pathParts.weekId)
            );
          }
        }

        const reviewersSnapshot = await getDocs(collection(db, 'reviewers'));

        setProtocols(fetchedProtocols);
        setReviewerCount(reviewersSnapshot.size);
      } catch (dashboardError) {
        console.error('Error loading admin dashboard:', dashboardError);
        setError('Failed to load dashboard data. Please refresh and try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  const assignments = useMemo(() => getReviewAssignments(protocols), [protocols]);
  const monthGroups = useMemo(() => groupProtocolsByMonth(protocols), [protocols]);

  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.status !== 'Completed'),
    [assignments]
  );
  const completedAssignments = assignments.length - activeAssignments.length;
  const overdueAssignments = useMemo(
    () => activeAssignments.filter((assignment) => assignment.dueDate && isOverdue(assignment.dueDate)).sort(sortByDueDate),
    [activeAssignments]
  );
  const dueSoonAssignments = useMemo(
    () => activeAssignments
      .filter((assignment) => assignment.dueDate && isDueSoon(assignment.dueDate))
      .sort(sortByDueDate),
    [activeAssignments]
  );
  const completionPercent = getCompletionPercent(completedAssignments, assignments.length);

  const recentProtocols = useMemo(() => (
    [...protocols]
      .sort((left, right) => {
        const leftDate = new Date(left.created_at || 0).getTime();
        const rightDate = new Date(right.created_at || 0).getTime();

        return rightDate - leftDate;
      })
      .slice(0, 6)
  ), [protocols]);

  const monthActivity = useMemo<MonthActivity[]>(() => (
    monthGroups.slice(0, 5).map((month) => {
      const monthAssignments = assignments.filter((assignment) => assignment.monthId === month.monthId);
      const active = monthAssignments.filter((assignment) => assignment.status !== 'Completed');

      return {
        month,
        reviewTotal: monthAssignments.length,
        reviewCompleted: monthAssignments.length - active.length,
        active: active.length,
        overdue: active.filter((assignment) => assignment.dueDate && isOverdue(assignment.dueDate)).length,
      };
    })
  ), [assignments, monthGroups]);

  const reviewerSpeed = useMemo<ReviewerSpeed[]>(() => {
    const reviewerMap = new Map<string, {
      reviewerId: string;
      reviewerName: string;
      assignedCount: number;
      completedCount: number;
      pendingCount: number;
      overdueCount: number;
      scoredDays: number[];
      completedDays: number[];
      openDays: number[];
    }>();
    const today = new Date();

    const trackReviewer = ({
      reviewerId,
      reviewerName,
      status,
      dueDate,
      createdDate,
      completedDate,
    }: {
      reviewerId: string;
      reviewerName: string;
      status: string;
      dueDate: string;
      createdDate: Date;
      completedDate: Date | null;
    }) => {
      const current = reviewerMap.get(reviewerId) ?? {
        reviewerId,
        reviewerName,
        assignedCount: 0,
        completedCount: 0,
        pendingCount: 0,
        overdueCount: 0,
        scoredDays: [],
        completedDays: [],
        openDays: [],
      };

      current.assignedCount += 1;

      if (status === 'Completed') {
        current.completedCount += 1;

        if (completedDate) {
          const completedDays = getDayDifference(createdDate, completedDate);
          current.completedDays.push(completedDays);
          current.scoredDays.push(completedDays);
        }
      } else {
        const openDays = getDayDifference(createdDate, today);
        current.pendingCount += 1;
        current.openDays.push(openDays);
        current.scoredDays.push(openDays);

        if (dueDate && isOverdue(dueDate)) {
          current.overdueCount += 1;
        }
      }

      reviewerMap.set(reviewerId, current);
    };

    for (const protocol of protocols) {
      const createdDate = getDateValue(protocol.created_at);

      if (!createdDate) {
        continue;
      }

      if (protocol.reviewers && protocol.reviewers.length > 0) {
        for (const reviewer of protocol.reviewers) {
          const reviewerId = reviewer.id || reviewer.name || 'reviewer';

          trackReviewer({
            reviewerId,
            reviewerName: reviewer.name || reviewer.id || 'Reviewer',
            status: reviewer.status || 'In Progress',
            dueDate: reviewer.due_date || protocol.due_date,
            createdDate,
            completedDate: getDateValue(reviewer.completed_at),
          });
        }

        continue;
      }

      if (protocol.reviewer) {
        trackReviewer({
          reviewerId: protocol.reviewer,
          reviewerName: protocol.reviewer,
          status: protocol.status || 'In Progress',
          dueDate: protocol.due_date,
          createdDate,
          completedDate: null,
        });
      }
    }

    return Array.from(reviewerMap.values())
      .filter((reviewer) => reviewer.assignedCount > 0)
      .map((reviewer) => {
        const scoreDays = reviewer.scoredDays.length > 0
          ? reviewer.scoredDays.reduce((sum, days) => sum + days, 0) / reviewer.scoredDays.length
          : null;
        const completedAverageDays = reviewer.completedDays.length > 0
          ? reviewer.completedDays.reduce((sum, days) => sum + days, 0) / reviewer.completedDays.length
          : null;

        return {
          reviewerId: reviewer.reviewerId,
          reviewerName: reviewer.reviewerName,
          assignedCount: reviewer.assignedCount,
          completedCount: reviewer.completedCount,
          pendingCount: reviewer.pendingCount,
          overdueCount: reviewer.overdueCount,
          scoreDays,
          completedAverageDays,
          longestOpenDays: reviewer.openDays.length > 0 ? Math.max(...reviewer.openDays) : null,
          completionRate: getCompletionPercent(reviewer.completedCount, reviewer.assignedCount),
        };
      })
      .sort((left, right) => {
        const leftHasCompletedData = left.completedAverageDays === null ? 1 : 0;
        const rightHasCompletedData = right.completedAverageDays === null ? 1 : 0;

        const leftHasScore = left.scoreDays === null ? 1 : 0;
        const rightHasScore = right.scoreDays === null ? 1 : 0;

        return leftHasCompletedData - rightHasCompletedData
          || leftHasScore - rightHasScore
          || (left.scoreDays ?? Number.MAX_SAFE_INTEGER) - (right.scoreDays ?? Number.MAX_SAFE_INTEGER)
          || left.overdueCount - right.overdueCount
          || left.pendingCount - right.pendingCount
          || right.completedCount - left.completedCount;
      });
  }, [protocols]);

  const currentDateLabel = useMemo(() => (
    new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
  ), []);

  if (loading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-6">
        <div className="mx-auto flex max-w-7xl items-center justify-center rounded-lg border border-slate-200 bg-white p-12 shadow-sm">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
          <span className="ml-3 text-sm font-medium text-slate-600">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 p-6">
        <div className="mx-auto max-w-7xl rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          <p className="font-semibold">Dashboard unavailable</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <main className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
        <section className="rounded-lg border border-slate-200 bg-white px-5 py-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-medium text-emerald-700">{currentDateLabel}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal text-slate-950">Admin Dashboard</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Monitor review workload, overdue assignments, and recent protocol activity across all months and weeks.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/csv-upload" className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800">
                <HiOutlineArrowUpTray className="h-4 w-4" />
                Upload
              </Link>
              <Link href="/admin/protocols" className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <HiOutlineFolderOpen className="h-4 w-4" />
                Protocols
              </Link>
              <Link href="/admin/request-documents" className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <HiOutlineDocumentText className="h-4 w-4" />
                Requests
              </Link>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Protocols"
            value={protocols.length}
            hint={`${monthGroups.length} active month${monthGroups.length === 1 ? '' : 's'}`}
            tone="neutral"
            icon={<HiOutlineClipboardDocumentList className="h-5 w-5" />}
          />
          <StatTile
            label="Review Completion"
            value={`${completionPercent}%`}
            hint={`${completedAssignments}/${assignments.length} reviews completed`}
            tone="success"
            icon={<HiOutlineCheckCircle className="h-5 w-5" />}
          />
          <StatTile
            label="Overdue Reviews"
            value={overdueAssignments.length}
            hint="Reviewer assignments past due"
            tone={overdueAssignments.length > 0 ? 'danger' : 'success'}
            icon={<HiOutlineExclamationTriangle className="h-5 w-5" />}
          />
          <StatTile
            label="Due Soon"
            value={dueSoonAssignments.length}
            hint="Assignments due within 7 days"
            tone={dueSoonAssignments.length > 0 ? 'warning' : 'neutral'}
            icon={<HiOutlineClock className="h-5 w-5" />}
          />
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_0.65fr]">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <SectionHeader title="Review Workload" detail="Current completion, active assignments, and reviewer coverage." />
            <div className="p-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <div>
                  <p className="text-sm font-medium text-slate-500">Completed Reviews</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{completedAssignments}</p>
                  <div className="mt-3 h-2 rounded-full bg-slate-100">
                    <div className="h-2 rounded-full bg-emerald-600" style={{ width: `${completionPercent}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{completionPercent}% completion rate</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Active Reviews</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{activeAssignments.length}</p>
                  <p className="mt-3 text-sm text-slate-500">Reviews still assigned to reviewers.</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-500">Reviewers</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-950">{reviewerCount}</p>
                  <p className="mt-3 text-sm text-slate-500">People available in reviewer management.</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <SectionHeader title="Quick Actions" />
            <div className="divide-y divide-slate-100">
              {[
                { label: 'Upload protocols', href: '/admin/csv-upload', icon: HiOutlineArrowUpTray },
                { label: 'Send reviewer emails', href: '/admin/protocols', icon: HiOutlineBellAlert },
                { label: 'View mailing status', href: '/admin/mailing', icon: HiOutlineClock },
                { label: 'Manage reviewers', href: '/admin/reviewers', icon: HiOutlineUsers },
                { label: 'Prepare request documents', href: '/admin/request-documents', icon: HiOutlineDocumentText },
              ].map((action) => {
                const Icon = action.icon;

                return (
                  <Link key={action.href} href={action.href} className="flex items-center justify-between px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-emerald-700" />
                      {action.label}
                    </span>
                    <HiOutlineArrowRight className="h-4 w-4 text-slate-400" />
                  </Link>
                );
              })}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <SectionHeader title="Immediate Attention" detail="Oldest overdue reviewer assignments." href="/admin/protocols" action="Open protocols" />
            {overdueAssignments.length === 0 ? (
              <EmptyState message="No overdue reviewer assignments." />
            ) : (
              <div className="divide-y divide-slate-100">
                {overdueAssignments.slice(0, 6).map((assignment) => (
                  <div key={assignment.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">{assignment.spupRecCode}</p>
                        <p className="mt-1 truncate text-sm text-slate-600">{assignment.reviewerName}</p>
                        <p className="mt-1 text-xs text-slate-500">{assignment.monthLabel} - {assignment.weekLabel} - Due {safeFormatDate(assignment.dueDate)}</p>
                      </div>
                      <Link href={getWeekHref(assignment.monthId, assignment.weekId)} className="shrink-0 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100">
                        Open
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <SectionHeader
              title="Review Status by Month"
              detail="Stacked view of completed, active, and overdue reviews."
              href="/admin/protocols"
              action="Open months"
            />
            <MonthStatusChart activity={monthActivity} />
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4">
          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <SectionHeader title="Month Activity" detail="Recent upload months with review progress." href="/admin/protocols" action="View hierarchy" />
            {monthActivity.length === 0 ? (
              <EmptyState message="No protocol months found." />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-slate-500">Month</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-500">Protocols</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-500">Review Progress</th>
                      <th className="px-4 py-3 text-left font-medium text-slate-500">Overdue</th>
                      <th className="px-4 py-3 text-right font-medium text-slate-500">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {monthActivity.map((activity) => {
                      const percent = getCompletionPercent(activity.reviewCompleted, activity.reviewTotal);

                      return (
                        <tr key={activity.month.monthId}>
                          <td className="px-4 py-3 font-medium text-slate-950">{activity.month.monthLabel}</td>
                          <td className="px-4 py-3 text-slate-600">{activity.month.protocols.length}</td>
                          <td className="px-4 py-3">
                            <div className="flex min-w-44 items-center gap-3">
                              <div className="h-2 flex-1 rounded-full bg-slate-100">
                                <div className="h-2 rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
                              </div>
                              <span className="w-10 text-xs text-slate-500">{percent}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{activity.overdue}</td>
                          <td className="px-4 py-3 text-right">
                            <Link href="/admin/protocols" className="text-sm font-medium text-emerald-700 hover:text-emerald-900">
                              Open
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <SectionHeader title="Review Speed" detail="Decision view of reviewer speed, pending work, and overdue reviews." href="/admin/reviewers" action="Manage" />
            <ReviewerSpeedChart reviewers={reviewerSpeed} />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <SectionHeader title="Recent Protocols" detail="Latest protocol records added to the system." href="/admin/protocols" action="Browse all" />
          {recentProtocols.length === 0 ? (
            <EmptyState message="No recent protocols found." />
          ) : (
            <div className="divide-y divide-slate-100">
              {recentProtocols.map((protocol) => {
                const status = getProtocolState(protocol);
                const reviewTotals = getProtocolReviewTotals(protocol);

                return (
                  <div key={`${protocol.monthId}/${protocol.weekId}/${protocol.id}`} className="grid grid-cols-1 gap-3 px-4 py-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-950">{protocol.spup_rec_code || protocol.id}</p>
                      <p className="mt-1 truncate text-sm text-slate-600">{protocol.research_title || protocol.protocol_name || 'Untitled protocol'}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatMonthLabel(protocol.monthId)} - {formatWeekLabel(protocol.weekId)} - Added {safeFormatDate((protocol.created_at || '').split('T')[0])}
                      </p>
                    </div>
                    <span className={`w-fit rounded-full border px-2 py-1 text-xs font-medium ${getProtocolStatusStyle(status)}`}>
                      {status}
                    </span>
                    <Link href={getWeekHref(protocol.monthId, protocol.weekId)} className="inline-flex w-fit items-center gap-1 text-sm font-medium text-emerald-700 hover:text-emerald-900">
                      {reviewTotals.completed}/{reviewTotals.total} reviews
                      <HiOutlineArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
