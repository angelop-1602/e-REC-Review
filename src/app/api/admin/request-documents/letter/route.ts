import { NextRequest, NextResponse } from 'next/server';
import { buildSummaryFromRows, validateGenerationPayload, type RequestDocumentsGenerationPayload } from '@/lib/requestDocuments';
import { generateLetterDocument } from '@/lib/requestDocumentsDocx';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as RequestDocumentsGenerationPayload;
    const validationErrors = validateGenerationPayload(payload);

    if (validationErrors.length > 0) {
      return NextResponse.json({ error: validationErrors.join(' ') }, { status: 400 });
    }

    const summary = buildSummaryFromRows(payload.rows, payload.amountPerReview);

    if (summary.length === 0) {
      return NextResponse.json(
        { error: 'No reviewer summary could be generated from the provided rows.' },
        { status: 400 }
      );
    }

    const { buffer, fileName } = await generateLetterDocument(payload, summary);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error('Error generating request letter document:', error);
    return NextResponse.json({ error: 'Failed to generate the letter document.' }, { status: 500 });
  }
}
