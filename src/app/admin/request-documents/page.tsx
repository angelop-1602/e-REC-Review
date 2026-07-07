'use client';

import { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { collection, getDocs, orderBy, query } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { COLORS } from '@/lib/colors';
import {
  REQUEST_DOCUMENT_MONTHS,
  REQUEST_DOCUMENT_SAMPLE_CSV,
  buildRequestDocumentsDataset,
  buildSummaryFromRows,
  calculateAmount,
  formatCurrency,
  formatPeriodDisplay,
  type EducationLevel,
  type RequestDocumentSummaryItem,
  type RequestDocumentsDataset,
  type RequestDocumentsGenerationPayload,
} from '@/lib/requestDocuments';

type InputMode = 'file' | 'paste';

const EDUCATION_LEVELS: EducationLevel[] = ['Undergraduate', 'Graduate'];

function createEmptyDataset(): RequestDocumentsDataset {
  return {
    headers: [],
    previewRows: [],
    rows: [],
    missingColumns: [],
    unknownReviewers: [],
    allReviewers: [],
    summary: [],
  };
}

function createDatasetMap(): Record<EducationLevel, RequestDocumentsDataset> {
  return {
    Undergraduate: createEmptyDataset(),
    Graduate: createEmptyDataset(),
  };
}

function createInputModeMap(): Record<EducationLevel, InputMode> {
  return {
    Undergraduate: 'file',
    Graduate: 'file',
  };
}

function createFileMap(): Record<EducationLevel, File | null> {
  return {
    Undergraduate: null,
    Graduate: null,
  };
}

function createTextMap(): Record<EducationLevel, string> {
  return {
    Undergraduate: '',
    Graduate: '',
  };
}

function createParseErrorMap(): Record<EducationLevel, string | null> {
  return {
    Undergraduate: null,
    Graduate: null,
  };
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function getFileNameFromDisposition(headerValue: string | null, fallback: string): string {
  if (!headerValue) {
    return fallback;
  }

  const match = headerValue.match(/filename="(.+?)"/i);
  return match?.[1] ?? fallback;
}

function getParseAction(level: EducationLevel): string {
  return `parse-${level}`;
}

function createSummaryMap(
  datasets: Record<EducationLevel, RequestDocumentsDataset>
): Record<EducationLevel, RequestDocumentSummaryItem[]> {
  return {
    Undergraduate: buildSummaryFromRows(datasets.Undergraduate.rows, calculateAmount('Undergraduate')),
    Graduate: buildSummaryFromRows(datasets.Graduate.rows, calculateAmount('Graduate')),
  };
}

export default function RequestDocumentsPage() {
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1];
  const [inputModes, setInputModes] = useState<Record<EducationLevel, InputMode>>(createInputModeMap);
  const [selectedFiles, setSelectedFiles] = useState<Record<EducationLevel, File | null>>(createFileMap);
  const [csvTexts, setCsvTexts] = useState<Record<EducationLevel, string>>(createTextMap);
  const [datasets, setDatasets] = useState<Record<EducationLevel, RequestDocumentsDataset>>(createDatasetMap);
  const [parseErrors, setParseErrors] = useState<Record<EducationLevel, string | null>>(createParseErrorMap);
  const [registeredReviewers, setRegisteredReviewers] = useState<string[]>([]);
  const [loadingReviewers, setLoadingReviewers] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [dateToday, setDateToday] = useState(() => new Date().toISOString().split('T')[0]);
  const [periodStartMonth, setPeriodStartMonth] = useState<(typeof REQUEST_DOCUMENT_MONTHS)[number]>('January');
  const [periodEndMonth, setPeriodEndMonth] = useState<(typeof REQUEST_DOCUMENT_MONTHS)[number]>('March');
  const [year, setYear] = useState(currentYear);

  const periodDisplay = useMemo(
    () => formatPeriodDisplay(periodStartMonth, periodEndMonth, year),
    [periodStartMonth, periodEndMonth, year]
  );

  const summaries = useMemo(() => createSummaryMap(datasets), [datasets]);
  const levelPayloads = useMemo(
    () => EDUCATION_LEVELS
      .filter((level) => datasets[level].rows.length > 0 && datasets[level].missingColumns.length === 0)
      .map((level) => ({
        educationLevel: level,
        amountPerReview: calculateAmount(level),
        headers: datasets[level].headers,
        previewRows: datasets[level].previewRows,
        rows: datasets[level].rows,
      })),
    [datasets]
  );
  const unknownReviewers = useMemo(
    () => Array.from(new Set(
      EDUCATION_LEVELS.flatMap((level) => datasets[level].unknownReviewers)
    )).sort((left, right) => left.localeCompare(right)),
    [datasets]
  );

  const totalReviews = EDUCATION_LEVELS.reduce(
    (sum, level) => sum + summaries[level].reduce((levelSum, item) => levelSum + item.proposalCount, 0),
    0
  );
  const totalHonorarium = EDUCATION_LEVELS.reduce(
    (sum, level) => sum + summaries[level].reduce((levelSum, item) => levelSum + item.honorarium, 0),
    0
  );
  const canGenerate = levelPayloads.length > 0;

  useEffect(() => {
    const loadReviewers = async () => {
      try {
        setLoadingReviewers(true);
        const reviewersQuery = query(collection(db, 'reviewers'), orderBy('name'));
        const snapshot = await getDocs(reviewersQuery);
        const names = snapshot.docs
          .map((reviewerDoc) => {
            const name = reviewerDoc.data().name;
            return typeof name === 'string' ? name.trim() : '';
          })
          .filter(Boolean);

        setRegisteredReviewers(names);
      } catch (error) {
        console.error('Failed to load reviewers for request documents:', error);
        setActionError('Failed to load reviewers from Firestore. Reviewer validation warnings may be incomplete.');
      } finally {
        setLoadingReviewers(false);
      }
    };

    loadReviewers();
  }, []);

  const setLevelParseError = (level: EducationLevel, message: string | null) => {
    setParseErrors((previousErrors) => ({
      ...previousErrors,
      [level]: message,
    }));
  };

  const processParsedRows = (
    level: EducationLevel,
    headers: string[],
    rows: Array<Record<string, unknown>>
  ) => {
    const nextDataset = buildRequestDocumentsDataset(headers, rows, registeredReviewers);

    setDatasets((previousDatasets) => ({
      ...previousDatasets,
      [level]: nextDataset,
    }));

    if (nextDataset.missingColumns.length > 0) {
      setLevelParseError(level, `Missing required columns: ${nextDataset.missingColumns.join(', ')}`);
      return;
    }

    if (nextDataset.rows.length === 0) {
      setLevelParseError(level, 'No valid data rows were found in the CSV input.');
      return;
    }

    setLevelParseError(level, null);
  };

  const handleParse = async (level: EducationLevel) => {
    try {
      setLoadingAction(getParseAction(level));
      setActionError(null);

      if (inputModes[level] === 'file') {
        const selectedFile = selectedFiles[level];

        if (!selectedFile) {
          setLevelParseError(level, 'Please select a CSV file first.');
          return;
        }

        const parseResult = await new Promise<Papa.ParseResult<Record<string, unknown>>>((resolve, reject) => {
          Papa.parse<Record<string, unknown>>(selectedFile, {
            header: true,
            skipEmptyLines: true,
            complete: resolve,
            error: reject,
          });
        });

        processParsedRows(level, parseResult.meta.fields ?? [], parseResult.data);
        return;
      }

      if (!csvTexts[level].trim()) {
        setLevelParseError(level, 'Please paste CSV data first.');
        return;
      }

      const parseResult = Papa.parse<Record<string, unknown>>(csvTexts[level], {
        header: true,
        skipEmptyLines: true,
      });

      if (parseResult.errors.length > 0) {
        setLevelParseError(level, parseResult.errors[0].message);
        return;
      }

      processParsedRows(level, parseResult.meta.fields ?? [], parseResult.data);
    } catch (error) {
      console.error(`Failed to parse ${level} request document CSV:`, error);
      setLevelParseError(level, 'Failed to parse the CSV input. Please review the format and try again.');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleGenerate = async () => {
    try {
      setLoadingAction('letter');
      setActionError(null);

      if (levelPayloads.length === 0) {
        setActionError('Please process at least one valid CSV dataset before generating the letter.');
        return;
      }

      const payload: RequestDocumentsGenerationPayload = {
        dateToday,
        periodStartMonth,
        periodEndMonth,
        year,
        levels: levelPayloads,
      };
      const response = await fetch('/api/admin/request-documents/letter', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: 'Unknown generation error.' }));
        throw new Error(errorBody.error || 'Failed to generate the request letter.');
      }

      const blob = await response.blob();

      downloadBlob(
        blob,
        getFileNameFromDisposition(response.headers.get('Content-Disposition'), 'SPUP_REC_Letter.docx')
      );
    } catch (error) {
      console.error('Failed to generate request letter document:', error);
      setActionError(error instanceof Error ? error.message : 'Failed to generate the request letter.');
    } finally {
      setLoadingAction(null);
    }
  };

  const renderDataInput = (level: EducationLevel) => {
    const amountPerReview = calculateAmount(level);
    const parseAction = getParseAction(level);

    return (
      <section key={level} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{level} Data</h2>
            <p className="text-sm text-gray-500">Amount per review: {formatCurrency(amountPerReview)}</p>
          </div>
          <div className="text-sm text-gray-600">
            {datasets[level].rows.length} application{datasets[level].rows.length === 1 ? '' : 's'}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setInputModes((previousModes) => ({ ...previousModes, [level]: 'file' }))}
            className={`px-4 py-2 rounded-md text-sm font-medium border ${inputModes[level] === 'file' ? 'text-white' : 'text-gray-700 border-gray-300'}`}
            style={inputModes[level] === 'file' ? { backgroundColor: COLORS.brand.green.DEFAULT, borderColor: COLORS.brand.green.DEFAULT } : undefined}
          >
            Upload CSV
          </button>
          <button
            type="button"
            onClick={() => setInputModes((previousModes) => ({ ...previousModes, [level]: 'paste' }))}
            className={`px-4 py-2 rounded-md text-sm font-medium border ${inputModes[level] === 'paste' ? 'text-white' : 'text-gray-700 border-gray-300'}`}
            style={inputModes[level] === 'paste' ? { backgroundColor: COLORS.brand.green.DEFAULT, borderColor: COLORS.brand.green.DEFAULT } : undefined}
          >
            Paste CSV
          </button>
          <button
            type="button"
            onClick={() => {
              setInputModes((previousModes) => ({ ...previousModes, [level]: 'paste' }));
              setCsvTexts((previousTexts) => ({ ...previousTexts, [level]: REQUEST_DOCUMENT_SAMPLE_CSV }));
            }}
            className="px-4 py-2 rounded-md text-sm font-medium border border-yellow-300 bg-yellow-50 text-yellow-900"
          >
            Load Sample
          </button>
        </div>

        {inputModes[level] === 'file' ? (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">{level} CSV File</label>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                setSelectedFiles((previousFiles) => ({
                  ...previousFiles,
                  [level]: event.target.files?.[0] ?? null,
                }));
              }}
              className="block w-full border rounded-md px-3 py-2"
            />
          </div>
        ) : (
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">{level} CSV Text</label>
            <textarea
              value={csvTexts[level]}
              onChange={(event) => {
                setCsvTexts((previousTexts) => ({
                  ...previousTexts,
                  [level]: event.target.value,
                }));
              }}
              rows={8}
              className="w-full border rounded-md px-3 py-2 font-mono text-sm"
              placeholder="Paste CSV data including headers here..."
            />
          </div>
        )}

        <button
          type="button"
          onClick={() => handleParse(level)}
          disabled={loadingAction === parseAction}
          className="px-5 py-2.5 rounded-md text-white font-medium disabled:opacity-50"
          style={{ backgroundColor: COLORS.brand.green.DEFAULT }}
        >
          {loadingAction === parseAction ? 'Processing...' : `Process ${level} CSV`}
        </button>

        {parseErrors[level] && (
          <div className="rounded-md bg-red-50 text-red-800 px-4 py-3 text-sm">
            {parseErrors[level]}
          </div>
        )}
      </section>
    );
  };

  const renderPreviewTable = (level: EducationLevel) => {
    const dataset = datasets[level];

    return (
      <section key={level} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200">
          <h2 className="font-semibold text-gray-900">{level} Preview</h2>
          <p className="text-sm text-gray-500">Showing up to the first 10 parsed rows.</p>
        </div>
        <div className="overflow-x-auto">
          {dataset.previewRows.length === 0 ? (
            <div className="p-6 text-sm text-gray-500">No parsed rows yet.</div>
          ) : (
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  {dataset.headers.map((header) => (
                    <th key={header} className="px-4 py-3 text-left font-medium text-gray-700 whitespace-nowrap">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dataset.previewRows.slice(0, 10).map((row, index) => (
                  <tr key={`${level}-${row['SPUP REC Code'] ?? 'row'}-${index}`} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    {dataset.headers.map((header) => (
                      <td key={`${level}-${header}-${index}`} className="px-4 py-3 whitespace-nowrap text-gray-700">
                        {row[header] || '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    );
  };

  const renderSummary = (level: EducationLevel) => (
    <section key={level} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <h2 className="font-semibold text-gray-900">{level} Reviewer Summary</h2>
        <p className="text-sm text-gray-500">Calculated from Reviewer #1 to Reviewer #3.</p>
      </div>
      <div className="divide-y divide-gray-100">
        {summaries[level].length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No summary available yet.</div>
        ) : (
          summaries[level].map((item) => (
            <div key={`${level}-${item.reviewer}`} className="px-4 py-3">
              <div className="font-medium text-gray-900">{item.reviewer}</div>
              <div className="text-sm text-gray-500">{item.proposalCount} proposal(s)</div>
              <div className="text-sm text-gray-700">{formatCurrency(item.honorarium)}</div>
            </div>
          ))
        )}
      </div>
    </section>
  );

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold" style={{ color: COLORS.brand.green[700] }}>Request Documents</h1>
        <p className="text-gray-600">
          Prepare one REC request letter from undergraduate and graduate CSV data.
        </p>
      </div>

      <section className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
            <input
              type="date"
              value={dateToday}
              onChange={(event) => setDateToday(event.target.value)}
              className="w-full border rounded-md px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Start Month</label>
            <select
              value={periodStartMonth}
              onChange={(event) => setPeriodStartMonth(event.target.value as (typeof REQUEST_DOCUMENT_MONTHS)[number])}
              className="w-full border rounded-md px-3 py-2"
            >
              {REQUEST_DOCUMENT_MONTHS.map((month) => (
                <option key={month} value={month}>{month}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Month</label>
            <select
              value={periodEndMonth}
              onChange={(event) => setPeriodEndMonth(event.target.value as (typeof REQUEST_DOCUMENT_MONTHS)[number])}
              className="w-full border rounded-md px-3 py-2"
            >
              {REQUEST_DOCUMENT_MONTHS.map((month) => (
                <option key={month} value={month}>{month}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
            <select
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className="w-full border rounded-md px-3 py-2"
            >
              {yearOptions.map((optionYear) => (
                <option key={optionYear} value={optionYear}>
                  {optionYear}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
          Period: <span className="font-semibold">{periodDisplay}</span>
          <span className="mx-3 text-green-400">|</span>
          Undergraduate: <span className="font-semibold">{formatCurrency(calculateAmount('Undergraduate'))}</span>
          <span className="mx-3 text-green-400">|</span>
          Graduate: <span className="font-semibold">{formatCurrency(calculateAmount('Graduate'))}</span>
          <span className="mx-3 text-green-400">|</span>
          {loadingReviewers
            ? 'Loading registered reviewers...'
            : <>Registered reviewers loaded: <span className="font-semibold">{registeredReviewers.length}</span></>}
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate || loadingAction === 'letter'}
            className="px-5 py-2.5 rounded-md text-white font-medium disabled:opacity-50"
            style={{ backgroundColor: COLORS.brand.yellow.DEFAULT }}
          >
            {loadingAction === 'letter' ? 'Generating Letter...' : 'Generate Combined Letter'}
          </button>
        </div>

        {actionError && (
          <div className="rounded-md bg-yellow-50 text-yellow-900 px-4 py-3 text-sm">
            {actionError}
          </div>
        )}

        {unknownReviewers.length > 0 && (
          <div className="rounded-md bg-amber-50 text-amber-900 px-4 py-3 text-sm">
            Unknown reviewers detected: <span className="font-medium">{unknownReviewers.join(', ')}</span>. Generation is still allowed.
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {EDUCATION_LEVELS.map((level) => renderDataInput(level))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500">Undergraduate Applications</p>
          <p className="text-2xl font-semibold">{datasets.Undergraduate.rows.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500">Graduate Applications</p>
          <p className="text-2xl font-semibold">{datasets.Graduate.rows.length}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500">Total Reviews</p>
          <p className="text-2xl font-semibold">{totalReviews}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500">Total Honorarium</p>
          <p className="text-2xl font-semibold">{formatCurrency(totalHonorarium)}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {EDUCATION_LEVELS.map((level) => renderPreviewTable(level))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {EDUCATION_LEVELS.map((level) => renderSummary(level))}
      </div>
    </div>
  );
}
