import { NextRequest, NextResponse } from 'next/server';
import type { ResultSetHeader } from 'mysql2/promise';
import { getMailFrom, getMailTransporter } from '@/lib/mailer';
import { listProtocols, listReviewers, mysqlPool } from '@/lib/mysql';

export const runtime = 'nodejs';
export const maxDuration = 300;

type NotificationType = 'assignment' | 'reminder';

interface AssignmentPayload {
  id?: string;
  name?: string;
  status?: string;
  form_type?: string;
  due_date?: string;
}

interface ProtocolPayload {
  protocolKey?: string;
  internalId?: string;
  id?: string;
  spup_rec_code?: string;
  research_title?: string;
  protocol_name?: string;
  principal_investigator?: string;
  course_program?: string;
  e_link?: string;
  protocol_file?: string;
  monthId?: string;
  weekId?: string;
  reviewers?: AssignmentPayload[];
}

interface Recipient {
  reviewerInternalId: string;
  id: string;
  name: string;
  email: string;
  protocols: Array<{ protocol: ProtocolPayload; assignment: AssignmentPayload }>;
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function systemUrl(request: NextRequest): string {
  return (process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin).replace(/\/$/, '');
}

function emailHtml(recipient: Recipient, subject: string, url: string): string {
  const rows = recipient.protocols.map(({ protocol, assignment }) => `
    <tr>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(protocol.spup_rec_code || protocol.id)}</td>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(protocol.research_title || protocol.protocol_name)}</td>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(assignment.form_type || '')}</td>
      <td style="padding:8px;border:1px solid #ddd">${escapeHtml(assignment.due_date || 'Not set')}</td>
    </tr>`).join('');
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#1f2937">
    <h2>${escapeHtml(subject)}</h2><p>Dear ${escapeHtml(recipient.name)},</p>
    <p>${subject === 'Reminder' ? 'This is a reminder for your unfinished protocol reviews.' : 'The following protocols are assigned to you for review.'}</p>
    <table style="border-collapse:collapse;width:100%"><thead><tr><th>REC Code</th><th>Title</th><th>Form</th><th>Due Date</th></tr></thead><tbody>${rows}</tbody></table>
    <p><a href="${escapeHtml(url)}">Open the e-REC reviewer portal</a></p>
  </body></html>`;
}

function emailText(recipient: Recipient, subject: string, url: string): string {
  const rows = recipient.protocols.map(({ protocol, assignment }) =>
    `${protocol.spup_rec_code || protocol.id} | ${protocol.research_title || protocol.protocol_name} | ${assignment.form_type || ''} | Due ${assignment.due_date || 'Not set'}`
  ).join('\n');
  return `${subject}\n\nDear ${recipient.name},\n\n${rows}\n\nOpen e-REC: ${url}`;
}

async function loadPayloadProtocols(body: Record<string, unknown>): Promise<ProtocolPayload[]> {
  if (Array.isArray(body.protocols) && body.protocols.length > 0) {
    return body.protocols as ProtocolPayload[];
  }
  return listProtocols({
    monthId: typeof body.monthDocumentId === 'string' ? body.monthDocumentId : undefined,
    weekId: typeof body.weekId === 'string' ? body.weekId : undefined,
  });
}

export async function POST(request: NextRequest) {
  let batchId: string | null = null;
  try {
    const body = await request.json() as Record<string, unknown>;
    const notificationType: NotificationType = body.notificationType === 'reminder' ? 'reminder' : 'assignment';
    const subject = notificationType === 'reminder' ? 'Reminder' : 'New Protocol Review Assignment';
    const protocols = await loadPayloadProtocols(body);
    const directory = await listReviewers();
    const byIdentity = new Map<string, (typeof directory)[number]>();
    for (const reviewer of directory) {
      byIdentity.set(normalize(reviewer.id), reviewer);
      byIdentity.set(normalize(reviewer.name), reviewer);
    }

    const recipients = new Map<string, Recipient>();
    for (const protocol of protocols) {
      for (const assignment of protocol.reviewers || []) {
        if (notificationType === 'reminder' && String(assignment.status).toLowerCase() === 'completed') continue;
        const reviewer = byIdentity.get(normalize(assignment.id)) || byIdentity.get(normalize(assignment.name));
        if (!reviewer) continue;
        const current = recipients.get(reviewer.internalId) || {
          reviewerInternalId: reviewer.internalId,
          id: reviewer.id,
          name: reviewer.name,
          email: reviewer.email || '',
          protocols: [],
        };
        current.protocols.push({ protocol, assignment });
        recipients.set(reviewer.internalId, current);
      }
    }

    const periodLabel = typeof body.periodLabel === 'string' && body.periodLabel.trim()
      ? body.periodLabel.trim()
      : [body.monthDocumentId, body.weekId].filter(Boolean).join(' / ') || 'Selected protocols';
    const scope = body.scope === 'week' ? 'week' : 'month';
    const protocolCount = new Set(protocols.map((item) => item.internalId || item.protocolKey || `${item.monthId}/${item.weekId}/${item.id}`)).size;
    const [batchResult] = await mysqlPool.execute<ResultSetHeader>(`
      INSERT INTO mail_batches (
        status, scope, notification_type, subject, source, legacy_month_key,
        legacy_week_key, period_label, reviewer_count, protocol_count,
        total, pending, started_at, source_created_at, source_updated_at
      ) VALUES ('sending', ?, ?, ?, 'admin', ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
    `, [
      scope, notificationType, subject, String(body.monthDocumentId || ''), String(body.weekId || ''),
      periodLabel, recipients.size, protocolCount, recipients.size, recipients.size,
    ]);
    batchId = String(batchResult.insertId);

    const sent: Array<{ reviewerId: string; email: string }> = [];
    const skipped: Array<{ reviewerId: string; reason: string }> = [];
    const failed: Array<{ reviewerId: string; error: string }> = [];
    const transporter = getMailTransporter();
    const from = getMailFrom();
    const url = systemUrl(request);

    for (const recipient of recipients.values()) {
      const deliveryStatus = recipient.email ? 'sending' : 'skipped';
      const [deliveryResult] = await mysqlPool.execute<ResultSetHeader>(`
        INSERT INTO mail_deliveries (
          mail_batch_id, reviewer_id, requested_reviewer_id, recipient_name,
          recipient_email, email_match_source, status, subject, protocol_count,
          attempts, max_attempts, reason, sending_at, skipped_at,
          source_created_at, source_updated_at
        ) VALUES (?, ?, ?, ?, ?, 'id', ?, ?, ?, ?, 3, ?,
          CASE WHEN ? = 'sending' THEN UTC_TIMESTAMP(6) ELSE NULL END,
          CASE WHEN ? = 'skipped' THEN UTC_TIMESTAMP(6) ELSE NULL END,
          UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
      `, [
        batchId, recipient.reviewerInternalId, recipient.id, recipient.name, recipient.email,
        deliveryStatus, subject, recipient.protocols.length, recipient.email ? 1 : 0,
        recipient.email ? null : 'Reviewer has no email address.', deliveryStatus, deliveryStatus,
      ]);
      const deliveryId = String(deliveryResult.insertId);

      if (!recipient.email) {
        skipped.push({ reviewerId: recipient.id, reason: 'Reviewer has no email address.' });
        continue;
      }

      try {
        const info = await transporter.sendMail({
          from, to: { address: recipient.email, name: recipient.name }, subject,
          html: emailHtml(recipient, subject, url), text: emailText(recipient, subject, url),
        });
        await mysqlPool.execute(`
          UPDATE mail_deliveries SET status = 'sent', sent_at = UTC_TIMESTAMP(6),
            external_message_id = ?, source_updated_at = UTC_TIMESTAMP(6)
          WHERE id = ?
        `, [info.messageId || null, deliveryId]);
        sent.push({ reviewerId: recipient.id, email: recipient.email });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Email delivery failed.';
        await mysqlPool.execute(`
          UPDATE mail_deliveries SET status = 'failed', failed_at = UTC_TIMESTAMP(6),
            last_error = ?, source_updated_at = UTC_TIMESTAMP(6) WHERE id = ?
        `, [message, deliveryId]);
        failed.push({ reviewerId: recipient.id, error: message });
      }
    }

    const finalStatus = failed.length > 0 ? 'completed_with_errors' : 'completed';
    await mysqlPool.execute(`
      UPDATE mail_batches SET status = ?, pending = 0, sending = 0, sent = ?, skipped = ?, failed = ?,
        completed_at = UTC_TIMESTAMP(6), source_updated_at = UTC_TIMESTAMP(6),
        last_error = ? WHERE id = ?
    `, [finalStatus, sent.length, skipped.length, failed.length, failed[0]?.error || null, batchId]);

    return NextResponse.json({ batchId, sent, skipped, failed });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to send reviewer notifications.';
    if (batchId) {
      await mysqlPool.execute(`UPDATE mail_batches SET status = 'failed', last_error = ?, completed_at = UTC_TIMESTAMP(6) WHERE id = ?`, [message, batchId]);
    }
    console.error('Failed to send MySQL-backed notifications:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
