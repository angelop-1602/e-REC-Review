import { NextRequest, NextResponse } from 'next/server';
import { getNotificationSettings, saveNotificationSettings } from '@/lib/mysql';
import type { MysqlNotificationSettingsDto } from '@/lib/mysql';

export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json({ settings: await getNotificationSettings() });
  } catch (error) {
    console.error('Failed to load notification settings:', error);
    return NextResponse.json({ error: 'Failed to load notification settings.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    const frequency = payload.frequency;
    const threshold = Number(payload.dueSoonThreshold);
    if (frequency !== 'daily' && frequency !== 'weekly' && frequency !== 'twice-weekly') {
      return NextResponse.json({ error: 'Invalid reminder frequency.' }, { status: 400 });
    }
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 14) {
      return NextResponse.json({ error: 'Due-soon threshold must be between 1 and 14 days.' }, { status: 400 });
    }

    const currentSettings = await getNotificationSettings();
    const settings: MysqlNotificationSettingsDto = {
      enabled: payload.enabled === true,
      frequency: frequency as MysqlNotificationSettingsDto['frequency'],
      sendToReviewers: payload.sendToReviewers !== false,
      dueSoonThreshold: threshold,
      lastRun: currentSettings.lastRun,
    };
    await saveNotificationSettings(settings);

    return NextResponse.json({
      settings,
    });
  } catch (error) {
    console.error('Failed to save notification settings:', error);
    return NextResponse.json({ error: 'Failed to save notification settings.' }, { status: 500 });
  }
}
