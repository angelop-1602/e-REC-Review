import 'server-only';

import type { RowDataPacket } from 'mysql2/promise';
import { queryRows } from './db';
import { finiteNumber } from './values';

export interface MysqlDashboardSummary {
  protocols: { total: number; completed: number; inProgress: number };
  assignments: { total: number; completed: number; pending: number; overdue: number };
  reviewers: { total: number; active: number };
}

interface DashboardRow extends RowDataPacket {
  protocol_total: number;
  protocol_completed: number;
  assignment_total: number;
  assignment_completed: number;
  assignment_overdue: number;
  reviewer_total: number;
  reviewer_active: number;
}

export async function getDashboardSummary(): Promise<MysqlDashboardSummary> {
  const rows = await queryRows<DashboardRow>(`
    SELECT
      (SELECT COUNT(*) FROM protocols WHERE deleted_at IS NULL) AS protocol_total,
      (SELECT COUNT(*) FROM protocols WHERE deleted_at IS NULL AND status = 'completed') AS protocol_completed,
      (SELECT COUNT(*) FROM protocol_reviewer_assignments WHERE deleted_at IS NULL) AS assignment_total,
      (SELECT COUNT(*) FROM protocol_reviewer_assignments WHERE deleted_at IS NULL AND status = 'completed') AS assignment_completed,
      (SELECT COUNT(*) FROM protocol_reviewer_assignments
        WHERE deleted_at IS NULL AND status <> 'completed' AND due_date < UTC_DATE()) AS assignment_overdue,
      (SELECT COUNT(*) FROM reviewers WHERE deleted_at IS NULL) AS reviewer_total,
      (SELECT COUNT(*) FROM reviewers WHERE deleted_at IS NULL AND is_active = TRUE) AS reviewer_active
  `);
  const row = rows[0];
  const protocolTotal = finiteNumber(row?.protocol_total);
  const protocolCompleted = finiteNumber(row?.protocol_completed);
  const assignmentTotal = finiteNumber(row?.assignment_total);
  const assignmentCompleted = finiteNumber(row?.assignment_completed);

  return {
    protocols: {
      total: protocolTotal,
      completed: protocolCompleted,
      inProgress: protocolTotal - protocolCompleted,
    },
    assignments: {
      total: assignmentTotal,
      completed: assignmentCompleted,
      pending: assignmentTotal - assignmentCompleted,
      overdue: finiteNumber(row?.assignment_overdue),
    },
    reviewers: {
      total: finiteNumber(row?.reviewer_total),
      active: finiteNumber(row?.reviewer_active),
    },
  };
}

