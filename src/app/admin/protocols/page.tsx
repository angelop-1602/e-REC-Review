'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import ProtocolStatusCard from '@/components/ProtocolStatusCard';
import {
  formatMonthLabel,
  getProtocolStatusCounts,
  getReviewerTotals,
  groupProtocolsByMonth,
  type MonthGroup,
  type Protocol,
  type WeekGroup,
} from '@/lib/protocols';
import { moveProtocolWeek } from '@/lib/protocolWeekTransfer';

type NoticeType = 'success' | 'error' | 'info';

interface SendSummary {
  sent: unknown[];
  skipped: unknown[];
  failed: unknown[];
}

function formatNotificationSummary(summary: SendSummary): string {
  const parts = [];

  if (summary.sent.length > 0) {
    parts.push(`sent ${summary.sent.length} reviewer email${summary.sent.length === 1 ? '' : 's'}`);
  }

  if (summary.skipped.length > 0) {
    parts.push(`skipped ${summary.skipped.length} reviewer${summary.skipped.length === 1 ? '' : 's'} without email`);
  }

  if (summary.failed.length > 0) {
    parts.push(`${summary.failed.length} email${summary.failed.length === 1 ? '' : 's'} failed`);
  }

  return parts.length > 0 ? parts.join(', ') : 'no reviewer emails were sent';
}

function getWeekHref(monthId: string, weekId: string): string {
  return `/admin/protocols/months/${encodeURIComponent(monthId)}/weeks/${encodeURIComponent(weekId)}`;
}

function getMonthDocumentId(monthInput: string): string | null {
  const match = monthInput.match(/^(\d{4})-(\d{2})$/);

  if (!match) {
    return null;
  }

  const [, year, rawMonth] = match;
  const monthIndex = Number(rawMonth) - 1;

  if (monthIndex < 0 || monthIndex > 11) {
    return null;
  }

  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(year), monthIndex, 1)));

  return `${monthName}${year}`;
}

