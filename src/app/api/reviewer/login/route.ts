import { NextResponse } from 'next/server';
import { findReviewerByAccess } from '@/lib/mysql';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { reviewerInput?: unknown };
    const reviewerInput = typeof body.reviewerInput === 'string' ? body.reviewerInput.trim() : '';
    if (!reviewerInput) return NextResponse.json({ error: 'Reviewer ID or name is required.' }, { status: 400 });

    const reviewer = await findReviewerByAccess(reviewerInput);
    if (!reviewer) {
      return NextResponse.json({ error: 'Reviewer ID or name not found. Please check and try again.' }, { status: 404 });
    }

    return NextResponse.json({ reviewer: { id: reviewer.id, name: reviewer.name } });
  } catch (error) {
    console.error('Reviewer login failed:', error);
    return NextResponse.json({ error: 'Unable to sign in right now.' }, { status: 500 });
  }
}
