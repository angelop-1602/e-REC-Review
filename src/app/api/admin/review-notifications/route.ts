import { NextRequest, NextResponse } from 'next/server';
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  type DocumentReference,
} from 'firebase/firestore';
import { getMailFrom, getMailTransporter } from '@/lib/mailer';
import { getServerFirestore } from '@/lib/serverFirebase';
import { formatMonthLabel, formatWeekLabel } from '@/lib/protocols';
import { getFormTypeName } from '@/lib/utils';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface ReviewerAssignment {
  id: string;
  name: string;
  form_type?: string;
  due_date?: string;
}

interface ProtocolPayload {
  weekId?: string;
  spup_rec_code: string;
  principal_investigator?: string;
  research_title: string;
  course_program?: string;
  e_link?: string;
  reviewers: ReviewerAssignment[];
}

interface NotificationPayload {
  monthDocumentId: string;
  weekId?: string;
  scope: 'week' | 'month';
  protocols: ProtocolPayload[];
}

type MailDeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'skipped';

interface ReviewerEmailRecipient {
  id: string;
  name: string;
  email: string;
  requestedReviewerId: string;
  emailMatchSource: ReviewerEmailInfo['matchSource'];
  protocols: Array<{
    spupRecCode: string;
    researchTitle: string;
    principalInvestigator: string;
    courseProgram: string;
    formType: string;
    formName: string;
    dueDate: string;
    documentLink: string;
    weekId: string;
    weekLabel: string;
  }>;
}

interface ReviewerEmailInfo {
  id: string;
  name: string;
  email: string;
  matchSource: 'id' | 'name' | 'none';
}

interface MailBatchCounts {
  pending: number;
  sending: number;
  sent: number;
  skipped: number;
  failed: number;
}

interface MailLogItem {
  recipient: ReviewerEmailRecipient;
  logRef: DocumentReference;
  status: MailDeliveryStatus;
}

const DEFAULT_SEND_DELAY_MS = 750;
const DEFAULT_MAX_ATTEMPTS = 3;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];

  if (!rawValue) {
    return fallback;
  }

  const value = Number(rawValue);

  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function getMaxSendAttempts(): number {
  return getPositiveIntegerEnv('MAIL_RETRY_ATTEMPTS', DEFAULT_MAX_ATTEMPTS);
}

function getSendDelayMs(): number {
  return getPositiveIntegerEnv('MAIL_SEND_DELAY_MS', DEFAULT_SEND_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown mail sending error.';
}

function normalizeLookupValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase().replace(/\s+/g, ' ') : '';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getSystemUrl(request: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SYSTEM_URL ||
    new URL('/', request.url).origin
  );
}

function validatePayload(payload: unknown): NotificationPayload {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Notification payload is required.');
  }

  const value = payload as Partial<NotificationPayload>;

  if (!isNonEmptyString(value.monthDocumentId)) {
    throw new Error('monthDocumentId is required.');
  }

  if (!Array.isArray(value.protocols) || value.protocols.length === 0) {
    throw new Error('At least one uploaded protocol is required.');
  }

  const scope = value.scope === 'month' ? 'month' : 'week';

  if (scope === 'week' && !isNonEmptyString(value.weekId)) {
    throw new Error('weekId is required for week notifications.');
  }

  return {
    monthDocumentId: value.monthDocumentId.trim(),
    weekId: isNonEmptyString(value.weekId) ? value.weekId.trim() : undefined,
    scope,
    protocols: value.protocols,
  };
}