export default function ProtocolsPage() {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [expandedMonths, setExpandedMonths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: NoticeType; message: string } | null>(null);
  const [moveTarget, setMoveTarget] = useState<{ month: MonthGroup; week: WeekGroup } | null>(null);
  const [moveMonthInput, setMoveMonthInput] = useState('');
  const [moveError, setMoveError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const fetchProtocols = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/admin/protocols', { cache: 'no-store' });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to load protocols.');
      }

      const fetchedProtocols = result.protocols as Protocol[];

      setProtocols(fetchedProtocols);
      const firstMonth = groupProtocolsByMonth(fetchedProtocols)[0]?.monthId;

      if (firstMonth) {
        setExpandedMonths((current) => current.length > 0 ? current : [firstMonth]);
      }
    } catch (fetchError) {
      console.error('Error fetching protocol hierarchy:', fetchError);
      setError('Failed to load protocols. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProtocols();
  }, []);

  const filteredProtocols = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    if (!normalizedSearch) {
      return protocols;
    }

    return protocols.filter((protocol) => {
      const reviewerText = (protocol.reviewers || [])
        .map((reviewer) => `${reviewer.id} ${reviewer.name}`)
        .join(' ')
        .toLowerCase();
      const haystack = [
        protocol.spup_rec_code,
        protocol.id,
        protocol.research_title,
        protocol.protocol_name,
        protocol.principal_investigator,
        protocol.course_program,
        reviewerText,
      ].filter(Boolean).join(' ').toLowerCase();

      return haystack.includes(normalizedSearch);
    });
  }, [protocols, searchTerm]);

  const allMonthGroups = useMemo(() => groupProtocolsByMonth(protocols), [protocols]);
  const monthGroups = useMemo(() => groupProtocolsByMonth(filteredProtocols), [filteredProtocols]);
  const statusCounts = useMemo(() => getProtocolStatusCounts(filteredProtocols), [filteredProtocols]);
  const totalWeeks = useMemo(
    () => monthGroups.reduce((sum, month) => sum + month.weeks.length, 0),
    [monthGroups]
  );
  const reviewerTotals = useMemo(() => getReviewerTotals(filteredProtocols), [filteredProtocols]);

  const toggleMonth = (monthId: string) => {
    setExpandedMonths((current) =>
      current.includes(monthId)
        ? current.filter((id) => id !== monthId)
        : [...current, monthId]
    );
  };

  const sendNotifications = async (
    scope: 'month' | 'week',
    month: MonthGroup,
    week?: WeekGroup
  ) => {
    const fullMonth = allMonthGroups.find((group) => group.monthId === month.monthId);
    const fullWeek = week
      ? fullMonth?.weeks.find((weekGroup) => weekGroup.weekId === week.weekId)
      : undefined;
    const selectedProtocols = fullWeek?.protocols ?? fullMonth?.protocols ?? [];

    if (selectedProtocols.length === 0) {
      setNotice({ type: 'info', message: 'No protocols are available for this selection.' });
      return;
    }

    const key = week ? `${month.monthId}/${week.weekId}` : month.monthId;
    setSendingKey(key);
    setNotice(null);

    try {
      const response = await fetch('/api/admin/review-notifications', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope,
          monthDocumentId: month.monthId,
          weekId: week?.weekId,
        }),
      });
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send reviewer notifications.');
      }

      setNotice({
        type: result.failed?.length > 0 ? 'error' : 'success',
        message: `${scope === 'month' ? month.monthLabel : `${month.monthLabel} ${week?.weekLabel}`}: ${formatNotificationSummary(result as SendSummary)}. Track details on the Mailing page.`,
      });
    } catch (sendError) {
      console.error('Failed to send reviewer notifications:', sendError);
      setNotice({
        type: 'error',
        message: sendError instanceof Error ? sendError.message : 'Failed to send reviewer notifications.',
      });
    } finally {
      setSendingKey(null);
    }
  };

  const openMoveWeek = (month: MonthGroup, week: WeekGroup) => {
    const fullMonth = allMonthGroups.find((group) => group.monthId === month.monthId);
    const fullWeek = fullMonth?.weeks.find((weekGroup) => weekGroup.weekId === week.weekId);

    setMoveTarget({ month: fullMonth || month, week: fullWeek || week });
    setMoveMonthInput('');
    setMoveError(null);
  };

  const closeMoveWeek = () => {
    if (moving) {
      return;
    }

    setMoveTarget(null);
    setMoveMonthInput('');
    setMoveError(null);
  };

  const handleMoveWeek = async () => {
    if (!moveTarget) {
      return;
    }

    const targetMonthId = getMonthDocumentId(moveMonthInput);

    if (!targetMonthId) {
      setMoveError('Choose a valid destination month.');
      return;
    }

    if (targetMonthId === moveTarget.month.monthId) {
      setMoveError('Choose a different destination month.');
      return;
    }

    setMoving(true);
    setMoveError(null);

    try {
      const result = await moveProtocolWeek({
        sourceMonthId: moveTarget.month.monthId,
        targetMonthId,
        weekId: moveTarget.week.weekId,
      });

      setMoveTarget(null);
      setMoveMonthInput('');
      setExpandedMonths((current) => current.includes(targetMonthId) ? current : [...current, targetMonthId]);
      setNotice({
        type: 'success',
        message: `Moved ${result.movedCount} protocol${result.movedCount === 1 ? '' : 's'} from ${moveTarget.month.monthLabel} ${moveTarget.week.weekLabel} to ${formatMonthLabel(targetMonthId)} ${moveTarget.week.weekLabel}.`,
      });
      await fetchProtocols();
    } catch (moveWeekError) {
      console.error('Failed to move protocol week:', moveWeekError);
      setMoveError(moveWeekError instanceof Error ? moveWeekError.message : 'Failed to move the week.');
    } finally {
      setMoving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded" role="alert">
          <strong className="font-bold">Error!</strong>
          <span className="block sm:inline"> {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-2">Protocol Management</h1>
        <p className="text-gray-600">
          Browse protocols by month and week. Open a week to manage its protocols, or manually notify reviewers for a week or full month.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <ProtocolStatusCard title="Protocols" count={statusCounts.total} color="blue" />
        <ProtocolStatusCard title="Months" count={monthGroups.length} color="purple" />
        <ProtocolStatusCard title="Weeks" count={totalWeeks} color="gray" />
        <ProtocolStatusCard title="Reviewer Reviews" count={reviewerTotals.completed} total={reviewerTotals.total} color="green" />
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-4 shadow-sm">
        <label htmlFor="protocol-search" className="block text-sm font-medium text-gray-700 mb-1">
          Search protocols
        </label>
        <input
          id="protocol-search"
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Search by REC code, title, PI, course, or reviewer"
          className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {notice && (
        <div className={`rounded-md px-4 py-3 text-sm ${
          notice.type === 'success'
            ? 'bg-green-50 text-green-800'
            : notice.type === 'error'
              ? 'bg-red-50 text-red-800'
              : 'bg-blue-50 text-blue-800'
        }`}>
          {notice.message}
        </div>
      )}

      {monthGroups.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center shadow-sm">
          <p className="text-gray-500">No protocols found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {monthGroups.map((month) => {
            const isExpanded = expandedMonths.includes(month.monthId);
            const monthReviewerTotals = getReviewerTotals(month.protocols);
            const monthKey = month.monthId;

            return (
              <section key={month.monthId} className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-4 py-4 bg-gray-50 border-b border-gray-200">
                  <button
                    type="button"
                    onClick={() => toggleMonth(month.monthId)}
                    className="flex items-center gap-3 text-left"
                    aria-expanded={isExpanded}
                  >
                    <span className="text-lg font-semibold text-gray-900">{isExpanded ? 'v' : '>'}</span>
                    <span>
                      <span className="block text-lg font-semibold text-gray-900">{month.monthLabel}</span>
                      <span className="block text-sm text-gray-500">
                        {month.weeks.length} week{month.weeks.length === 1 ? '' : 's'} - {month.protocols.length} protocol{month.protocols.length === 1 ? '' : 's'} - {monthReviewerTotals.completed}/{monthReviewerTotals.total} reviews completed
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => sendNotifications('month', month)}
                    disabled={sendingKey === monthKey}
                    className="self-start md:self-auto px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {sendingKey === monthKey ? 'Sending...' : 'Send Month Email'}
                  </button>
                </div>

                {isExpanded && (
                  <div className="divide-y divide-gray-100">
                    {month.weeks.map((week) => {
                      const weekReviewerTotals = getReviewerTotals(week.protocols);
                      const weekKey = `${month.monthId}/${week.weekId}`;

                      return (
                        <div key={week.weekId} className="px-4 py-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <h2 className="font-semibold text-gray-900">{week.weekLabel}</h2>
                            <p className="text-sm text-gray-500">
                              {week.protocols.length} protocol{week.protocols.length === 1 ? '' : 's'} - {weekReviewerTotals.completed}/{weekReviewerTotals.total} reviews completed
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={getWeekHref(month.monthId, week.weekId)}
                              className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Open Week
                            </Link>
                            <button
                              type="button"
                              onClick={() => openMoveWeek(month, week)}
                              className="px-4 py-2 rounded-md border border-amber-300 text-sm font-medium text-amber-800 hover:bg-amber-50"
                            >
                              Move Week
                            </button>
                            <button
                              type="button"
                              onClick={() => sendNotifications('week', month, week)}
                              disabled={sendingKey === weekKey}
                              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                            >
                              {sendingKey === weekKey ? 'Sending...' : 'Send Week Email'}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {moveTarget && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900">Move Week to Another Month</h2>
            <p className="mt-2 text-sm text-gray-600">
              Move all {moveTarget.week.protocols.length} protocol{moveTarget.week.protocols.length === 1 ? '' : 's'} in{' '}
              <strong>{moveTarget.month.monthLabel} {moveTarget.week.weekLabel}</strong>. The week number, protocol details,
              reviewers, statuses, and due dates will be preserved.
            </p>

            <div className="mt-5">
              <label htmlFor="move-week-month" className="block text-sm font-medium text-gray-700 mb-1">
                Destination month
              </label>
              <input
                id="move-week-month"
                type="month"
                value={moveMonthInput}
                onChange={(event) => {
                  setMoveMonthInput(event.target.value);
                  setMoveError(null);
                }}
                disabled={moving}
                className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50"
              />
              <p className="mt-2 text-xs text-gray-500">
                If {moveTarget.week.weekLabel} already exists in that month, these protocols will be added to it. The move stops if a duplicate protocol ID is found.
              </p>
            </div>

            {moveError && (
              <div className="mt-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
                {moveError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeMoveWeek}
                disabled={moving}
                className="px-4 py-2 rounded-md border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMoveWeek}
                disabled={moving || !moveMonthInput}
                className="px-4 py-2 rounded-md bg-amber-600 text-white text-sm font-medium hover:bg-amber-700 disabled:opacity-50"
              >
                {moving ? 'Moving Week...' : 'Move Week'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
