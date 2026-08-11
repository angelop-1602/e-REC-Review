export type ProtocolUploadRow = Record<string, string>;

export const PRINCIPAL_INVESTIGATOR_HEADER = 'Lead Researcher/Group Leader/Name of Principal Investigator';

export const PROTOCOL_UPLOAD_PROTOCOL_HEADERS = [
  'SPUP REC Code',
  'Research Title',
  PRINCIPAL_INVESTIGATOR_HEADER,
  'Course/Program',
  'Adviser',
  'E Link',
] as const;

export const PROTOCOL_UPLOAD_REVIEWER_COLUMNS = [
  { header: 'PR', formType: 'PRA1' },
  { header: 'PR2', formType: 'PRA2' },
  { header: 'IC', formType: 'ICA' },
  { header: 'IACUC', formType: 'IACUC' },
  { header: 'IACUC2', formType: 'IACUC2' },
  { header: 'EX', formType: 'CREF1' },
  { header: 'EX2', formType: 'CREF2' },
] as const;

export const PROTOCOL_UPLOAD_USED_HEADERS = [
  ...PROTOCOL_UPLOAD_PROTOCOL_HEADERS,
  ...PROTOCOL_UPLOAD_REVIEWER_COLUMNS.map(({ header }) => header),
];

export const PROTOCOL_UPLOAD_REQUIRED_HEADERS = ['SPUP REC Code', 'Research Title', 'E Link'] as const;

export const PROTOCOL_UPLOAD_HEADER_ALIASES: Record<string, string> = {
  'spup rec code': 'SPUP REC Code',
  'spup_rec_code': 'SPUP REC Code',
  'rec code': 'SPUP REC Code',
  'research title': 'Research Title',
  'principal investigator': PRINCIPAL_INVESTIGATOR_HEADER,
  'lead researcher/group leader/name of principal investigator': PRINCIPAL_INVESTIGATOR_HEADER,
  'course/program': 'Course/Program',
  'course program': 'Course/Program',
  'adviser': 'Adviser',
  'advisor': 'Adviser',
  'e link': 'E Link',
  'e-link': 'E Link',
  'folder link': 'E Link',
  'folder e link': 'E Link',
  'pr': 'PR',
  'pra1': 'PR',
  'pr2': 'PR2',
  'pra2': 'PR2',
  'ic': 'IC',
  'ica': 'IC',
  'iacuc': 'IACUC',
  'iacuc2': 'IACUC2',
  'ex': 'EX',
  'cref1': 'EX',
  'ex2': 'EX2',
  'cref2': 'EX2',
};

export function normalizeProtocolUploadHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function resolveProtocolUploadHeader(header: string): string | undefined {
  return PROTOCOL_UPLOAD_HEADER_ALIASES[normalizeProtocolUploadHeader(header)];
}
