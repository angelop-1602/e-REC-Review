import reviewerSeeds from '@/data/reviewer-seeds.json';

export const REQUEST_DOCUMENT_REQUIRED_COLUMNS = [
  'OR',
  'SPUP REC Code',
  'Principal Investigator',
  'Research Title',
  'Course/Program',
  'Reviewer #1',
  'Reviewer #2',
  'Reviewer #3',
] as const;

export const REQUEST_DOCUMENT_MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export const REQUEST_DOCUMENT_SAMPLE_CSV = `OR,SPUP REC Code,Principal Investigator,Research Title,Course/Program,Reviewer #1,Reviewer #2,Reviewer #3
2393487,SPUP_2025_00160_SR_MG,Mevic Chea S. Gacuya,Sample Research Title 1,BPEd,Mr. Rogelio Fermin,Mrs. Rita B. Daliwag,Mrs. Maria Felina B. Agbayani
2374628,SPUP_2024_0938_EX_JX,Andrei Vincent Rosales Corpuz,Sample Research Title 2,BS Pharma,Mrs. Kristine Joy O. Cortes,Mrs. Jean Sumait,Mrs. Rita B. Daliwag
2374160,SPUP_2025_00018_EX_DA,Diosalind Jeannezsa Ave,Sample Research Title 3,BS Pharma,Mrs. Kristine Joy O. Cortes,Mrs. Jean Sumait,Mrs. Rita B. Daliwag`;

export const EDUCATION_LEVEL_AMOUNTS = {
  Undergraduate: 300,
  Graduate: 500,
} as const;

export type EducationLevel = keyof typeof EDUCATION_LEVEL_AMOUNTS;

export interface ReviewerSeed {
  id: string;
  name: string;
}

export interface RequestDocumentRow {
  or: string;
  spupRecCode: string;
  principalInvestigator: string;
  researchTitle: string;
  courseProgram: string;
  reviewer1: string;
  reviewer2: string;
  reviewer3: string;
  extraFields: Record<string, string>;
}

export type RequestDocumentPreviewRow = Record<string, string>;

export interface RequestDocumentSummaryItem {
  reviewer: string;
  proposalCount: number;
  honorarium: number;
}

export interface RequestDocumentsDataset {
  headers: string[];
  previewRows: RequestDocumentPreviewRow[];
  rows: RequestDocumentRow[];
  missingColumns: string[];
  unknownReviewers: string[];
  allReviewers: string[];
  summary: RequestDocumentSummaryItem[];
}

export interface RequestDocumentsLevelPayload {
  educationLevel: EducationLevel;
  amountPerReview: number;
  headers: string[];
  previewRows: RequestDocumentPreviewRow[];
  rows: RequestDocumentRow[];
}

export interface RequestDocumentsGenerationPayload {
  dateToday: string;
  periodStartMonth: string;
  periodEndMonth: string;
  year: number;
  levels: RequestDocumentsLevelPayload[];
}

type RawCsvRow = Record<string, unknown>;

const REVIEWER_NAME_ALIASES = new Map<string, string>([
  ['Dr. Nova Domingo', 'Dr. Nova R. Domingo'],
  ['Mr. John Carlo Mampusti', 'Engr. John Carlo Mampusti'],
  ['Mr. Serge Imperio', 'Mr. Sergio G. Imperio'],
  ['Mr. Sergio Imperio', 'Mr. Sergio G. Imperio'],
  ['Mrs. Elizabeth Iquin', 'Mrs. Elizabeth C. Iquin'],
].map(([alias, canonicalName]) => [normalizeReviewerNameKey(alias), canonicalName]));

const REQUIRED_COLUMN_SET = new Set<string>(
  REQUEST_DOCUMENT_REQUIRED_COLUMNS.map((header) => normalizeHeaderName(header))
);

function normalizeHeaderName(header: string): string {
  return header.trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeValue(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function normalizeReviewerNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/[.,]/g, '').replace(/\s+/g, ' ');
}

