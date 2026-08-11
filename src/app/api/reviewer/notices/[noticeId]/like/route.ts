import { NextResponse } from 'next/server';
import {
  getReviewerByAccessCode,
  listActiveNoticesForReviewer,
  toggleNoticeLike,
} from '@/lib/mysql';
import { reviewerNoticeDto } from '@/app/api/reviewer/dto';

export const runtime = 'nodejs';

export async function PUT(request: Request, context: { params: Promise<{ noticeId: string }> }) {
  try {
    const { noticeId } = await context.params;
    if (!/^\d+$/.test(noticeId)) return NextResponse.json({ error: 'Invalid notice identifier.' }, { status: 400 });
    const body = await request.json() as { reviewerId?: unknown; liked?: unknown };
    const reviewerId = typeof body.reviewerId === 'string' ? body.reviewerId.trim() : '';
    if (typeof body.liked !== 'boolean') {
      return NextResponse.json({ error: 'The desired like state is required.' }, { status: 400 });
    }
    const reviewer = await getReviewerByAccessCode(reviewerId);
    if (!reviewer) return NextResponse.json({ error: 'Reviewer not found.' }, { status: 404 });

    let notices = await listActiveNoticesForReviewer(reviewer.internalId);
    let notice = notices.find((item) => item.internalId === noticeId);
    if (!notice) return NextResponse.json({ error: 'Notice not found.' }, { status: 404 });
    if (notice.likedByReviewer !== body.liked) {
      await toggleNoticeLike({ noticeInternalId: noticeId, reviewerInternalId: reviewer.internalId });
      notices = await listActiveNoticesForReviewer(reviewer.internalId);
      notice = notices.find((item) => item.internalId === noticeId);
      if (!notice) return NextResponse.json({ error: 'Notice not found.' }, { status: 404 });
    }
    return NextResponse.json({ notice: reviewerNoticeDto(notice) });
  } catch (error) {
    console.error('Failed to update notice like:', error);
    return NextResponse.json({ error: 'Failed to update like.' }, { status: 500 });
  }
}
