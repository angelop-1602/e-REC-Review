import { NextRequest, NextResponse } from 'next/server';
import { doc, getDoc } from 'firebase/firestore';
import { getMailFrom, getMailTransporter } from '@/lib/mailer';
import { getServerFirestore } from '@/lib/serverFirebase';
import { formatMonthLabel, formatWeekLabel } from '@/lib/protocols';
import { getFormTypeName } from '@/lib/utils';

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

interface ReviewerEmailRecipient {
  id: string;
  name: string;
  email: string;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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

async function getReviewerEmailMap(reviewerIds: string[]) {
  const db = getServerFirestore();
  const reviewers = new Map<string, { name: string; email: string }>();

  await Promise.all(
    reviewerIds.map(async (reviewerId) => {
      const reviewerSnapshot = await getDoc(doc(db, 'reviewers', reviewerId));

      if (!reviewerSnapshot.exists()) {
        reviewers.set(reviewerId, { name: reviewerId, email: '' });
        return;
      }

      const reviewerData = reviewerSnapshot.data();

      reviewers.set(reviewerId, {
        name: isNonEmptyString(reviewerData.name) ? reviewerData.name.trim() : reviewerId,
        email: isNonEmptyString(reviewerData.email) ? reviewerData.email.trim() : '',
      });
    })
  );

  return reviewers;
}

function buildRecipients(
  protocols: ProtocolPayload[],
  reviewerEmailMap: Map<string, { name: string; email: string }>,
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
      const recipient = recipients.get(reviewerId) ?? {
        id: reviewerId,
        name: reviewerName,
        email: reviewerInfo?.email ?? '',
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

      recipients.set(reviewerId, recipient);
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

export async function POST(request: NextRequest) {
  try {
    const payload = validatePayload(await request.json());
    const reviewerIds = Array.from(new Set(
      payload.protocols.flatMap((protocol) =>
        (protocol.reviewers ?? [])
          .map((reviewer) => reviewer.id?.trim())
          .filter(isNonEmptyString)
      )
    ));

    if (reviewerIds.length === 0) {
      return NextResponse.json({
        sent: [],
        skipped: [],
        failed: [],
        message: 'No reviewer assignments were found in the uploaded protocols.',
      });
    }

    const reviewerEmailMap = await getReviewerEmailMap(reviewerIds);
    const recipients = buildRecipients(payload.protocols, reviewerEmailMap, payload.weekId);
    const transporter = getMailTransporter();
    const from = getMailFrom();
    const systemUrl = getSystemUrl(request);
    const monthLabel = formatMonthLabel(payload.monthDocumentId);
    const periodLabel = payload.scope === 'month'
      ? monthLabel
      : `${monthLabel} ${formatWeekLabel(payload.weekId || '')}`;
    const sent = [];
    const skipped = [];
    const failed = [];

    for (const recipient of recipients) {
      if (!recipient.email) {
        skipped.push({
          reviewerId: recipient.id,
          reviewerName: recipient.name,
          protocolCount: recipient.protocols.length,
          reason: 'No email address in reviewers collection.',
        });
        continue;
      }

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

        sent.push({
          reviewerId: recipient.id,
          reviewerName: recipient.name,
          email: recipient.email,
          protocolCount: recipient.protocols.length,
          messageId: result.messageId,
        });
      } catch (error) {
        failed.push({
          reviewerId: recipient.id,
          reviewerName: recipient.name,
          email: recipient.email,
          protocolCount: recipient.protocols.length,
          error: error instanceof Error ? error.message : 'Unknown mail sending error.',
        });
      }
    }

    return NextResponse.json({ sent, skipped, failed });
  } catch (error) {
    console.error('Failed to send review notifications:', error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send review notifications.' },
      { status: 400 }
    );
  }
}