function buildReviewerNameMap(registeredReviewerNames: string[]): Map<string, string> {
  const reviewerNameMap = new Map<string, string>();

  for (const reviewer of registeredReviewerNames) {
    const trimmedReviewer = reviewer.trim();

    if (trimmedReviewer) {
      reviewerNameMap.set(normalizeReviewerNameKey(trimmedReviewer), trimmedReviewer);
    }
  }

  for (const reviewer of getCanonicalReviewerSeeds()) {
    const trimmedReviewer = reviewer.name.trim();

    if (trimmedReviewer) {
      reviewerNameMap.set(normalizeReviewerNameKey(trimmedReviewer), trimmedReviewer);
    }
  }

  for (const [aliasKey, canonicalName] of REVIEWER_NAME_ALIASES.entries()) {
    const canonicalKey = normalizeReviewerNameKey(canonicalName);
    reviewerNameMap.set(aliasKey, reviewerNameMap.get(canonicalKey) ?? canonicalName);
  }

  return reviewerNameMap;
}

function canonicalizeReviewerName(reviewer: string, reviewerNameMap: Map<string, string>): string {
  const trimmedReviewer = reviewer.trim();

  if (!trimmedReviewer) {
    return '';
  }

  return reviewerNameMap.get(normalizeReviewerNameKey(trimmedReviewer)) ?? trimmedReviewer;
}

function orderHeaders(headers: string[]): string[] {
  const uniqueHeaders = Array.from(new Set(headers.filter(Boolean)));
  const orHeader = uniqueHeaders.find((header) => normalizeHeaderName(header) === 'or');
  const nonOrHeaders = uniqueHeaders.filter((header) => normalizeHeaderName(header) !== 'or');

  return orHeader ? [orHeader, ...nonOrHeaders] : nonOrHeaders;
}

function buildHeaderMap(headers: string[]): Map<string, string> {
  const headerMap = new Map<string, string>();

  for (const header of headers) {
    headerMap.set(normalizeHeaderName(header), header);
  }

  return headerMap;
}

function getRowValue(row: RawCsvRow, headerMap: Map<string, string>, targetHeader: string): string {
  const sourceHeader = headerMap.get(normalizeHeaderName(targetHeader));

  if (!sourceHeader) {
    return '';
  }

  return normalizeValue(row[sourceHeader]);
}

function buildPreviewRow(row: RawCsvRow, headers: string[]): RequestDocumentPreviewRow {
  const previewRow: RequestDocumentPreviewRow = {};

  for (const header of headers) {
    previewRow[header] = normalizeValue(row[header]);
  }

  return previewRow;
}

function rowHasAnyValue(row: RequestDocumentRow): boolean {
  const requiredValues = [
    row.or,
    row.spupRecCode,
    row.principalInvestigator,
    row.researchTitle,
    row.courseProgram,
    row.reviewer1,
    row.reviewer2,
    row.reviewer3,
  ];

  if (requiredValues.some((value) => value.length > 0)) {
    return true;
  }

  return Object.values(row.extraFields).some((value) => value.length > 0);
}

export function getCanonicalReviewerSeeds(): ReviewerSeed[] {
  return reviewerSeeds as ReviewerSeed[];
}

export function getCanonicalReviewerOrder(): string[] {
  return getCanonicalReviewerSeeds().map((reviewer) => reviewer.name);
}

export function calculateAmount(level: EducationLevel): number {
  return EDUCATION_LEVEL_AMOUNTS[level];
}

