import 'server-only';

import type { RowDataPacket } from 'mysql2/promise';
import { queryRows } from './db';
import type { MysqlMailBatchDto, MysqlMailDeliveryDto } from './types';
import { finiteNumber, idString, isoDateTime } from './values';

interface MailBatchRow extends RowDataPacket {
  id: string;
  legacy_id: string | null;
  status: string;
  period_label: string;
  scope: string;
  total: number;
  pending: number;
  sending: number;
  sent: number;
  skipped: number;
  failed: number;
  protocol_count: number;
  reviewer_count: number;
  created_at_value: string | null;
  updated_at_value: string | null;
  completed_at: string | null;
  last_error: string | null;
}

interface MailDeliveryRow extends RowDataPacket {
  id: string;
  legacy_id: string | null;
  batch_id: string;
  status: string;
  period_label: string;
  recipient_name: string;
  recipient_email: string;
  protocol_count: number;
  attempts: number;
  max_attempts: number;
  reason: string | null;
  last_error: string | null;
  created_at_value: string | null;
  updated_at_value: string | null;
}

export async function listMailBatches(limit = 30): Promise<MysqlMailBatchDto[]> {
  const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)));
  const rows = await queryRows<MailBatchRow>(`
    SELECT CAST(id AS CHAR) AS id, legacy_id, status, period_label, scope,
      total, pending, sending, sent, skipped, failed, protocol_count,
      reviewer_count, COALESCE(source_created_at, created_at) AS created_at_value,
      COALESCE(source_updated_at, updated_at) AS updated_at_value,
      completed_at, last_error
    FROM mail_batches
    WHERE archived_at IS NULL
    ORDER BY COALESCE(source_created_at, created_at) DESC
    LIMIT ${safeLimit}
  `);

  return rows.map((row) => ({
    id: row.legacy_id ?? idString(row.id), status: row.status,
    periodLabel: row.period_label, scope: row.scope,
    total: finiteNumber(row.total), pending: finiteNumber(row.pending),
    sending: finiteNumber(row.sending), sent: finiteNumber(row.sent),
    skipped: finiteNumber(row.skipped), failed: finiteNumber(row.failed),
    protocolCount: finiteNumber(row.protocol_count), reviewerCount: finiteNumber(row.reviewer_count),
    createdAt: isoDateTime(row.created_at_value), updatedAt: isoDateTime(row.updated_at_value),
    completedAt: isoDateTime(row.completed_at), lastError: row.last_error ?? '',
  }));
}

export async function listMailDeliveries(limit = 150): Promise<MysqlMailDeliveryDto[]> {
  const safeLimit = Math.min(500, Math.max(1, Math.trunc(limit)));
  const rows = await queryRows<MailDeliveryRow>(`
    SELECT CAST(md.id AS CHAR) AS id, md.legacy_id,
      COALESCE(mb.legacy_id, CAST(mb.id AS CHAR)) AS batch_id,
      md.status, mb.period_label, md.recipient_name, md.recipient_email,
      md.protocol_count, md.attempts, md.max_attempts, md.reason, md.last_error,
      COALESCE(md.source_created_at, md.created_at) AS created_at_value,
      COALESCE(md.source_updated_at, md.updated_at) AS updated_at_value
    FROM mail_deliveries md
    INNER JOIN mail_batches mb ON mb.id = md.mail_batch_id
    WHERE md.archived_at IS NULL
    ORDER BY COALESCE(md.source_created_at, md.created_at) DESC
    LIMIT ${safeLimit}
  `);

  return rows.map((row) => ({
    id: row.legacy_id ?? idString(row.id), batchId: row.batch_id,
    status: row.status, periodLabel: row.period_label,
    reviewerName: row.recipient_name, email: row.recipient_email,
    protocolCount: finiteNumber(row.protocol_count), attempts: finiteNumber(row.attempts),
    maxAttempts: finiteNumber(row.max_attempts), reason: row.reason ?? '',
    lastError: row.last_error ?? '', createdAt: isoDateTime(row.created_at_value),
    updatedAt: isoDateTime(row.updated_at_value),
  }));
}

