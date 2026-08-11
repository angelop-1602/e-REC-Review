import 'server-only';

import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { mysqlPool, queryRows } from './db';
import type { MysqlNotificationSettingsDto } from './types';
import { booleanValue, finiteNumber, isoDateTime } from './values';

interface SettingsRow extends RowDataPacket {
  enabled: number;
  frequency: MysqlNotificationSettingsDto['frequency'];
  send_to_reviewers: number;
  due_soon_threshold: number;
  last_run_at: string | null;
}

export async function getNotificationSettings(): Promise<MysqlNotificationSettingsDto> {
  const rows = await queryRows<SettingsRow>(`
    SELECT enabled, frequency, send_to_reviewers, due_soon_threshold, last_run_at
    FROM notification_settings WHERE singleton_id = 1
  `);
  const row = rows[0];

  if (!row) {
    return { enabled: false, frequency: 'daily', sendToReviewers: true, dueSoonThreshold: 3 };
  }

  const lastRun = isoDateTime(row.last_run_at);
  return {
    enabled: booleanValue(row.enabled),
    frequency: row.frequency,
    sendToReviewers: booleanValue(row.send_to_reviewers),
    dueSoonThreshold: finiteNumber(row.due_soon_threshold, 3),
    ...(lastRun ? { lastRun } : {}),
  };
}

export async function saveNotificationSettings(settings: MysqlNotificationSettingsDto): Promise<void> {
  await mysqlPool.execute<ResultSetHeader>(`
    INSERT INTO notification_settings (
      singleton_id, enabled, frequency, send_to_reviewers,
      due_soon_threshold, last_run_at
    ) VALUES (1, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      enabled = VALUES(enabled),
      frequency = VALUES(frequency),
      send_to_reviewers = VALUES(send_to_reviewers),
      due_soon_threshold = VALUES(due_soon_threshold),
      last_run_at = VALUES(last_run_at)
  `, [
    settings.enabled,
    settings.frequency,
    settings.sendToReviewers,
    settings.dueSoonThreshold,
    settings.lastRun ? settings.lastRun.replace('T', ' ').replace('Z', '') : null,
  ]);
}

