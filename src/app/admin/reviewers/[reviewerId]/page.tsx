'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import {
  formatMonthLabel,
  formatWeekLabel,
  type Protocol,
} from '@/lib/protocols';
import {
  getReviewerAssignments,
  getReviewerAssignmentStats,
  type ReviewerProtocolAssignment,
  type ReviewerRecord,
} from '@/lib/reviewerProfiles';
import { formatDate, getFormTypeName, isDueSoon, isOverdue } from '@/lib/utils';

type ReviewerMailAction = 'assigned' | 'overdue';

function buildReviewerNotificationProtocols(
  assignments: ReviewerProtocolAssignment[],
  reviewer: ReviewerRecord
) {
  const protocolMap = new Map<string, {
    monthId: string;
    weekId: string;
    spup_rec_code: string;
    principal_investigator: string;
    research_title: string;
    course_program: string;
    e_link: string;
    reviewers: Array<{
      id: string;
      name: string;
      form_type: string;
      due_date: string;
      status: string;
    }>;
  }>();

  for (const assignment of assignments) {
    const protocol = assignment.protocol;
    const protocolKey = protocol._path || `${protocol.monthId}/${protocol.weekId}/${protocol.id}`;
    const payloadProtocol = protocolMap.get(protocolKey) ?? {
      monthId: protocol.monthId,
      weekId: protocol.weekId,
      spup_rec_code: protocol.spup_rec_code || protocol.id,
      principal_investigator: protocol.principal_investigator || '',
      research_title: protocol.research_title || protocol.protocol_name || 'Untitled protocol',
      course_program: protocol.course_program || protocol.academic_level || '',
      e_link: protocol.e_link || protocol.protocol_file || '',
      reviewers: [],
    };

    payloadProtocol.reviewers.push({
      id: reviewer.id,
      name: reviewer.name,
      form_type: assignment.formType,
      due_date: assignment.dueDate,
      status: assignment.status,
    });
    protocolMap.set(protocolKey, payloadProtocol);
  }

  return Array.from(protocolMap.values());
}

function getWeekHref(protocol: Protocol): string {
  return `/admin/protocols/months/${encodeURIComponent(protocol.monthId)}/weeks/${encodeURIComponent(protocol.weekId)}`;
}

function getAssignmentDisplayStatus(assignment: ReviewerProtocolAssignment): {
  label: string;
  className: string;
} {
  if (assignment.status === 'Completed') {
    return { label: 'Completed', className: 'bg-green-100 text-green-800' };
  }

  if (assignment.dueDate && isOverdue(assignment.dueDate)) {
    return { label: 'Overdue', className: 'bg-red-100 text-red-800' };
  }

  if (assignment.dueDate && isDueSoon(assignment.dueDate)) {
    return { label: 'Due Soon', className: 'bg-amber-100 text-amber-800' };
  }

  return { label: 'In Progress', className: 'bg-blue-100 text-blue-800' };
}

