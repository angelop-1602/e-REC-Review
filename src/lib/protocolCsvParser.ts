import Papa from 'papaparse';
import {
  PROTOCOL_UPLOAD_REQUIRED_HEADERS,
  PROTOCOL_UPLOAD_USED_HEADERS,
  ProtocolUploadRow,
  resolveProtocolUploadHeader,
} from './protocolCsvColumns';

const SOURCE_HEADERS_BEFORE_REVIEWERS = [
  'SPUP REC Code',
  'Research Title',
  'Lead Researcher/Group Leader/Name of Principal Investigator',
  'Course/Program',
  'Adviser',
  'Email Address',
  'Nature of Study',
  'Type of Study',
  'Study Site',
  'Specify',
  'Source of Funding',
  'Pharmaceutical Company',
  'Has the research undergone technical review/proposal defense?',
  'Has the research been submitted to another research ethics committee?',
  'PR',
  'PR2',
  'IC',
  'IACUC',
  'IACUC2',
  'EX',
  'EX2',
  'SRA',
];

const SOURCE_HEADERS_23 = [...SOURCE_HEADERS_BEFORE_REVIEWERS, 'Folder E Link'];
const SOURCE_HEADERS_24 = [...SOURCE_HEADERS_BEFORE_REVIEWERS, 'Folder', 'E Link'];

export type ProtocolCsvParseResult = {
  rows: ProtocolUploadRow[];
  sourceHadHeader: boolean;
  ignoredHeaders: string[];
};

function looksLikeHeaderRow(row: string[]): boolean {
  const resolved = new Set(row.map(resolveProtocolUploadHeader).filter(Boolean));
  return resolved.has('SPUP REC Code') && resolved.has('Research Title');
}

function sourceHeadersForDataOnly(rows: string[][]): string[] {
  const separateELinkColumn = rows.some((row) => row.length >= 24 && Boolean(row[23]?.trim()));
  return separateELinkColumn ? SOURCE_HEADERS_24 : SOURCE_HEADERS_23;
}

function cleanCell(value: unknown): string {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function cleanDocumentLink(value: string): string {
  const markdownLink = value.match(/^\[[^\]]*\]\((https?:\/\/[^)]+)\)$/i);
  return markdownLink?.[1] || value;
}

export function parseProtocolSpreadsheetText(text: string): ProtocolCsvParseResult {
  if (!text.trim()) throw new Error('Paste or file content is empty.');

  const parseResult = Papa.parse<string[]>(text, {
    delimiter: text.includes('\t') ? '\t' : '',
    skipEmptyLines: 'greedy',
  });
  const rawRows = parseResult.data
    .map((row) => row.map(cleanCell))
    .filter((row) => row.some(Boolean));

  if (rawRows.length === 0) throw new Error('No spreadsheet rows were found.');

  const sourceHadHeader = looksLikeHeaderRow(rawRows[0]);
  const sourceHeaders = sourceHadHeader
    ? rawRows[0]
    : sourceHeadersForDataOnly(rawRows);
  const dataRows = sourceHadHeader ? rawRows.slice(1) : rawRows;

  if (sourceHadHeader) {
    const recognized = new Set(sourceHeaders.map(resolveProtocolUploadHeader).filter(Boolean));
    const missing = PROTOCOL_UPLOAD_REQUIRED_HEADERS.filter((header) => !recognized.has(header));
    if (missing.length > 0) {
      throw new Error(`Missing required column${missing.length === 1 ? '' : 's'}: ${missing.join(', ')}.`);
    }
  }

  const rows = dataRows
    .filter((row) => !looksLikeHeaderRow(row))
    .map((row) => {
      const selected: ProtocolUploadRow = Object.fromEntries(
        PROTOCOL_UPLOAD_USED_HEADERS.map((header) => [header, ''])
      );

      sourceHeaders.forEach((sourceHeader, index) => {
        const targetHeader = resolveProtocolUploadHeader(sourceHeader);
        if (!targetHeader) return;

        const value = cleanCell(row[index]);
        if (value || !selected[targetHeader]) selected[targetHeader] = value;
      });

      selected['E Link'] = cleanDocumentLink(selected['E Link']);
      return selected;
    })
    .filter((row) => Object.values(row).some(Boolean));

  const ignoredHeaders = sourceHeaders
    .filter((header) => header && !resolveProtocolUploadHeader(header));

  return { rows, sourceHadHeader, ignoredHeaders };
}
