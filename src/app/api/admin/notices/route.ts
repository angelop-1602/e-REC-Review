import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader, RowDataPacket } from 'mysql2';
import { mysqlPool } from '@/lib/mysql';

export const runtime = 'nodejs';

interface NoticeRow extends RowDataPacket {
  id: number;
  title: string;
  content: string;
  priority: string;
  published_at: Date | string;
  expires_at: Date | string | null;
  reviewer_code: string | null;
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return value.toISOString();
}

function serializeNotices(rows: NoticeRow[]) {
  const notices = new Map<number, {
    id: string;
    title: string;
    content: string;
    priority: string;
    created_at: string | null;
    expires_at: string | null;
    likes: string[];
  }>();

  for (const row of rows) {
    const notice = notices.get(row.id) || {
      id: String(row.id),
      title: row.title,
      content: row.content,
      priority: row.priority,
      created_at: toIso(row.published_at),
      expires_at: toIso(row.expires_at),
      likes: [],
    };
    if (row.reviewer_code && !notice.likes.includes(row.reviewer_code)) {
      notice.likes.push(row.reviewer_code);
    }
    notices.set(row.id, notice);
  }

  return Array.from(notices.values());
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseExpiry(value: unknown): string | null | undefined {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : `${value} 00:00:00.000000`;
}

export async function GET() {
  try {
    const [rows] = await mysqlPool.execute<NoticeRow[]>(`
      SELECT
        n.id,
        n.title,
        n.content,
        n.priority,
        n.published_at,
        n.expires_at,
        nl.source_reviewer_id AS reviewer_code
      FROM notices n
      LEFT JOIN notice_likes nl ON nl.notice_id = n.id AND nl.deleted_at IS NULL
      WHERE n.deleted_at IS NULL
      ORDER BY n.published_at DESC, n.id DESC
    `);
    return NextResponse.json({ notices: serializeNotices(rows) });
  } catch (error) {
    console.error('Failed to load notices:', error);
    return NextResponse.json({ error: 'Failed to load notices.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const title = cleanString(payload.title);
    const content = cleanString(payload.content);
    const priority = cleanString(payload.priority) || 'none';
    const expiresAt = parseExpiry(payload.expiresAt);

    if (!title || !content) {
      return NextResponse.json({ error: 'Title and content are required.' }, { status: 400 });
    }
    if (!['none', 'low', 'medium', 'high'].includes(priority)) {
      return NextResponse.json({ error: 'Invalid notice priority.' }, { status: 400 });
    }
    if (expiresAt === undefined) {
      return NextResponse.json({ error: 'Expiration date must use YYYY-MM-DD.' }, { status: 400 });
    }

    const [result] = await mysqlPool.execute<ResultSetHeader>(`
      INSERT INTO notices (title, content, priority, published_at, expires_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP(6), ?)
    `, [title, content, priority, expiresAt]);

    return NextResponse.json({ id: String(result.insertId) }, { status: 201 });
  } catch (error) {
    console.error('Failed to create notice:', error);
    return NextResponse.json({ error: 'Failed to create notice.' }, { status: 500 });
  }
}
