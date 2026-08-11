'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type MailStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'completed' | 'completed_with_errors';

interface MailBatch {
  id: string;
  status: string;
  periodLabel: string;
  scope: string;
  total: number;
  pending: number;
  sending: number;
  sent: number;
  skipped: number;
  failed: number;
  protocolCount: number;
  reviewerCount: number;
  createdAt: unknown;
  updatedAt: unknown;
  completedAt?: unknown;
  lastError?: string;
}

interface MailLog {
  id: string;
  batchId: string;
  status: string;
  periodLabel: string;
  reviewerName: string;
  email: string;
  protocolCount: number;
  attempts: number;
  maxAttempts: number;
  reason?: string;
  lastError?: string;
  createdAt: unknown;
  updatedAt: unknown;
}

function getDateValue(value: unknown): Date | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (typeof value === 'string') {
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

function formatDateTime(value: unknown): string {
  const date = getDateValue(value);

  if (!date) {
    return 'N/A';
  }

  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getStatusClasses(status: string): string {
  const normalized = status as MailStatus;

  if (normalized === 'sent' || normalized === 'completed') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  if (normalized === 'failed' || normalized === 'completed_with_errors') {
    return 'border-red-200 bg-red-50 text-red-700';
  }

  if (normalized === 'skipped') {
    return 'border-slate-200 bg-slate-50 text-slate-700';
  }

  if (normalized === 'sending') {
    return 'border-blue-200 bg-blue-50 text-blue-700';
  }

  return 'border-amber-200 bg-amber-50 text-amber-700';
}

function getBatchProgress(batch: MailBatch): number {
  if (batch.total <= 0) {
    return 0;
  }

  return Math.round(((batch.sent + batch.skipped + batch.failed) / batch.total) * 100);
}

export default function MailingPage() {
  const [batches, setBatches] = useState<MailBatch[]>([]);
  const [logs, setLogs] = useState<MailLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearNotice, setClearNotice] = useState<string | null>(null);
  const [clearingBatchId, setClearingBatchId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const loadHistory = async () => {
      try {
        const response = await fetch('/api/admin/mail-history', { cache: 'no-store' });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Failed to load mailing history.');
        if (active) {
          setBatches(result.batches as MailBatch[]);
          setLogs(result.logs as MailLog[]);
          setError(null);
          setLoading(false);
        }
      } catch (historyError) {
        console.error('Failed to load mail history:', historyError);
        if (active) {
          setError('Failed to load mailing history.');
          setLoading(false);
        }
      }
    };
    loadHistory();
    const interval = window.setInterval(loadHistory, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  const totals = useMemo(() => {
    const activeBatches = batches.filter((batch) => batch.status === 'sending' || batch.pending > 0 || batch.sending > 0);

    return {
      active: activeBatches.length,
      pending: logs.filter((log) => log.status === 'pending' || log.status === 'sending').length,
      sent: logs.filter((log) => log.status === 'sent').length,
      failed: logs.filter((log) => log.status === 'failed').length,
    };
  }, [batches, logs]);

  const clearMailBatch = async (batchToClear: MailBatch) => {
    const batchIsActive = batchToClear.status === 'sending' || batchToClear.pending > 0 || batchToClear.sending > 0;

    if (batchIsActive || clearingBatchId) {
      return;
    }

    const confirmed = window.confirm(`Clear "${batchToClear.periodLabel}" from Recent Batches? Its related email attempts will also be removed.`);

    if (!confirmed) {
      return;
    }

    setClearingBatchId(batchToClear.id);
    setError(null);
    setClearNotice(null);

    try {
      const response = await fetch('/api/admin/mail-history', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ batchId: batchToClear.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to archive mail batch.');
      setBatches((current) => current.filter((batch) => batch.id !== batchToClear.id));
      setLogs((current) => current.filter((log) => log.batchId !== batchToClear.id));
      setClearNotice(`Archived ${batchToClear.periodLabel} and its related email attempts.`);
    } catch (clearError) {
      console.error('Failed to clear mail batch:', clearError);
      setError('Failed to clear the selected mail batch.');
    } finally {
      setClearingBatchId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Mailing</h1>
          <p className="mt-1 text-sm text-slate-600">
            Live status for reviewer notification batches and individual email attempts.
          </p>
        </div>
        <Link
          href="/admin/protocols"
          className="inline-flex w-fit items-center rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Send reviewer emails
        </Link>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {clearNotice && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {clearNotice}
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: 'Active Batches', value: totals.active, className: 'text-blue-700' },
          { label: 'Pending Emails', value: totals.pending, className: 'text-amber-700' },
          { label: 'Sent Emails', value: totals.sent, className: 'text-emerald-700' },
          { label: 'Failed Emails', value: totals.failed, className: 'text-red-700' },
        ].map((metric) => (
          <div key={metric.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-slate-500">{metric.label}</p>
            <p className={`mt-2 text-2xl font-semibold ${metric.className}`}>{metric.value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Recent Batches</h2>
          <p className="mt-1 text-sm text-slate-500">Each bulk or individual send creates one batch.</p>
        </div>

        {loading ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Loading mailing activity...</div>
        ) : batches.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">No mailing batches yet.</div>
        ) : (
          <div className="divide-y divide-slate-100">
            {batches.map((batch) => {
              const progress = getBatchProgress(batch);
              const batchIsActive = batch.status === 'sending' || batch.pending > 0 || batch.sending > 0;
              const isClearing = clearingBatchId === batch.id;

              return (
                <div key={batch.id} className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_16rem_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{batch.periodLabel}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusClasses(batch.status)}`}>
                        {batch.status.replace(/_/g, ' ')}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {batch.protocolCount} protocols - {batch.reviewerCount} reviewers - started {formatDateTime(batch.createdAt)}
                    </p>
                    {batch.lastError && (
                      <p className="mt-1 truncate text-xs text-red-600">{batch.lastError}</p>
                    )}
                  </div>

                  <div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>{progress}% complete</span>
                      <span>{batch.sent} sent / {batch.pending + batch.sending} pending / {batch.failed} failed</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full bg-emerald-600" style={{ width: `${progress}%` }} />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => clearMailBatch(batch)}
                    disabled={batchIsActive || Boolean(clearingBatchId)}
                    className="inline-flex w-fit items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isClearing ? 'Clearing...' : 'Clear'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Recent Email Attempts</h2>
          <p className="mt-1 text-sm text-slate-500">Newest individual reviewer emails across uncleared batches.</p>
        </div>

        {logs.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">No individual email attempts yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Reviewer</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Period</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Protocols</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Attempts</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-500">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="max-w-xs px-4 py-3">
                      <p className="truncate font-medium text-slate-950">{log.reviewerName}</p>
                      <p className="truncate text-xs text-slate-500">{log.email || 'No email address'}</p>
                      {(log.lastError || log.reason) && (
                        <p className="mt-1 truncate text-xs text-red-600">{log.lastError || log.reason}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{log.periodLabel}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full border px-2 py-1 text-xs font-medium ${getStatusClasses(log.status)}`}>
                        {log.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{log.protocolCount}</td>
                    <td className="px-4 py-3 text-slate-600">{log.attempts}/{log.maxAttempts || 3}</td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(log.updatedAt || log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
