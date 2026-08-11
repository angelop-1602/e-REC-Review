import { NextResponse } from 'next/server';
import { getReviewerByAccessCode, listReviewerAssignments } from '@/lib/mysql';
import { reviewerAssignmentDto } from '@/app/api/reviewer/dto';

export const runtime = 'nodejs';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!/^\d+$/.test(id)) return NextResponse.json({ error: 'Invalid protocol identifier.' }, { status: 400 });
    const url = new URL(request.url);
    const reviewerId = url.searchParams.get('reviewerId')?.trim() || '';
    const assignmentId = url.searchParams.get('assignmentId');
    const reviewer = await getReviewerByAccessCode(reviewerId);
    if (!reviewer) return NextResponse.json({ error: 'Reviewer not found.' }, { status: 404 });

    const assignments = await listReviewerAssignments(reviewer.internalId);
    const assignment = assignments.find((item) =>
      item.protocol.internalId === id && (!assignmentId || item.assignmentId === assignmentId)
    );
    if (!assignment) return NextResponse.json({ error: 'Protocol is not assigned to this reviewer.' }, { status: 404 });

    return NextResponse.json({ assignment: reviewerAssignmentDto(assignment) });
  } catch (error) {
    console.error('Failed to load reviewer protocol:', error);
    return NextResponse.json({ error: 'Failed to load protocol details.' }, { status: 500 });
  }
}
