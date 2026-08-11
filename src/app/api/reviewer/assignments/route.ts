import { NextResponse } from 'next/server';
import {
  getReviewerByAccessCode,
  listReviewerAssignments,
  updateReviewerAssignmentStatuses,
} from '@/lib/mysql';
import { reviewerAssignmentDto } from '@/app/api/reviewer/dto';

export const runtime = 'nodejs';

function validInternalId(value: unknown): value is string {
  return typeof value === 'string' && /^\d+$/.test(value);
}

export async function GET(request: Request) {
  try {
    const reviewerId = new URL(request.url).searchParams.get('reviewerId')?.trim() || '';
    if (!reviewerId) return NextResponse.json({ error: 'Reviewer ID is required.' }, { status: 400 });

    const reviewer = await getReviewerByAccessCode(reviewerId);
    if (!reviewer) return NextResponse.json({ error: 'Reviewer not found.' }, { status: 404 });
    const assignments = await listReviewerAssignments(reviewer.internalId);

    return NextResponse.json({
      reviewer: { id: reviewer.id, name: reviewer.name },
      assignments: assignments.map(reviewerAssignmentDto),
    });
  } catch (error) {
    console.error('Failed to load reviewer assignments:', error);
    return NextResponse.json({ error: 'Failed to load assigned protocols.' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as {
      reviewerId?: unknown;
      assignmentIds?: unknown;
      status?: unknown;
    };
    const reviewerId = typeof body.reviewerId === 'string' ? body.reviewerId.trim() : '';
    const assignmentIds = Array.isArray(body.assignmentIds)
      ? [...new Set(body.assignmentIds.filter(validInternalId))]
      : [];
    const status = body.status === 'Completed' ? 'Completed' : body.status === 'In Progress' ? 'In Progress' : null;

    if (!reviewerId || !status || assignmentIds.length === 0 || assignmentIds.length > 500) {
      return NextResponse.json({ error: 'Reviewer, assignment IDs, and a valid status are required.' }, { status: 400 });
    }

    const reviewer = await getReviewerByAccessCode(reviewerId);
    if (!reviewer) return NextResponse.json({ error: 'Reviewer not found.' }, { status: 404 });

    const assignments = await updateReviewerAssignmentStatuses({
      reviewerInternalId: reviewer.internalId,
      assignmentIds,
      status,
    });
    return NextResponse.json({ assignments: assignments.map(reviewerAssignmentDto) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update review status.';
    const notFound = message.toLowerCase().includes('not found');
    console.error('Failed to update reviewer assignments:', error);
    return NextResponse.json({ error: message }, { status: notFound ? 404 : 500 });
  }
}