async function getReviewerEmailMap(assignments: Array<{ id: string; name?: string }>) {
  const db = getServerFirestore();
  const reviewers = new Map<string, ReviewerEmailInfo>();
  const requestedReviewers = new Map<string, { id: string; name: string }>();

  for (const assignment of assignments) {
    if (!isNonEmptyString(assignment.id)) {
      continue;
    }

    const reviewerId = assignment.id.trim();
    requestedReviewers.set(reviewerId, {
      id: reviewerId,
      name: isNonEmptyString(assignment.name) ? assignment.name.trim() : reviewerId,
    });
  }

  const reviewerSnapshot = await getDocs(collection(db, 'reviewers'));
  const reviewersById = new Map<string, ReviewerEmailInfo>();
  const reviewersByName = new Map<string, ReviewerEmailInfo>();

  reviewerSnapshot.forEach((reviewerDoc) => {
    const reviewerData = reviewerDoc.data();
    const reviewerInfo: ReviewerEmailInfo = {
      id: reviewerDoc.id,
      name: isNonEmptyString(reviewerData.name) ? reviewerData.name.trim() : reviewerDoc.id,
      email: isNonEmptyString(reviewerData.email) ? reviewerData.email.trim() : '',
      matchSource: 'id',
    };
    const normalizedId = normalizeLookupValue(reviewerDoc.id);
    const normalizedName = normalizeLookupValue(reviewerInfo.name);

    if (normalizedId) {
      reviewersById.set(normalizedId, reviewerInfo);
    }

    if (normalizedName) {
      const existingReviewer = reviewersByName.get(normalizedName);

      if (!existingReviewer || (!existingReviewer.email && reviewerInfo.email)) {
        reviewersByName.set(normalizedName, reviewerInfo);
      }
    }
  });

  for (const requestedReviewer of requestedReviewers.values()) {
    const normalizedId = normalizeLookupValue(requestedReviewer.id);
    const normalizedName = normalizeLookupValue(requestedReviewer.name);
    const matchedById = reviewersById.get(normalizedId);
    const matchedByIdAsName = reviewersByName.get(normalizedId);
    const matchedByName = reviewersByName.get(normalizedName) || reviewersById.get(normalizedName);
    const matchedReviewer = matchedById || matchedByIdAsName || matchedByName;

    if (matchedReviewer) {
      reviewers.set(requestedReviewer.id, {
        ...matchedReviewer,
        matchSource: matchedById ? 'id' : 'name',
      });
      continue;
    }

    reviewers.set(requestedReviewer.id, {
      id: requestedReviewer.id,
      name: requestedReviewer.name,
      email: '',
      matchSource: 'none',
    });
  }

  return reviewers;
}

function buildRecipients(
  protocols: ProtocolPayload[],
  reviewerEmailMap: Map<string, ReviewerEmailInfo>,
  fallbackWeekId?: string
): ReviewerEmailRecipient[] {
  const recipients = new Map<string, ReviewerEmailRecipient>();

  for (const protocol of protocols) {
    for (const reviewer of protocol.reviewers ?? []) {
      if (!isNonEmptyString(reviewer.id)) {
        continue;
      }

      const reviewerId = reviewer.id.trim();
      const reviewerInfo = reviewerEmailMap.get(reviewerId);
      const reviewerName = reviewerInfo?.name || reviewer.name || reviewerId;
      const recipientId = reviewerInfo?.id || reviewerId;
      const recipient = recipients.get(recipientId) ?? {
        id: recipientId,
        name: reviewerName,
        email: reviewerInfo?.email ?? '',
        requestedReviewerId: reviewerId,
        emailMatchSource: reviewerInfo?.matchSource ?? 'none',
        protocols: [],
      };
      const formType = reviewer.form_type?.trim() ?? '';
      const weekId = protocol.weekId || fallbackWeekId || 'week';

      recipient.protocols.push({
        spupRecCode: protocol.spup_rec_code || 'N/A',
        researchTitle: protocol.research_title || 'Untitled protocol',
        principalInvestigator: protocol.principal_investigator || 'N/A',
        courseProgram: protocol.course_program || 'N/A',
        formType,
        formName: getFormTypeName(formType),
        dueDate: reviewer.due_date || 'No due date set',
        documentLink: protocol.e_link || '',
        weekId,
        weekLabel: formatWeekLabel(weekId),
      });

      recipients.set(recipientId, recipient);
    }
  }

  return Array.from(recipients.values());
}

function groupRecipientProtocolsByWeek(recipient: ReviewerEmailRecipient) {
  const weekMap = new Map<string, ReviewerEmailRecipient['protocols']>();

  for (const protocol of recipient.protocols) {
    const weekProtocols = weekMap.get(protocol.weekId) ?? [];
    weekProtocols.push(protocol);
    weekMap.set(protocol.weekId, weekProtocols);
  }

  return Array.from(weekMap.entries())
    .map(([weekId, protocols]) => ({
      weekId,
      weekLabel: protocols[0]?.weekLabel ?? formatWeekLabel(weekId),
      protocols,
    }))
    .sort((left, right) => {
      const leftNumber = Number(left.weekId.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);
      const rightNumber = Number(right.weekId.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER);

      return leftNumber - rightNumber;
    });
}

