'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { ReviewerAssignmentDto, ReviewStatus } from '@/app/reviewer/types';

export default function ReviewerProtocolPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const protocolKey = params.id;
  const requestedAssignmentId = searchParams.get('assignmentId');
  const [assignment, setAssignment] = useState<ReviewerAssignmentDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    const reviewerId = localStorage.getItem('reviewerId');
    if (!reviewerId) {
      window.location.href = '/';
      return;
    }

    const load = async () => {
      setLoading(true);
      try {
        const query = new URLSearchParams({ reviewerId });
        if (requestedAssignmentId) query.set('assignmentId', requestedAssignmentId);
        const response = await fetch(`/api/reviewer/protocols/${encodeURIComponent(protocolKey)}?${query}`, { cache: 'no-store' });
        const result = await response.json() as { assignment?: ReviewerAssignmentDto; error?: string };
        if (!response.ok || !result.assignment) throw new Error(result.error || 'Protocol not found.');
        setAssignment(result.assignment);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load protocol details.');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [protocolKey, requestedAssignmentId]);

  const updateStatus = async (status: ReviewStatus) => {
    const reviewerId = localStorage.getItem('reviewerId');
    if (!reviewerId || !assignment) return;
    setUpdating(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch('/api/reviewer/assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerId, assignmentIds: [assignment.assignmentId], status }),
      });
      const result = await response.json() as { assignments?: ReviewerAssignmentDto[]; error?: string };
      if (!response.ok || !result.assignments?.[0]) throw new Error(result.error || 'Failed to update review status.');
      setAssignment(result.assignments[0]);
      setSuccess(status === 'Completed' ? 'Review marked as completed.' : 'Review reopened.');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : 'Failed to update review status.');
    } finally {
      setUpdating(false);
    }
  };

  if (loading) return <div className="flex min-h-[24rem] items-center justify-center text-gray-600">Loading protocol details...</div>;
  if (!assignment) return <div className="mx-auto max-w-3xl p-6"><div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-700">{error || 'Protocol not found.'}</div></div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <Link href="/reviewer/dashboard" className="text-sm font-medium text-blue-700">Return to dashboard</Link>
      <header className="rounded-lg border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-green-800">{assignment.recCode}</span>
          <span className={`rounded-full px-2 py-1 text-xs font-medium ${assignment.status === 'Completed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>{assignment.status}</span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-gray-950">{assignment.researchTitle}</h1>
        <p className="mt-1 text-gray-600">{assignment.releasePeriod}</p>
      </header>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">{success}</div>}

      <section className="grid gap-4 rounded-lg border bg-white p-5 shadow-sm sm:grid-cols-2">
        <div><p className="text-xs font-medium uppercase text-gray-500">Principal investigator</p><p className="mt-1 text-gray-900">{assignment.principalInvestigator || 'N/A'}</p></div>
        <div><p className="text-xs font-medium uppercase text-gray-500">Adviser</p><p className="mt-1 text-gray-900">{assignment.adviser || 'N/A'}</p></div>
        <div><p className="text-xs font-medium uppercase text-gray-500">Course / program</p><p className="mt-1 text-gray-900">{assignment.courseProgram || 'N/A'}</p></div>
        <div><p className="text-xs font-medium uppercase text-gray-500">Review form</p><p className="mt-1 text-gray-900">{assignment.formName || 'N/A'}</p></div>
        <div><p className="text-xs font-medium uppercase text-gray-500">Due date</p><p className="mt-1 text-gray-900">{assignment.dueDate || 'No due date'}</p></div>
        <div><p className="text-xs font-medium uppercase text-gray-500">Completed</p><p className="mt-1 text-gray-900">{assignment.completedAt ? new Date(assignment.completedAt).toLocaleString() : 'Not completed'}</p></div>
      </section>

      <div className="flex flex-wrap gap-2">
        {assignment.documentLink && <a href={assignment.documentLink} target="_blank" rel="noreferrer" className="rounded-md border px-4 py-2 text-sm font-medium text-blue-700">Open protocol document</a>}
        {assignment.formUrl && <a href={assignment.formUrl} target="_blank" rel="noreferrer" className="rounded-md border px-4 py-2 text-sm font-medium text-blue-700">Open review form</a>}
        <button
          type="button"
          disabled={updating}
          onClick={() => void updateStatus(assignment.status === 'Completed' ? 'In Progress' : 'Completed')}
          className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {updating ? 'Saving...' : assignment.status === 'Completed' ? 'Reopen review' : 'Mark review complete'}
        </button>
      </div>
    </div>
  );
}
