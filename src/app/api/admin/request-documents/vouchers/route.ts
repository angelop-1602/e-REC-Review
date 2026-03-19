import { NextRequest, NextResponse } from 'next/server';
import { validateGenerationPayload, type RequestDocumentsGenerationPayload } from '@/lib/requestDocuments';
import { generateVoucherDocument } from '@/lib/requestDocumentsDocx';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as RequestDocumentsGenerationPayload;
    const validationErrors = validateGenerationPayload(payload);

    if (validationErrors.length > 0) {
      return NextResponse.json({ error: validationErrors.join(' ') }, { status: 400 });
    }

    const { buffer, fileName } = await generateVoucherDocument(payload);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error('Error generating request voucher document:', error);
    return NextResponse.json({ error: 'Failed to generate the voucher document.' }, { status: 500 });
  }
}
