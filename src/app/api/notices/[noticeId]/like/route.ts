import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { findReviewerByAccess, mysqlPool } from '@/lib/mysql';

export const runtime = 'nodejs';

function parseNoticeId(value: string): number | null {
  return /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null;
}

async function getInput(request: NextRequest, noticeIdValue: string) {
  const noticeId = parseNoticeId(noticeIdValue);
  const payload = await request.json() as Record<string, unknown>;
  const reviewerCode = typeof payload.reviewerId === 'string' ? payload.reviewerId.trim() : '';
  if (!noticeId || !reviewerCode) return null;
  return { noticeId, reviewerCode };
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ noticeId: string }> }
) {
  try {
    const { noticeId } = await context.params;
    const input = await getInput(request, noticeId);
    if (!input) return NextResponse.json({ error: 'Notice and reviewer IDs are required.' }, { status: 400 });
    const reviewer = await findReviewerByAccess(input.reviewerCode);
    if (!reviewer) return NextResponse.json({ error: 'Reviewer not found.' }, { status: 404 });

    const [result] = await mysqlPool.execute<ResultSetHeader>(`
      INSERT INTO notice_likes (notice_id, reviewer_id, source_reviewer_id, liked_at)
      SELECT ?, ?, ?, CURRENT_TIMESTAMP(6)
      FROM notices
      WHERE id = ? AND deleted_at IS NULL
      ON DUPLICATE KEY UPDATE
        reviewer_id = VALUES(reviewer_id),
        liked_at = CURRENT_TIMESTAMP(6),
        deleted_at = NULL
    `, [input.noticeId, reviewer.internalId, reviewer.id, input.noticeId]);
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: 'Notice not found.' }, { status: 404 });
    }
    return NextResponse.json({ liked: true });
  } catch (error) {
    console.error('Failed to like notice:', error);
    return NextResponse.json({ error: 'Failed to like notice.' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ noticeId: string }> }
) {
  try {
    const { noticeId } = await context.params;
    const input = await getInput(request, noticeId);
    if (!input) return NextResponse.json({ error: 'Notice and reviewer IDs are required.' }, { status: 400 });
    const reviewer = await findReviewerByAccess(input.reviewerCode);
    if (!reviewer) return NextResponse.json({ error: 'Reviewer not found.' }, { status: 404 });

    await mysqlPool.execute<ResultSetHeader>(`
      UPDATE notice_likes
      SET deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP(6))
      WHERE notice_id = ? AND source_reviewer_id = ? AND deleted_at IS NULL
    `, [input.noticeId, reviewer.id]);
    return NextResponse.json({ liked: false });
  } catch (error) {
    console.error('Failed to unlike notice:', error);
    return NextResponse.json({ error: 'Failed to unlike notice.' }, { status: 500 });
  }
}