export function formatCurrency(amount: number): string {
  return `\u20b1${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPeso(amount: number): string {
  return `\u20b1${amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPeriodDisplay(startMonth: string, endMonth: string, year: number): string {
  if (startMonth === endMonth) {
    return `${startMonth}, ${year}`;
  }

  return `${startMonth}-${endMonth}, ${year}`;
}

export function buildRequestDocumentsDataset(
  rawHeaders: string[],
  rawRows: RawCsvRow[],
  registeredReviewerNames: string[]
): RequestDocumentsDataset {
  const headers = orderHeaders(rawHeaders.map((header) => header.trim()).filter(Boolean));
  const headerMap = buildHeaderMap(headers);
  const reviewerNameMap = buildReviewerNameMap(registeredReviewerNames);
  const missingColumns = REQUEST_DOCUMENT_REQUIRED_COLUMNS.filter(
    (requiredHeader) => !headerMap.has(normalizeHeaderName(requiredHeader))
  );
  const previewRows = rawRows.map((row) => buildPreviewRow(row, headers));

  if (missingColumns.length > 0) {
    return {
      headers,
      previewRows,
      rows: [],
      missingColumns,
      unknownReviewers: [],
      allReviewers: [],
      summary: [],
    };
  }

  const rows = rawRows
    .map((row) => {
      const normalizedRow: RequestDocumentRow = {
        or: getRowValue(row, headerMap, 'OR'),
        spupRecCode: getRowValue(row, headerMap, 'SPUP REC Code'),
        principalInvestigator: getRowValue(row, headerMap, 'Principal Investigator'),
        researchTitle: getRowValue(row, headerMap, 'Research Title'),
        courseProgram: getRowValue(row, headerMap, 'Course/Program'),
        reviewer1: canonicalizeReviewerName(getRowValue(row, headerMap, 'Reviewer #1'), reviewerNameMap),
        reviewer2: canonicalizeReviewerName(getRowValue(row, headerMap, 'Reviewer #2'), reviewerNameMap),
        reviewer3: canonicalizeReviewerName(getRowValue(row, headerMap, 'Reviewer #3'), reviewerNameMap),
        extraFields: {},
      };

      for (const header of headers) {
        if (!REQUIRED_COLUMN_SET.has(normalizeHeaderName(header))) {
          normalizedRow.extraFields[header] = normalizeValue(row[header]);
        }
      }

      return normalizedRow;
    })
    .filter((row) => rowHasAnyValue(row));

  const allReviewers = Array.from(new Set(
    rows.flatMap((row) => [row.reviewer1, row.reviewer2, row.reviewer3])
      .map((reviewer) => reviewer.trim())
      .filter(Boolean)
  ));
  const unknownReviewers = registeredReviewerNames.length === 0
    ? []
    : allReviewers.filter((reviewer) => !reviewerNameMap.has(normalizeReviewerNameKey(reviewer)));

  return {
    headers,
    previewRows,
    rows,
    missingColumns: [],
    unknownReviewers,
    allReviewers,
    summary: [],
  };
}

export function buildSummaryFromRows(
  rows: RequestDocumentRow[],
  amountPerReview: number
): RequestDocumentSummaryItem[] {
  const summaryMap = new Map<string, number>();

  for (const row of rows) {
    for (const reviewer of [row.reviewer1, row.reviewer2, row.reviewer3]) {
      const trimmedReviewer = reviewer.trim();

      if (!trimmedReviewer) {
        continue;
      }

      summaryMap.set(trimmedReviewer, (summaryMap.get(trimmedReviewer) ?? 0) + 1);
    }
  }

  return Array.from(summaryMap.entries())
    .map(([reviewer, proposalCount]) => ({
      reviewer,
      proposalCount,
      honorarium: proposalCount * amountPerReview,
    }))
    .sort((left, right) => right.proposalCount - left.proposalCount || left.reviewer.localeCompare(right.reviewer));
}

export function addSummaryToDataset(
  dataset: RequestDocumentsDataset,
  amountPerReview: number
): RequestDocumentsDataset {
  return {
    ...dataset,
    summary: buildSummaryFromRows(dataset.rows, amountPerReview),
  };
}

export function validateGenerationPayload(payload: RequestDocumentsGenerationPayload): string[] {
  const errors: string[] = [];

  if (!payload.dateToday) {
    errors.push('Date is required.');
  }

  if (!payload.periodStartMonth || !payload.periodEndMonth || !Number.isFinite(payload.year)) {
    errors.push('Period details are incomplete.');
  }

  if (!Array.isArray(payload.levels) || payload.levels.length === 0) {
    errors.push('At least one education level dataset is required.');
    return errors;
  }

  const seenLevels = new Set<EducationLevel>();

  for (const levelPayload of payload.levels) {
    if (!(levelPayload.educationLevel in EDUCATION_LEVEL_AMOUNTS)) {
      errors.push('Education level is invalid.');
      continue;
    }

    if (seenLevels.has(levelPayload.educationLevel)) {
      errors.push(`${levelPayload.educationLevel} data was submitted more than once.`);
    }

    seenLevels.add(levelPayload.educationLevel);

    if (levelPayload.amountPerReview !== EDUCATION_LEVEL_AMOUNTS[levelPayload.educationLevel]) {
      errors.push(`${levelPayload.educationLevel} amount per review is invalid.`);
    }

    if (!Array.isArray(levelPayload.headers) || levelPayload.headers.length === 0) {
      errors.push(`${levelPayload.educationLevel} preview headers are required.`);
    }

    if (!Array.isArray(levelPayload.rows) || levelPayload.rows.length === 0) {
      errors.push(`${levelPayload.educationLevel} must include at least one valid CSV row.`);
    }
  }

  return errors;
}

export function createTimestampFileName(prefix: string, extension = 'docx'): string {
  const date = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const timestamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;

  return `${prefix}_${timestamp}.${extension}`;
}
