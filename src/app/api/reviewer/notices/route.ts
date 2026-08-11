import { NextResponse } from 'next/server';
import {
  getReviewerByAccessCode,
  listActiveNoticesForReviewer,
  listActiveSystemNotices,
} from '@/lib/mysql';
import { reviewerNoticeDto } from '@/app/api/reviewer/dto';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const reviewerId = new URL(request.url).searchParams.get('reviewerId')?.trim() || '';
    const reviewer = await getReviewerByAccessCode(reviewerId);
    if (!reviewer) return NextResponse.json({ error: 'Reviewer not found.' }, { status: 404 });
    const [notices, systemNotices] = await Promise.all([
      listActiveNoticesForReviewer(reviewer.internalId),
      listActiveSystemNotices(),
    ]);
    return NextResponse.json({
      notices: notices.map(reviewerNoticeDto),
      systemNotices: systemNotices.map((notice) => ({
        id: notice.internalId,
        noticeNumber: notice.noticeNumber,
        title: notice.title,
        subtitle: notice.subtitle,
        message: notice.message,
        keyPoints: notice.keyPoints,
        actionButton: notice.actionButton || null,
        publishedAt: notice.created_at,
        expiresAt: notice.expires_at,
      })),
    });
  } catch (error) {
    console.error('Failed to load reviewer notices:', error);
    return NextResponse.json({ error: 'Failed to load notices.' }, { status: 500 });
  }
}
