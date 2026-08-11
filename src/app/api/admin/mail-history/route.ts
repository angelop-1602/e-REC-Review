import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2/promise';
import { listMailBatches, listMailDeliveries, withTransaction } from '@/lib/mysql';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const [batches, logs] = await Promise.all([listMailBatches(30), listMailDeliveries(150)]);
    return NextResponse.json({ batches, logs });
  } catch (error) {
    console.error('Failed to load mail history:', error);
    return NextResponse.json({ error: 'Failed to load mailing history.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { batchId } = await request.json();
    if (!batchId) return NextResponse.json({ error: 'Batch ID is required.' }, { status: 400 });
    const archived = await withTransaction(async (connection) => {
      const [result] = await connection.execute<ResultSetHeader>(`
        UPDATE mail_batches
        SET archived_at = UTC_TIMESTAMP(6)
        WHERE (legacy_id = ? OR CAST(id AS CHAR) = ?)
          AND archived_at IS NULL AND status NOT IN ('pending', 'sending')
      `, [batchId, batchId]);
      if (!result.affectedRows) return 0;
      await connection.execute<ResultSetHeader>(`
        UPDATE mail_deliveries md
        INNER JOIN mail_batches mb ON mb.id = md.mail_batch_id
        SET md.archived_at = UTC_TIMESTAMP(6)
        WHERE (mb.legacy_id = ? OR CAST(mb.id AS CHAR) = ?) AND md.archived_at IS NULL
      `, [batchId, batchId]);
      return result.affectedRows;
    });
    if (!archived) return NextResponse.json({ error: 'Only inactive batches can be archived.' }, { status: 409 });
    return NextResponse.json({ archived: true });
  } catch (error) {
    console.error('Failed to archive mail batch:', error);
    return NextResponse.json({ error: 'Failed to archive mail batch.' }, { status: 500 });
  }
}
