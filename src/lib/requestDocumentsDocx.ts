import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import JSZip from 'jszip';
import { readFile } from 'fs/promises';
import path from 'path';
import {
  createTimestampFileName,
  formatPeriodDisplay,
  formatPeso,
  type RequestDocumentSummaryItem,
  type RequestDocumentsGenerationPayload,
  type RequestDocumentsLevelPayload,
} from '@/lib/requestDocuments';

const WORD_NAMESPACE = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML_NAMESPACE = 'http://www.w3.org/XML/1998/namespace';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function ensureXmlDeclaration(xml: string): string {
  if (xml.startsWith('<?xml')) {
    return xml;
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${xml}`;
}

function getTemplatePath(fileName: string): string {
  return path.join(process.cwd(), 'templates', 'request-documents', fileName);
}

async function loadTemplateZip(fileName: string): Promise<JSZip> {
  const buffer = await readFile(getTemplatePath(fileName));
  return JSZip.loadAsync(buffer);
}

function getChildElements(node: Node): Element[] {
  const elements: Element[] = [];

  for (let index = 0; index < node.childNodes.length; index += 1) {
    const child = node.childNodes[index];

    if (child.nodeType === 1) {
      elements.push(child as Element);
    }
  }

  return elements;
}

function getElementName(element: Element): string {
  return element.tagName || element.nodeName;
}

function getParagraphText(paragraph: Element): string {
  const textNodes = paragraph.getElementsByTagName('w:t');
  let text = '';

  for (let index = 0; index < textNodes.length; index += 1) {
    text += textNodes[index].textContent ?? '';
  }

  return text;
}

function createRunElement(xmlDocument: Document, text: string, sourceRun?: Element): Element {
  const run = xmlDocument.createElementNS(WORD_NAMESPACE, 'w:r');
  const sourceRunProperties = sourceRun
    ? getChildElements(sourceRun).find((child) => getElementName(child) === 'w:rPr')
    : null;

  if (sourceRunProperties) {
    run.appendChild(sourceRunProperties.cloneNode(true));
  }

  const textElement = xmlDocument.createElementNS(WORD_NAMESPACE, 'w:t');

  if (/^\s|\s$|\s{2,}/.test(text)) {
    textElement.setAttributeNS(XML_NAMESPACE, 'xml:space', 'preserve');
  }

  textElement.appendChild(xmlDocument.createTextNode(text));
  run.appendChild(textElement);

  return run;
}

function rewriteParagraphText(paragraph: Element, text: string): void {
  const children = getChildElements(paragraph);
  const paragraphProperties = children.find((child) => getElementName(child) === 'w:pPr');
  const firstRun = children.find((child) => getElementName(child) === 'w:r');

  while (paragraph.firstChild) {
    paragraph.removeChild(paragraph.firstChild);
  }

  if (paragraphProperties) {
    paragraph.appendChild(paragraphProperties.cloneNode(true));
  }

  paragraph.appendChild(createRunElement(paragraph.ownerDocument, text, firstRun ?? undefined));
}

function insertXmlBlocksBefore(target: Element, xmlBlocks: string[]): void {
  const xmlDocument = target.ownerDocument;
  const parentNode = target.parentNode;

  if (!parentNode) {
    return;
  }

  const fragmentDocument = new DOMParser().parseFromString(
    `<root xmlns:w="${WORD_NAMESPACE}">${xmlBlocks.join('')}</root>`,
    'application/xml'
  );

  for (const block of getChildElements(fragmentDocument.documentElement)) {
    const importedNode = typeof xmlDocument.importNode === 'function'
      ? xmlDocument.importNode(block, true)
      : block.cloneNode(true);

    parentNode.insertBefore(importedNode, target);
  }
}

function removeElement(element: Element): void {
  if (element.parentNode) {
    element.parentNode.removeChild(element);
  }
}

function createParagraphXml({
  text,
  align = 'left',
  bold = false,
  font = 'Times New Roman',
  size = 21,
}: {
  text?: string;
  align?: 'left' | 'center' | 'right' | 'both';
  bold?: boolean;
  font?: string;
  size?: number;
} = {}): string {
  const safeText = escapeXml(text ?? '');
  const spacing = '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>';
  const alignment = align === 'left' ? '' : `<w:jc w:val="${align}"/>`;
  const boldXml = bold ? '<w:b/><w:bCs/>' : '';
  const preserveSpace = safeText.startsWith(' ') || safeText.endsWith(' ') ? ' xml:space="preserve"' : '';

  return `<w:p>
    <w:pPr>${spacing}${alignment}<w:rPr><w:rFonts w:ascii="${escapeXml(font)}" w:hAnsi="${escapeXml(font)}"/>${boldXml}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr></w:pPr>
    ${text !== undefined ? `<w:r><w:rPr><w:rFonts w:ascii="${escapeXml(font)}" w:hAnsi="${escapeXml(font)}"/>${boldXml}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t${preserveSpace}>${safeText}</w:t></w:r>` : ''}
  </w:p>`;
}

function calculateColumnWidths(headers: string[], preferredWidths?: number[]): number[] {
  if (preferredWidths && preferredWidths.length === headers.length) {
    return preferredWidths;
  }

  const usableWidth = 9360;
  const baseWidth = Math.floor(usableWidth / headers.length);
  const widths = headers.map(() => baseWidth);
  const remainder = usableWidth - (baseWidth * headers.length);

  if (remainder > 0) {
    widths[widths.length - 1] += remainder;
  }

  return widths;
}

function buildCellXml(
  text: string,
  width: number,
  options?: {
    bold?: boolean;
    align?: 'left' | 'center' | 'right';
    font?: string;
    size?: number;
  }
): string {
  const safeText = escapeXml(text);
  const boldXml = options?.bold ? '<w:b/><w:bCs/>' : '';
  const align = options?.align ?? 'center';
  const font = options?.font ?? 'Times New Roman';
  const size = options?.size ?? 20;
  const preserveSpace = safeText.startsWith(' ') || safeText.endsWith(' ') ? ' xml:space="preserve"' : '';

  return `<w:tc>
    <w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr>
    <w:p>
      <w:pPr><w:jc w:val="${align}"/></w:pPr>
      <w:r>
        <w:rPr><w:rFonts w:ascii="${escapeXml(font)}" w:hAnsi="${escapeXml(font)}"/>${boldXml}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>
        <w:t${preserveSpace}>${safeText}</w:t>
      </w:r>
    </w:p>
  </w:tc>`;
}

function createTableXml(
  headers: string[],
  rows: string[][],
  options?: {
    preferredWidths?: number[];
    font?: string;
    headerSize?: number;
    rowSize?: number;
    firstColumnAlign?: 'left' | 'center';
    otherColumnAlign?: 'left' | 'center' | 'right';
  }
): string {
  const widths = calculateColumnWidths(headers, options?.preferredWidths);
  const font = options?.font ?? 'Times New Roman';
  const headerSize = options?.headerSize ?? 20;
  const rowSize = options?.rowSize ?? 18;
  const firstColumnAlign = options?.firstColumnAlign ?? 'center';
  const otherColumnAlign = options?.otherColumnAlign ?? 'center';

  const gridColumns = widths.map((width) => `<w:gridCol w:w="${width}"/>`).join('');
  const headerCells = headers.map((header, index) => buildCellXml(header, widths[index], {
    bold: true,
    align: index === 0 ? firstColumnAlign : otherColumnAlign,
    font,
    size: headerSize,
  })).join('');
  const bodyRows = rows.map((row) => {
    const rowCells = row.map((value, index) => buildCellXml(value, widths[index], {
      align: index === 0 ? firstColumnAlign : otherColumnAlign,
      font,
      size: rowSize,
    })).join('');

    return `<w:tr>${rowCells}</w:tr>`;
  }).join('');

  return `<w:tbl>
    <w:tblPr>
      <w:tblStyle w:val="TableGrid"/>
      <w:tblW w:w="0" w:type="auto"/>
      <w:jc w:val="center"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="8" w:space="0" w:color="000000"/>
        <w:left w:val="single" w:sz="8" w:space="0" w:color="000000"/>
        <w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000"/>
        <w:right w:val="single" w:sz="8" w:space="0" w:color="000000"/>
        <w:insideH w:val="single" w:sz="8" w:space="0" w:color="000000"/>
        <w:insideV w:val="single" w:sz="8" w:space="0" w:color="000000"/>
      </w:tblBorders>
    </w:tblPr>
    <w:tblGrid>${gridColumns}</w:tblGrid>
    <w:tr>${headerCells}</w:tr>
    ${bodyRows}
  </w:tbl>`;
}

function formatLetterDate(dateToday: string): string {
  const date = new Date(dateToday);

  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: '2-digit',
    year: 'numeric',
  });
}

type LevelDocumentTables = RequestDocumentsLevelPayload & {
  summary: RequestDocumentSummaryItem[];
};

function buildCompleteListTable(levelPayload: RequestDocumentsLevelPayload): string[] {
  const preferredWidths = levelPayload.headers.length === 8
    ? [1152, 2160, 2592, 2880, 1728, 1728, 1728, 1728]
    : undefined;
  const rows = levelPayload.previewRows.map((row) => levelPayload.headers.map((header) => row[header] ?? ''));

  return [
    createParagraphXml({ text: `Complete List of ${levelPayload.educationLevel} Applications`, align: 'center', bold: true, size: 22 }),
    createParagraphXml(),
    createTableXml(levelPayload.headers, rows, {
      preferredWidths,
      firstColumnAlign: 'center',
      otherColumnAlign: 'center',
    }),
    createParagraphXml(),
  ];
}

function buildCompleteListTables(levels: RequestDocumentsLevelPayload[]): string[] {
  return levels.flatMap((levelPayload) => buildCompleteListTable(levelPayload));
}

function buildSummaryTable(levelPayload: LevelDocumentTables): string[] {
  return [
    createParagraphXml({ text: `Summary of ${levelPayload.educationLevel} Reviewers`, align: 'center', bold: true, size: 22 }),
    createParagraphXml(),
    createTableXml(
      [
        'Name of Reviewers',
        'Number of Required Proposals',
        `Honorarium (${formatPeso(levelPayload.amountPerReview)} Per Proposal)`,
      ],
      levelPayload.summary.map((item) => [
        item.reviewer,
        String(item.proposalCount),
        formatPeso(item.honorarium),
      ]),
      {
        preferredWidths: [3600, 2160, 2880],
        firstColumnAlign: 'left',
        otherColumnAlign: 'center',
      }
    ),
    createParagraphXml(),
  ];
}

function buildSummaryTables(levels: LevelDocumentTables[]): string[] {
  return levels.flatMap((levelPayload) => buildSummaryTable(levelPayload));
}

async function finalizeZip(zip: JSZip, xml: string): Promise<Buffer> {
  zip.file('word/document.xml', ensureXmlDeclaration(xml));
  return zip.generateAsync({ type: 'nodebuffer' });
}

function formatLevelText(levels: RequestDocumentsLevelPayload[]): string {
  const levelNames = levels.map((levelPayload) => levelPayload.educationLevel);

  if (levelNames.length <= 1) {
    return levelNames[0] ?? 'Undergraduate and Graduate';
  }

  return `${levelNames.slice(0, -1).join(', ')} and ${levelNames[levelNames.length - 1]}`;
}

function formatHonorariumRequestParagraph(levels: RequestDocumentsLevelPayload[]): string {
  if (levels.length === 1) {
    return `In this connection, may I respectfully request the honorarium of the Research Ethics Reviewers at ${formatPeso(levels[0].amountPerReview)} per review. Below is the summary of their outputs together with the honoraria due them:`;
  }

  const amounts = levels.map(
    (levelPayload) => `${formatPeso(levelPayload.amountPerReview)} per ${levelPayload.educationLevel.toLowerCase()} review`
  );

  return `In this connection, may I respectfully request the honorarium of the Research Ethics Reviewers at ${amounts.slice(0, -1).join(', ')} and ${amounts[amounts.length - 1]}. Below is the summary of their outputs together with the honoraria due them:`;
}

export async function generateLetterDocument(
  payload: RequestDocumentsGenerationPayload,
  levelSummaries: LevelDocumentTables[]
): Promise<{ fileName: string; buffer: Buffer }> {
  const zip = await loadTemplateZip('Letter_Template.docx');
  const xml = await zip.file('word/document.xml')!.async('string');
  const xmlDocument = new DOMParser().parseFromString(xml, 'application/xml');
  const body = xmlDocument.getElementsByTagName('w:body')[0];
  const paragraphs = getChildElements(body).filter((child) => getElementName(child) === 'w:p');
  const populatedLevels = levelSummaries.filter((levelPayload) => levelPayload.rows.length > 0);
  const replacements = new Map<string, string>([
    ['<<Date_Today>>', formatLetterDate(payload.dateToday)],
    ['<<Level>>', formatLevelText(populatedLevels)],
    ['<<Month_Year>>', formatPeriodDisplay(payload.periodStartMonth, payload.periodEndMonth, payload.year)],
  ]);

  for (const paragraph of paragraphs) {
    const paragraphText = getParagraphText(paragraph);

    if (paragraphText.includes('<<Complete_List_Table>>')) {
      insertXmlBlocksBefore(paragraph, buildCompleteListTables(populatedLevels));
      removeElement(paragraph);
      continue;
    }

    if (paragraphText.includes('<<Summary_Table>>')) {
      insertXmlBlocksBefore(paragraph, buildSummaryTables(populatedLevels));
      removeElement(paragraph);
      continue;
    }

    if (paragraphText.includes('<<Amount>>')) {
      rewriteParagraphText(paragraph, formatHonorariumRequestParagraph(populatedLevels));
      continue;
    }

    let nextText = paragraphText;

    for (const [placeholder, value] of replacements.entries()) {
      nextText = nextText.replaceAll(placeholder, value);
    }

    if (nextText !== paragraphText) {
      rewriteParagraphText(paragraph, nextText);
    }
  }

  return {
    fileName: createTimestampFileName('SPUP_REC_Letter'),
    buffer: await finalizeZip(zip, new XMLSerializer().serializeToString(xmlDocument)),
  };
}
