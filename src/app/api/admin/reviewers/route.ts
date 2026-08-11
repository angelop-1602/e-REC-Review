import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2';
import { listReviewers, mysqlPool } from '@/lib/mysql';

export const runtime = 'nodejs';

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function GET() {
  try {
    const reviewers = await listReviewers();
    return NextResponse.json({
      reviewers: reviewers.map((reviewer) => ({
        id: reviewer.id,
        name: reviewer.name,
        email: reviewer.email || '',
      })),
    });
  } catch (error) {
    console.error('Failed to list reviewers:', error);
    return NextResponse.json({ error: 'Failed to load reviewers.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const id = cleanString(payload.id);
    const name = cleanString(payload.name);
    const email = cleanString(payload.email);

    if (!id || !name) {
      return NextResponse.json({ error: 'Reviewer ID and name are required.' }, { status: 400 });
    }
    if (id.length > 64) {
      return NextResponse.json({ error: 'Reviewer ID must be 64 characters or fewer.' }, { status: 400 });
    }
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 });
    }

    const [result] = await mysqlPool.execute<ResultSetHeader>(`
      INSERT INTO reviewers (access_code, full_name, email)
      VALUES (?, ?, NULLIF(?, ''))
    `, [id, name, email]);

    return NextResponse.json({ reviewer: { id, name, email }, databaseId: result.insertId }, { status: 201 });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ER_DUP_ENTRY') {
      return NextResponse.json(
        { error: 'That reviewer ID or email already belongs to a current or archived reviewer.' },
        { status: 409 }
      );
    }
    console.error('Failed to create reviewer:', error);
    return NextResponse.json({ error: 'Failed to create reviewer.' }, { status: 500 });
  }
}