function buildEmailHtml(
  recipient: ReviewerEmailRecipient,
  systemUrl: string,
  periodLabel: string
): string {
  const weekSections = groupRecipientProtocolsByWeek(recipient).map((weekGroup) => {
    const rows = weekGroup.protocols.map((protocol) => `
      <tr>
        <td style="border:1px solid #d9e2d0;padding:8px;vertical-align:top;">${escapeHtml(protocol.spupRecCode)}</td>
        <td style="border:1px solid #d9e2d0;padding:8px;vertical-align:top;">${escapeHtml(protocol.researchTitle)}</td>
        <td style="border:1px solid #d9e2d0;padding:8px;vertical-align:top;">${escapeHtml(protocol.principalInvestigator)}</td>
        <td style="border:1px solid #d9e2d0;padding:8px;vertical-align:top;">${escapeHtml(protocol.courseProgram)}</td>
        <td style="border:1px solid #d9e2d0;padding:8px;vertical-align:top;">${escapeHtml(protocol.formName)}</td>
        <td style="border:1px solid #d9e2d0;padding:8px;vertical-align:top;">${escapeHtml(protocol.dueDate)}</td>
        <td style="border:1px solid #d9e2d0;padding:8px;vertical-align:top;">
          ${protocol.documentLink ? `<a href="${escapeHtml(protocol.documentLink)}">Open document</a>` : 'N/A'}
        </td>
      </tr>
    `).join('');

    return `
      <h3 style="margin:24px 0 8px;font-size:16px;color:#31572c;">${escapeHtml(weekGroup.weekLabel)}</h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px;">
        <thead>
          <tr style="background:#f0f7ed;">
            <th style="border:1px solid #d9e2d0;padding:8px;text-align:left;">REC Code</th>
            <th style="border:1px solid #d9e2d0;padding:8px;text-align:left;">Research Title</th>
            <th style="border:1px solid #d9e2d0;padding:8px;text-align:left;">Principal Investigator</th>
            <th style="border:1px solid #d9e2d0;padding:8px;text-align:left;">Course/Program</th>
            <th style="border:1px solid #d9e2d0;padding:8px;text-align:left;">Form</th>
            <th style="border:1px solid #d9e2d0;padding:8px;text-align:left;">Due Date</th>
            <th style="border:1px solid #d9e2d0;padding:8px;text-align:left;">Document</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }).join('');

  return `
    <div style="font-family:Arial,sans-serif;color:#1f2933;line-height:1.5;">
      <p>Dear ${escapeHtml(recipient.name)},</p>
      <p>You have been assigned protocol review work for <strong>${escapeHtml(periodLabel)}</strong>.</p>
      <p>
        System link: <a href="${escapeHtml(systemUrl)}">${escapeHtml(systemUrl)}</a><br />
        Reviewer access code: <strong>${escapeHtml(recipient.id)}</strong>
      </p>
      ${weekSections}
      <p>Please sign in to the e-REC Ethics Review System using the access code above.</p>
      <p>Thank you.</p>
    </div>
  `;
}

function buildEmailText(
  recipient: ReviewerEmailRecipient,
  systemUrl: string,
  periodLabel: string
): string {
  const protocolLines = groupRecipientProtocolsByWeek(recipient)
    .map((weekGroup) => {
      const lines = weekGroup.protocols
        .map((protocol, index) => [
          `${index + 1}. ${protocol.spupRecCode} - ${protocol.researchTitle}`,
          `   Principal Investigator: ${protocol.principalInvestigator}`,
          `   Course/Program: ${protocol.courseProgram}`,
          `   Form: ${protocol.formName}`,
          `   Due Date: ${protocol.dueDate}`,
          protocol.documentLink ? `   Document: ${protocol.documentLink}` : '',
        ].filter(Boolean).join('\n'))
        .join('\n\n');

      return `${weekGroup.weekLabel}\n${lines}`;
    })
    .join('\n\n');

  return [
    `Dear ${recipient.name},`,
    '',
    `You have been assigned protocol review work for ${periodLabel}.`,
    '',
    `System link: ${systemUrl}`,
    `Reviewer access code: ${recipient.id}`,
    '',
    protocolLines,
    '',
    'Please sign in to the e-REC Ethics Review System using the access code above.',
    '',
    'Thank you.',
  ].join('\n');
}

async function createMailBatch({
  scope,
  monthDocumentId,
  weekId,
  periodLabel,
  recipients,
  reviewerCount,
  protocolCount,
}: {
  scope: NotificationPayload['scope'];
  monthDocumentId: string;
  weekId?: string;
  periodLabel: string;
  recipients: ReviewerEmailRecipient[];
  reviewerCount: number;
  protocolCount: number;
}) {
  const db = getServerFirestore();
  const batchRef = doc(collection(db, 'mail_batches'));

  await setDoc(batchRef, {
    status: 'sending',
    scope,
    monthDocumentId,
    weekId: weekId ?? '',
    periodLabel,
    reviewerCount,
    protocolCount,
    total: recipients.length,
    pending: recipients.length,
    sending: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    source: 'review-notifications',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    startedAt: serverTimestamp(),
  });

  return batchRef;
}

async function createMailLogItems({
  batchId,
  scope,
  monthDocumentId,
  weekId,
  periodLabel,
  recipients,
}: {
  batchId: string;
  scope: NotificationPayload['scope'];
  monthDocumentId: string;
  weekId?: string;
  periodLabel: string;
  recipients: ReviewerEmailRecipient[];
}): Promise<MailLogItem[]> {
  const db = getServerFirestore();
  const logItems: MailLogItem[] = [];

  for (const recipient of recipients) {
    const logRef = doc(collection(db, 'mail_logs'));

    await setDoc(logRef, {
      batchId,
      status: 'pending',
      scope,
      monthDocumentId,
      weekId: weekId ?? '',
      periodLabel,
      requestedReviewerId: recipient.requestedReviewerId,
      reviewerId: recipient.id,
      reviewerName: recipient.name,
      email: recipient.email,
      emailMatchSource: recipient.emailMatchSource,
      protocolCount: recipient.protocols.length,
      attempts: 0,
      maxAttempts: getMaxSendAttempts(),
      messageId: '',
      lastError: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    logItems.push({
      recipient,
      logRef,
      status: 'pending',
    });
  }

  return logItems;
}

async function transitionMailLogStatus({
  batchRef,
  counts,
  item,
  nextStatus,
  updates,
}: {
  batchRef: DocumentReference;
  counts: MailBatchCounts;
  item: MailLogItem;
  nextStatus: MailDeliveryStatus;
  updates?: Record<string, unknown>;
}) {
  counts[item.status] -= 1;
  counts[nextStatus] += 1;
  item.status = nextStatus;

  await Promise.all([
    updateDoc(item.logRef, {
      status: nextStatus,
      updatedAt: serverTimestamp(),
      ...updates,
    }),
    updateDoc(batchRef, {
      ...counts,
      updatedAt: serverTimestamp(),
    }),
  ]);
}

function getCompletedBatchStatus(counts: MailBatchCounts): string {
  if (counts.failed > 0 && counts.sent === 0 && counts.skipped === 0) {
    return 'failed';
  }

  if (counts.failed > 0) {
    return 'completed_with_errors';
  }

  return 'completed';
}

async function markBatchFailed(
  batchRef: DocumentReference | null,
  logItems: MailLogItem[],
  counts: MailBatchCounts | null,
  errorMessage: string
) {
  if (!batchRef || !counts) {
    return;
  }

  for (const item of logItems) {
    if (item.status === 'sent' || item.status === 'skipped' || item.status === 'failed') {
      continue;
    }

    await transitionMailLogStatus({
      batchRef,
      counts,
      item,
      nextStatus: 'failed',
      updates: {
        lastError: errorMessage,
        failedAt: serverTimestamp(),
      },
    });
  }

  await updateDoc(batchRef, {
    status: 'failed',
    lastError: errorMessage,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function POST(request: NextRequest) {
  let batchRef: DocumentReference | null = null;
  let logItems: MailLogItem[] = [];
  let counts: MailBatchCounts | null = null;

  try {
    const payload = validatePayload(await request.json());
    const reviewerAssignments = payload.protocols.flatMap((protocol) =>
      (protocol.reviewers ?? [])
        .filter((reviewer) => isNonEmptyString(reviewer.id))
        .map((reviewer) => ({
          id: reviewer.id.trim(),
          name: isNonEmptyString(reviewer.name) ? reviewer.name.trim() : reviewer.id.trim(),
        }))
    );
    const reviewerIds = Array.from(new Set(reviewerAssignments.map((reviewer) => reviewer.id)));

    if (reviewerIds.length === 0) {
      return NextResponse.json({
        sent: [],
        skipped: [],
        failed: [],
        message: 'No reviewer assignments were found in the uploaded protocols.',
      });
    }

    const reviewerEmailMap = await getReviewerEmailMap(reviewerAssignments);
    const recipients = buildRecipients(payload.protocols, reviewerEmailMap, payload.weekId);
    const systemUrl = getSystemUrl(request);
    const monthLabel = formatMonthLabel(payload.monthDocumentId);
    const periodLabel = payload.scope === 'month'
      ? monthLabel
      : `${monthLabel} ${formatWeekLabel(payload.weekId || '')}`;
    const maxAttempts = getMaxSendAttempts();
    const sendDelayMs = getSendDelayMs();
    const sent = [];
    const skipped = [];
    const failed = [];

    batchRef = await createMailBatch({
      scope: payload.scope,
      monthDocumentId: payload.monthDocumentId,
      weekId: payload.weekId,
      periodLabel,
      recipients,
      reviewerCount: reviewerIds.length,
      protocolCount: payload.protocols.length,
    });
    logItems = await createMailLogItems({
      batchId: batchRef.id,
      scope: payload.scope,
      monthDocumentId: payload.monthDocumentId,
      weekId: payload.weekId,
      periodLabel,
      recipients,
    });
    counts = {
      pending: recipients.length,
      sending: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };

    const transporter = getMailTransporter();
    const from = getMailFrom();

    for (let index = 0; index < logItems.length; index += 1) {
      const item = logItems[index];
      const recipient = item.recipient;

      if (!recipient.email) {
        const skipReason = recipient.emailMatchSource === 'none'
          ? 'Reviewer assignment did not match a reviewer record by ID or name.'
          : 'Reviewer record has no email address.';

        skipped.push({
          reviewerId: recipient.id,
          reviewerName: recipient.name,
          protocolCount: recipient.protocols.length,
          reason: skipReason,
        });

        await transitionMailLogStatus({
          batchRef,
          counts,
          item,
          nextStatus: 'skipped',
          updates: {
            reason: skipReason,
            skippedAt: serverTimestamp(),
          },
        });
        continue;
      }

      await transitionMailLogStatus({
        batchRef,
        counts,
        item,
        nextStatus: 'sending',
        updates: {
          sendingAt: serverTimestamp(),
          attempts: 0,
          lastError: '',
        },
      });

      let messageId = '';
      let lastError = '';
      let wasSent = false;
      let attemptsUsed = 0;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        attemptsUsed = attempt;

        await updateDoc(item.logRef, {
          attempts: attempt,
          lastAttemptAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        try {
          const result = await transporter.sendMail({
            from,
            to: {
              name: recipient.name,
              address: recipient.email,
            },
            subject: `e-REC Review Assignments - ${periodLabel}`,
            html: buildEmailHtml(recipient, systemUrl, periodLabel),
            text: buildEmailText(recipient, systemUrl, periodLabel),
          });

          messageId = result.messageId;
          wasSent = true;
          break;
        } catch (error) {
          lastError = getErrorMessage(error);

          await updateDoc(item.logRef, {
            attempts: attempt,
            lastError,
            updatedAt: serverTimestamp(),
          });

          if (attempt < maxAttempts) {
            await sleep(Math.min(sendDelayMs * attempt, 5000));
          }
        }
      }

      if (wasSent) {
        sent.push({
          reviewerId: recipient.id,
          reviewerName: recipient.name,
          email: recipient.email,
          protocolCount: recipient.protocols.length,
          messageId,
          attempts: attemptsUsed,
        });

        await transitionMailLogStatus({
          batchRef,
          counts,
          item,
          nextStatus: 'sent',
          updates: {
            attempts: attemptsUsed,
            messageId,
            lastError: '',
            sentAt: serverTimestamp(),
          },
        });
      } else {
        failed.push({
          reviewerId: recipient.id,
          reviewerName: recipient.name,
          email: recipient.email,
          protocolCount: recipient.protocols.length,
          attempts: attemptsUsed,
          error: lastError || 'Unknown mail sending error.',
        });

        await transitionMailLogStatus({
          batchRef,
          counts,
          item,
          nextStatus: 'failed',
          updates: {
            attempts: attemptsUsed,
            lastError: lastError || 'Unknown mail sending error.',
            failedAt: serverTimestamp(),
          },
        });
      }

      if (index < logItems.length - 1 && sendDelayMs > 0) {
        await sleep(sendDelayMs);
      }
    }

    const status = getCompletedBatchStatus(counts);

    await updateDoc(batchRef, {
      status,
      lastError: failed[0]?.error ?? '',
      completedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return NextResponse.json({ batchId: batchRef.id, status, sent, skipped, failed });
  } catch (error) {
    const message = getErrorMessage(error);

    await markBatchFailed(batchRef, logItems, counts, message);
    console.error('Failed to send review notifications:', error);

    return NextResponse.json(
      {
        error: message,
        batchId: batchRef?.id,
      },
      { status: 400 }
    );
  }
}
