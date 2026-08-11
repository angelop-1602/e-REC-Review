'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReviewerNoticeDto, SystemNoticeDto } from '@/app/reviewer/types';

const priorityClasses: Record<ReviewerNoticeDto['priority'], string> = {
  high: 'border-red-500 bg-red-50 text-red-900',
  medium: 'border-orange-500 bg-orange-50 text-orange-900',
  low: 'border-blue-500 bg-blue-50 text-blue-900',
  none: 'border-gray-300 bg-gray-50 text-gray-900',
};

function formatDate(value: string | null): string {
  if (!value) return 'Never expires';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ReviewerNoticesPage() {
  const [notices, setNotices] = useState<ReviewerNoticeDto[]>([]);
  const [systemNotices, setSystemNotices] = useState<SystemNoticeDto[]>([]);
  const [reviewerId, setReviewerId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const id = localStorage.getItem('reviewerId');
    if (!id) {
      window.location.href = '/';
      return;
    }
    setReviewerId(id);

    const load = async () => {
      try {
        const response = await fetch(`/api/reviewer/notices?reviewerId=${encodeURIComponent(id)}`, { cache: 'no-store' });
        const result = await response.json() as { notices?: ReviewerNoticeDto[]; systemNotices?: SystemNoticeDto[]; error?: string };
        if (!response.ok) throw new Error(result.error || 'Failed to load notices.');
        setNotices(result.notices || []);
        setSystemNotices(result.systemNotices || []);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Failed to load notices.');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, []);

  const toggleLike = async (notice: ReviewerNoticeDto) => {
    if (!reviewerId || updating[notice.id]) return;
    setUpdating((current) => ({ ...current, [notice.id]: true }));
    setError(null);
    try {
      const response = await fetch(`/api/reviewer/notices/${encodeURIComponent(notice.id)}/like`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewerId, liked: !notice.likedByReviewer }),
      });
      const result = await response.json() as { notice?: ReviewerNoticeDto; error?: string };
      if (!response.ok || !result.notice) throw new Error(result.error || 'Failed to update like.');
      setNotices((current) => current.map((item) => item.id === notice.id ? result.notice! : item));
    } catch (likeError) {
      setError(likeError instanceof Error ? likeError.message : 'Failed to update like.');
    } finally {
      setUpdating((current) => ({ ...current, [notice.id]: false }));
    }
  };

  if (loading) return <div className="flex min-h-[24rem] items-center justify-center text-gray-600">Loading notices...</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-col justify-between gap-2 border-b pb-3 sm:flex-row sm:items-center">
        <h1 className="text-2xl font-semibold text-green-800">Notices & Announcements</h1>
        <Link href="/reviewer/dashboard" className="text-sm font-medium text-blue-700">Return to dashboard</Link>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {systemNotices.map((notice) => (
        <section key={notice.id} className="overflow-hidden rounded-xl border border-red-100 bg-white shadow-sm">
          <div className="bg-green-800 px-5 py-4 text-white">
            <p className="text-sm">Important Notice #{notice.noticeNumber}</p>
            <h2 className="text-xl font-semibold">{notice.title}</h2>
          </div>
          <div className="space-y-4 p-5">
            {notice.subtitle && <p className="font-medium text-gray-900">{notice.subtitle}</p>}
            <div className="whitespace-pre-line text-sm text-gray-700">{notice.message}</div>
            {notice.keyPoints.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-gray-700">{notice.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>}
            {notice.actionButton && <a href={notice.actionButton.href} className="inline-flex rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white">{notice.actionButton.text}</a>}
          </div>
        </section>
      ))}

      {notices.length === 0 ? (
        <div className="rounded-lg border bg-white p-8 text-center text-gray-500">No active notices.</div>
      ) : notices.map((notice) => (
        <article key={notice.id} className={`rounded-lg border-l-4 p-5 shadow-sm ${priorityClasses[notice.priority]}`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold">{notice.title}</h2>
                {notice.priority !== 'none' && <span className="rounded-full bg-white/70 px-2 py-1 text-xs font-medium capitalize">{notice.priority}</span>}
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-6">{notice.content}</p>
              <p className="mt-3 text-xs opacity-70">Expires: {formatDate(notice.expiresAt)}</p>
            </div>
            <button
              type="button"
              disabled={Boolean(updating[notice.id])}
              onClick={() => void toggleLike(notice)}
              className="shrink-0 rounded-md border bg-white px-3 py-2 text-sm font-medium disabled:opacity-50"
            >
              {notice.likedByReviewer ? 'Unlike' : 'Like'} · {notice.likeCount}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}
