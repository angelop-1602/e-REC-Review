import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getNotificationSettings, listProtocols, saveNotificationSettings } from '@/lib/mysql';
import {
  getDateInTimeZone,
  isDueForReminder,
  shouldRunReminderOnDate,
  wasReminderRunToday,
} from '@/lib/reviewReminders';
import { POST as sendNotifications } from '@/app/api/admin/review-notifications/route';

export const runtime = 'nodejs';
export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  const actual = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  if (!expected || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }

  try {
    const settings = await getNotificationSettings();
    const currentDate = getDateInTimeZone(new Date(), 'Asia/Manila');

    if (!settings.enabled || !settings.sendToReviewers) {
      return NextResponse.json({ skipped: true, reason: 'Automatic reminders are disabled.' });
    }
    if (!shouldRunReminderOnDate(settings.frequency, currentDate)) {
      return NextResponse.json({ skipped: true, reason: 'Today is not scheduled for reminders.' });
    }
    if (wasReminderRunToday(settings.lastRun, currentDate, 'Asia/Manila')) {
      return NextResponse.json({ skipped: true, reason: 'Reminders already ran today.' });
    }

    const protocols = await listProtocols();
    const eligible = protocols.map((protocol) => ({
      ...protocol,
      reviewers: protocol.reviewers.filter((reviewer) =>
        reviewer.status !== 'Completed'
        && Boolean(reviewer.due_date)
        && isDueForReminder(reviewer.due_date || '', currentDate, settings.dueSoonThreshold)
      ),
    })).filter((protocol) => protocol.reviewers.length > 0);

    if (eligible.length === 0) {
      await saveNotificationSettings({ ...settings, lastRun: new Date().toISOString() });
      return NextResponse.json({ success: true, sent: 0, skipped: 0, failed: 0, eligible: 0 });
    }

    const notificationRequest = new NextRequest(new URL('/api/admin/review-notifications', request.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scope: 'month',
        notificationType: 'reminder',
        periodLabel: `Reviews due within ${settings.dueSoonThreshold} day${settings.dueSoonThreshold === 1 ? '' : 's'} of ${currentDate}`,
        protocols: eligible,
      }),
    });
    const response = await sendNotifications(notificationRequest);
    const result = await response.json();
    if (!response.ok) {
      return NextResponse.json(result, { status: response.status });
    }

    await saveNotificationSettings({ ...settings, lastRun: new Date().toISOString() });
    return NextResponse.json({
      success: true,
      eligible: eligible.reduce((sum, protocol) => sum + protocol.reviewers.length, 0),
      sent: result.sent?.length || 0,
      skipped: result.skipped?.length || 0,
      failed: result.failed?.length || 0,
      batchId: result.batchId,
      subject: 'Reminder',
    });
  } catch (error) {
    console.error('MySQL reminder cron failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Reminder cron failed.' },
      { status: 500 }
    );
  }
}
