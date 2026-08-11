'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type {
  ReviewerAssignmentDto,
  ReviewerAssignmentsResponse,
  ReviewerIdentity,
  ReviewStatus,
} from '@/app/reviewer/types';

function isOverdue(dueDate: string): boolean {
  if (!dueDate) return false;
  return dueDate < new Date().toISOString().slice(0, 10);
}

function isDueSoon(dueDate: string): boolean {
  if (!dueDate || isOverdue(dueDate)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${dueDate}T00:00:00`);
  const days = Math.ceil((due.getTime() - today.getTime()) / 86_400_000);
  return days >= 0 && days <= 7;
}

function statusBadge(assignment: ReviewerAssignmentDto) {
  if (assignment.status === 'Completed') return { label: 'Completed', className: 'bg-green-100 text-green-800' };
  if (isOverdue(assignment.dueDate)) return { label: 'Overdue', className: 'bg-red-100 text-red-800' };
  if (isDueSoon(assignment.dueDate)) return { label: 'Due Soon', className: 'bg-amber-100 text-amber-800' };
  return { label: 'In Progress', className: 'bg-blue-100 text-blue-800' };
}

export default function ReviewerDashboard() {
  const [reviewer, setReviewer] = useState<ReviewerIdentity | null>(null);
  const [assignments, setAssignments] = useState<ReviewerAssignmentDto[]>([]);
  const [period, setPeriod] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});

  const loadAssignments = async () => {
    const reviewerId = localStorage.getItem('reviewerId');
    if (!reviewerId) {
      window.location.href = '/';
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/reviewer/assignments?reviewerId=${encodeURIComponent(reviewerId)}`, {
        cache: 'no-store',
      });
      const result = await response.json() as ReviewerAssignmentsResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Failed to load assigned protocols.');
      setReviewer(result.reviewer);
      setAssignments(result.assignments);
      localStorage.setItem('reviewerId', result.reviewer.id);
      localStorage.setItem('reviewerName', result.reviewer.name);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load assigned protocols.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAssignments();
  }, []);

  const periods = useMemo(() => Array.from(new Set(assignments.map((item) => item.releasePeriod))).sort().reverse(), [assignments]);
  const visibleAssignments = useMemo(
    () => period === 'all' ? assignments : assignments.filter((item) => item.releasePeriod === period),
    [assignments, period]
  );
  const stats = useMemo(() => {
    const incomplete = assignments.filter((item) => item.status !== 'Completed');
    return {
      total: assignments.length,
      completed: assignments.length - incomplete.length,
      inProgress: incomplete.length,
      overdue: incomplete.filter((item) => isOverdue(item.dueDate)).length,
      dueSoon: incomplete.filter((item) => isDueSoon(item.dueDate)).length,
    };
  }, [assignments]);

  const updateStatus = async (assignmentIds: string[], status: ReviewStatus) => {
    if (!reviewer || assignmentIds.length === 0) return;
    setUpdating((current) => Object.fromEntries([...Object.keys(current), ...assignmentIds].map((id) => [id, true])));
    setError(null);
    try {
      const response = await fetch('/api/reviewer/assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerId: reviewer.id, assignmentIds, status }),
      });
      const result = await response.json() as { assignments?: ReviewerAssignmentDto[]; error?: string };
      if (!response.ok || !result.assignments) throw new Error(result.error || 'Failed to update review status.');
      const changed = new Map(result.assignments.map((item) => [item.assignmentId, item]));
      setAssignments((current) => current.map((item) => changed.get(item.assignmentId) || item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update review status.');
    } finally {
      setUpdating({});
    }
  };

  if (loading) {
    return <div className="flex min-h-[24rem] items-center justify-center text-gray-600">Loading assigned protocols...</div>;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-950">Assigned protocols</h1>
          <p className="mt-1 text-sm text-gray-600">{reviewer ? `Reviewer ${reviewer.name}` : 'Your review workload'}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            const pendingIds = visibleAssignments.filter((item) => item.status !== 'Completed').map((item) => item.assignmentId);
            if (pendingIds.length && window.confirm(`Mark ${pendingIds.length} review${pendingIds.length === 1 ? '' : 's'} as completed?`)) {
              void updateStatus(pendingIds, 'Completed');
            }
          }}
          disabled={!visibleAssignments.some((item) => item.status !== 'Completed') || Object.keys(updating).length > 0}
          className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Complete visible reviews
        </button>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Total', stats.total], ['Completed', stats.completed], ['In Progress', stats.inProgress],
          ['Overdue', stats.overdue], ['Due Soon', stats.dueSoon],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-gray-950">{value}</p>
          </div>
        ))}
      </section>

      <div className="max-w-sm">
        <label htmlFor="release-period" className="mb-1 block text-sm font-medium text-gray-700">Release period</label>
        <select id="release-period" value={period} onChange={(event) => setPeriod(event.target.value)} className="w-full rounded-md border px-3 py-2">
          <option value="all">All release periods</option>
          {periods.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      <section className="overflow-hidden rounded-lg border bg-white shadow-sm">
        {visibleAssignments.length === 0 ? (
          <p className="p-8 text-center text-gray-500">No assigned protocols found.</p>
        ) : (
          <div className="divide-y">
            {visibleAssignments.map((assignment) => {
              const badge = statusBadge(assignment);
              return (
                <article key={assignment.assignmentId} className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-green-800">{assignment.recCode}</span>
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${badge.className}`}>{badge.label}</span>
                      </div>
                      <h2 className="mt-2 font-medium text-gray-950">{assignment.researchTitle}</h2>
                      <p className="mt-1 text-sm text-gray-600">{assignment.releasePeriod} · {assignment.formName}</p>
                      <p className="mt-1 text-sm text-gray-600">Due: {assignment.dueDate || 'No due date'}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Link href={`/reviewer/protocols/${assignment.protocolKey}?assignmentId=${assignment.assignmentId}`} className="rounded-md border px-3 py-2 text-sm font-medium text-gray-700">
                        View details
                      </Link>
                      {assignment.documentLink && <a href={assignment.documentLink} target="_blank" rel="noreferrer" className="rounded-md border px-3 py-2 text-sm font-medium text-blue-700">Open document</a>}
                      {assignment.formUrl && <a href={assignment.formUrl} target="_blank" rel="noreferrer" className="rounded-md border px-3 py-2 text-sm font-medium text-blue-700">Open form</a>}
                      <button
                        type="button"
                        disabled={Boolean(updating[assignment.assignmentId])}
                        onClick={() => void updateStatus([assignment.assignmentId], assignment.status === 'Completed' ? 'In Progress' : 'Completed')}
                        className="rounded-md bg-green-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {assignment.status === 'Completed' ? 'Reopen' : 'Mark complete'}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
