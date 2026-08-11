import { NextRequest, NextResponse } from 'next/server';
import { parseProtocolSpreadsheetText } from '@/lib/protocolCsvParser';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (typeof body?.text !== 'string') {
      return NextResponse.json({ error: 'Spreadsheet text is required.' }, { status: 400 });
    }

    return NextResponse.json(parseProtocolSpreadsheetText(body.text));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'The spreadsheet could not be processed.' },
      { status: 400 }
    );
  }
}