export default function ReviewerProfilePage() {
  const params = useParams<{ reviewerId: string }>();
  const reviewerId = params.reviewerId;
  const [reviewer, setReviewer] = useState<ReviewerRecord | null>(null);
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendingMailAction, setSendingMailAction] = useState<ReviewerMailAction | null>(null);
  const [mailNotice, setMailNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const loadProfile = async () => {
      if (!reviewerId) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/admin/reviewers/${encodeURIComponent(reviewerId)}`);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || 'Reviewer not found.');
        }
        setReviewer(payload.reviewer as ReviewerRecord);
        setProtocols(payload.protocols as Protocol[]);
      } catch (profileError) {
        console.error('Failed to load reviewer profile:', profileError);
        setError('Failed to load this reviewer profile. Please refresh and try again.');
      } finally {
        setLoading(false);
      }
    };

    loadProfile();
  }, [reviewerId]);

  const assignments = useMemo(() => {
    if (!reviewer) {
      return [];
    }

    return getReviewerAssignments(protocols, reviewer).sort((left, right) => {
      const leftCompleted = left.status === 'Completed';
      const rightCompleted = right.status === 'Completed';

      if (leftCompleted !== rightCompleted) {
        return leftCompleted ? 1 : -1;
      }

      if (!left.dueDate) {
        return 1;
      }

      if (!right.dueDate) {
        return -1;
      }

      return left.dueDate.localeCompare(right.dueDate);
    });
  }, [protocols, reviewer]);
  const stats = useMemo(() => reviewer
    ? getReviewerAssignmentStats(protocols, reviewer)
    : { total: 0, completed: 0, pending: 0, overdue: 0, dueSoon: 0 }, [protocols, reviewer]);
  const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  const sendReviewerMail = async (action: ReviewerMailAction) => {
    if (!reviewer) {
      return;
    }

    if (!reviewer.email) {
      setMailNotice({ type: 'error', message: 'Add an email address to this reviewer before sending.' });
      return;
    }

    const selectedAssignments = action === 'overdue'
      ? assignments.filter((assignment) => (
          assignment.status !== 'Completed' &&
          Boolean(assignment.dueDate) &&
          isOverdue(assignment.dueDate)
        ))
      : assignments;

    if (selectedAssignments.length === 0) {
      setMailNotice({
        type: 'error',
        message: action === 'overdue'
          ? 'This reviewer has no unfinished overdue reviews.'
          : 'This reviewer has no assigned protocols to send.',
      });
      return;
    }

    const confirmed = window.confirm(
      action === 'overdue'
        ? `Send a Reminder email to ${reviewer.name} containing ${selectedAssignments.length} unfinished overdue review${selectedAssignments.length === 1 ? '' : 's'}?`
        : `Send ${reviewer.name} an email containing all ${selectedAssignments.length} assigned review${selectedAssignments.length === 1 ? '' : 's'}?`
    );

    if (!confirmed) {
      return;
    }

    setSendingMailAction(action);
    setMailNotice(null);

    try {
      const notificationType = action === 'overdue' ? 'reminder' : 'assignment';
      const periodLabel = action === 'overdue'
        ? `Overdue reviews for ${reviewer.name}`
        : `Assigned protocols for ${reviewer.name}`;
      const response = await fetch('/api/admin/review-notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: 'month',
          monthDocumentId: selectedAssignments[0].protocol.monthId,
          periodLabel,
          notificationType,
          protocols: buildReviewerNotificationProtocols(selectedAssignments, reviewer),
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send reviewer email.');
      }

      if (!Array.isArray(result.sent) || result.sent.length === 0) {
        const reason = result.skipped?.[0]?.reason || result.failed?.[0]?.error || 'No email was sent.';
        throw new Error(reason);
      }

      setMailNotice({
        type: 'success',
        message: action === 'overdue'
          ? `Overdue reminder sent to ${reviewer.email} for ${selectedAssignments.length} review${selectedAssignments.length === 1 ? '' : 's'}.`
          : `Assigned protocols sent to ${reviewer.email} for ${selectedAssignments.length} review${selectedAssignments.length === 1 ? '' : 's'}.`,
      });
    } catch (mailError) {
      console.error('Failed to send profile reviewer email:', mailError);
      setMailNotice({
        type: 'error',
        message: mailError instanceof Error ? mailError.message : 'Failed to send reviewer email.',
      });
    } finally {
      setSendingMailAction(null);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 p-10 text-gray-600">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-gray-200 border-t-green-700" />
        Loading reviewer profile...
      </div>
    );
  }

  if (error || !reviewer) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-800">
          <p className="font-semibold">Unable to open reviewer profile</p>
          <p className="mt-1 text-sm">{error || 'Reviewer not found.'}</p>
          <Link href="/admin/reviewers" className="mt-4 inline-flex font-medium text-red-900 underline">
            Back to reviewers
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div>
        <Link href="/admin/reviewers" className="text-sm font-medium text-green-700 hover:text-green-900">
          &larr; Back to reviewers
        </Link>
      </div>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 bg-gradient-to-r from-green-800 to-green-700 px-6 py-7 text-white">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/15 text-2xl font-semibold ring-1 ring-white/30">
                {reviewer.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium text-green-100">Reviewer profile</p>
                <h1 className="mt-1 text-2xl font-semibold">{reviewer.name}</h1>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-green-100">
                  <span className="font-mono">{reviewer.id}</span>
                  <span aria-hidden="true">&bull;</span>
                  {reviewer.email ? (
                    <a href={`mailto:${reviewer.email}`} className="font-medium hover:text-white hover:underline">
                      {reviewer.email}
                    </a>
                  ) : (
                    <span>No email address</span>
                  )}
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-black/10 px-4 py-3 sm:text-right">
              <p className="text-xs uppercase tracking-wide text-green-100">Completion rate</p>
              <p className="mt-1 text-2xl font-semibold">{completionRate}%</p>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-200 bg-gray-50 px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-medium text-gray-900">Email this reviewer</p>
              <p className="mt-1 text-sm text-gray-500">
                Send only this reviewer&apos;s assigned protocols, or only their unfinished overdue reviews.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => sendReviewerMail('assigned')}
                disabled={!reviewer.email || assignments.length === 0 || sendingMailAction !== null}
                className="rounded-md border border-green-700 bg-white px-4 py-2 text-sm font-medium text-green-800 hover:bg-green-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:text-gray-400"
              >
                {sendingMailAction === 'assigned' ? 'Sending...' : 'Send Assigned Protocols'}
              </button>
              <button
                type="button"
                onClick={() => sendReviewerMail('overdue')}
                disabled={!reviewer.email || stats.overdue === 0 || sendingMailAction !== null}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {sendingMailAction === 'overdue' ? 'Sending...' : `Send Overdue Reminder (${stats.overdue})`}
              </button>
            </div>
          </div>

          {mailNotice && (
            <div
              className={`mt-4 rounded-md border px-4 py-3 text-sm ${
                mailNotice.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
              role="status"
            >
              {mailNotice.message}
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {[
          { label: 'Assigned', value: stats.total, className: 'text-gray-900' },
          { label: 'Completed', value: stats.completed, className: 'text-green-700' },
          { label: 'Pending', value: stats.pending, className: 'text-blue-700' },
          { label: 'Due Soon', value: stats.dueSoon, className: 'text-amber-700' },
          { label: 'Overdue', value: stats.overdue, className: 'text-red-700' },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-gray-500">{item.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${item.className}`}>{item.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-gray-900">Assigned Protocol Reviews</h2>
          <p className="mt-1 text-sm text-gray-500">All protocol assignments matched by reviewer ID or reviewer name.</p>
        </div>

        {assignments.length === 0 ? (
          <div className="px-6 py-12 text-center text-gray-500">
            No protocol reviews are currently assigned to this reviewer.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Protocol</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Period</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Form</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Due Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-700">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {assignments.map((assignment, index) => {
                  const status = getAssignmentDisplayStatus(assignment);
                  const protocol = assignment.protocol;

                  return (
                    <tr key={`${protocol._path}-${assignment.formType}-${index}`} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{protocol.spup_rec_code || protocol.id}</p>
                        <p className="mt-1 max-w-md text-xs text-gray-500">{protocol.research_title || protocol.protocol_name}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {formatMonthLabel(protocol.monthId)}<br />
                        <span className="text-xs">{formatWeekLabel(protocol.weekId)}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">{getFormTypeName(assignment.formType)}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {assignment.dueDate ? formatDate(assignment.dueDate) : 'No date set'}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${status.className}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <Link href={getWeekHref(protocol)} className="font-medium text-blue-700 hover:text-blue-900">
                          Open week
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
