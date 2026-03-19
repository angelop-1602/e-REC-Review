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
  type RequestDocumentsDataset,
  type RequestDocumentsGenerationPayload,
} from '@/lib/requestDocuments';

type ActiveTab = 'letter' | 'voucher';

const EMPTY_DATASET: RequestDocumentsDataset = {
  headers: [],
  previewRows: [],
  rows: [],
  missingColumns: [],
  unknownReviewers: [],
  allReviewers: [],
  summary: [],
};

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

export default function RequestDocumentsPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('letter');
  const [inputMode, setInputMode] = useState<'file' | 'paste'>('file');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [csvText, setCsvText] = useState('');
  const [dataset, setDataset] = useState<RequestDocumentsDataset>(EMPTY_DATASET);
  const [registeredReviewers, setRegisteredReviewers] = useState<string[]>([]);
  const [loadingReviewers, setLoadingReviewers] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<'parse' | 'letter' | 'voucher' | null>(null);
  const [educationLevel, setEducationLevel] = useState<EducationLevel>('Undergraduate');
  const [dateToday, setDateToday] = useState(() => new Date().toISOString().split('T')[0]);
  const [periodStartMonth, setPeriodStartMonth] = useState<(typeof REQUEST_DOCUMENT_MONTHS)[number]>('January');
  const [periodEndMonth, setPeriodEndMonth] = useState<(typeof REQUEST_DOCUMENT_MONTHS)[number]>('March');
  const [year, setYear] = useState(new Date().getFullYear());

  const amountPerReview = useMemo(() => calculateAmount(educationLevel), [educationLevel]);
  const periodDisplay = useMemo(
    () => formatPeriodDisplay(periodStartMonth, periodEndMonth, year),
    [periodStartMonth, periodEndMonth, year]
  );

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

  const processParsedRows = (headers: string[], rows: Array<Record<string, unknown>>) => {
    const nextDataset = buildRequestDocumentsDataset(headers, rows, registeredReviewers);

    setDataset(nextDataset);

    if (nextDataset.missingColumns.length > 0) {
      setParseError(`Missing required columns: ${nextDataset.missingColumns.join(', ')}`);
      return;
    }

    if (nextDataset.rows.length === 0) {
      setParseError('No valid data rows were found in the CSV input.');
      return;
    }

    setParseError(null);
  };

  const handleParse = async () => {
    try {
      setLoadingAction('parse');
      setActionError(null);

      if (inputMode === 'file') {
        if (!selectedFile) {
          setParseError('Please select a CSV file first.');
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

        processParsedRows(parseResult.meta.fields ?? [], parseResult.data);
        return;
      }

      if (!csvText.trim()) {
        setParseError('Please paste CSV data first.');
        return;
      }

      const parseResult = Papa.parse<Record<string, unknown>>(csvText, {
        header: true,
        skipEmptyLines: true,
      });

      if (parseResult.errors.length > 0) {
        setParseError(parseResult.errors[0].message);
        return;
      }

      processParsedRows(parseResult.meta.fields ?? [], parseResult.data);
    } catch (error) {
      console.error('Failed to parse request document CSV:', error);
      setParseError('Failed to parse the CSV input. Please review the format and try again.');
    } finally {
      setLoadingAction(null);
    }
  };

  const handleGenerate = async (documentType: ActiveTab) => {
    try {
      setLoadingAction(documentType);
      setActionError(null);

      if (dataset.rows.length === 0 || dataset.missingColumns.length > 0) {
        setActionError('Please parse a valid CSV dataset before generating documents.');
        return;
      }

      const payload: RequestDocumentsGenerationPayload = {
        dateToday,
        educationLevel,
        amountPerReview,
        periodStartMonth,
        periodEndMonth,
        year,
        headers: dataset.headers,
        previewRows: dataset.previewRows,
        rows: dataset.rows,
      };
      const endpoint = documentType === 'letter'
        ? '/api/admin/request-documents/letter'
        : '/api/admin/request-documents/vouchers';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ error: 'Unknown generation error.' }));
        throw new Error(errorBody.error || 'Failed to generate the requested document.');
      }

      const blob = await response.blob();

      downloadBlob(
        blob,
        getFileNameFromDisposition(
          response.headers.get('Content-Disposition'),
          documentType === 'letter' ? 'SPUP_REC_Letter.docx' : 'All_Vouchers.docx'
        )
      );
    } catch (error) {
      console.error(`Failed to generate ${documentType} document:`, error);
      setActionError(error instanceof Error ? error.message : 'Failed to generate the requested document.');
    } finally {
      setLoadingAction(null);
    }
  };

  const totalApplications = dataset.rows.length;
  const summary = useMemo(
    () => buildSummaryFromRows(dataset.rows, amountPerReview),
    [dataset.rows, amountPerReview]
  );
  const unknownReviewers = useMemo(() => {
    if (registeredReviewers.length === 0) {
      return [];
    }

    const registeredReviewerSet = new Set(
      registeredReviewers.map((reviewer) => reviewer.trim().toLowerCase())
    );

    return dataset.allReviewers.filter(
      (reviewer) => !registeredReviewerSet.has(reviewer.toLowerCase())
    );
  }, [dataset.allReviewers, registeredReviewers]);
  const totalReviews = summary.reduce((sum, item) => sum + item.proposalCount, 0);
  const totalHonorarium = summary.reduce((sum, item) => sum + item.honorarium, 0);
  const canGenerate = dataset.rows.length > 0 && dataset.missingColumns.length === 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold" style={{ color: COLORS.brand.green[700] }}>Request Documents</h1>
        <p className="text-gray-600">
          Generate REC request letters and voucher documents from CSV input without leaving the admin portal.
        </p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sm:p-6 space-y-6">
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('letter')}
            className={`px-4 py-2 rounded-full text-sm font-medium border ${
              activeTab === 'letter' ? 'text-white' : 'text-gray-700 border-gray-300'
            }`}
            style={activeTab === 'letter' ? { backgroundColor: COLORS.brand.green.DEFAULT, borderColor: COLORS.brand.green.DEFAULT } : undefined}
          >
            Letter Generation
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('voucher')}
            className={`px-4 py-2 rounded-full text-sm font-medium border ${
              activeTab === 'voucher' ? 'text-white' : 'text-gray-700 border-gray-300'
            }`}
            style={activeTab === 'voucher' ? { backgroundColor: COLORS.brand.green.DEFAULT, borderColor: COLORS.brand.green.DEFAULT } : undefined}
          >
            Voucher Generation
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Education Level</label>
            <select
              value={educationLevel}
              onChange={(event) => setEducationLevel(event.target.value as EducationLevel)}
              className="w-full border rounded-md px-3 py-2"
            >
              <option value="Undergraduate">Undergraduate</option>
              <option value="Graduate">Graduate</option>
            </select>
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
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
            <input
              type="number"
              min={2020}
              max={2100}
              value={year}
              onChange={(event) => setYear(Number(event.target.value))}
              className="w-full border rounded-md px-3 py-2"
            />
          </div>
          <div className="lg:col-span-3">
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">
              Period: <span className="font-semibold">{periodDisplay}</span>
              <span className="mx-3 text-green-400">|</span>
              Amount per review: <span className="font-semibold">{formatCurrency(amountPerReview)}</span>
              <span className="mx-3 text-green-400">|</span>
              {loadingReviewers
                ? 'Loading registered reviewers...'
                : <>Registered reviewers loaded: <span className="font-semibold">{registeredReviewers.length}</span></>}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setInputMode('file')}
              className={`px-4 py-2 rounded-md text-sm font-medium border ${inputMode === 'file' ? 'text-white' : 'text-gray-700 border-gray-300'}`}
              style={inputMode === 'file' ? { backgroundColor: COLORS.brand.green.DEFAULT, borderColor: COLORS.brand.green.DEFAULT } : undefined}
            >
              Upload CSV
            </button>
            <button
              type="button"
              onClick={() => setInputMode('paste')}
              className={`px-4 py-2 rounded-md text-sm font-medium border ${inputMode === 'paste' ? 'text-white' : 'text-gray-700 border-gray-300'}`}
              style={inputMode === 'paste' ? { backgroundColor: COLORS.brand.green.DEFAULT, borderColor: COLORS.brand.green.DEFAULT } : undefined}
            >
              Paste CSV
            </button>
            <button
              type="button"
              onClick={() => {
                setInputMode('paste');
                setCsvText(REQUEST_DOCUMENT_SAMPLE_CSV);
              }}
              className="px-4 py-2 rounded-md text-sm font-medium border border-yellow-300 bg-yellow-50 text-yellow-900"
            >
              Load Sample Data
            </button>
          </div>

          {inputMode === 'file' ? (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">CSV File</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                className="block w-full border rounded-md px-3 py-2"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">CSV Text</label>
              <textarea
                value={csvText}
                onChange={(event) => setCsvText(event.target.value)}
                rows={8}
                className="w-full border rounded-md px-3 py-2 font-mono text-sm"
                placeholder="Paste CSV data including headers here..."
              />
            </div>
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleParse}
              disabled={loadingAction === 'parse'}
              className="px-5 py-2.5 rounded-md text-white font-medium disabled:opacity-50"
              style={{ backgroundColor: COLORS.brand.green.DEFAULT }}
            >
              {loadingAction === 'parse' ? 'Processing...' : 'Process CSV'}
            </button>
            <button
              type="button"
              onClick={() => handleGenerate(activeTab)}
              disabled={!canGenerate || loadingAction === 'letter' || loadingAction === 'voucher'}
              className="px-5 py-2.5 rounded-md text-white font-medium disabled:opacity-50"
              style={{ backgroundColor: COLORS.brand.yellow.DEFAULT }}
            >
              {loadingAction === activeTab ? `Generating ${activeTab === 'letter' ? 'Letter' : 'Vouchers'}...` : `Generate ${activeTab === 'letter' ? 'Letter' : 'Vouchers'}`}
            </button>
          </div>

          {parseError && (
            <div className="rounded-md bg-red-50 text-red-800 px-4 py-3 text-sm">
              {parseError}
            </div>
          )}

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
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500">Applications</p>
          <p className="text-2xl font-semibold">{totalApplications}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
          <p className="text-sm text-gray-500">Reviewers In Data</p>
          <p className="text-2xl font-semibold">{dataset.allReviewers.length}</p>
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Preview Data</h2>
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
                    <tr key={`${row['SPUP REC Code'] ?? 'row'}-${index}`} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      {dataset.headers.map((header) => (
                        <td key={`${header}-${index}`} className="px-4 py-3 whitespace-nowrap text-gray-700">
                          {row[header] || '-'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-200">
            <h2 className="font-semibold text-gray-900">Reviewer Summary</h2>
            <p className="text-sm text-gray-500">Calculated from Reviewer #1 to Reviewer #3.</p>
          </div>
          <div className="divide-y divide-gray-100">
            {summary.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">No summary available yet.</div>
            ) : (
              summary.map((item) => (
                <div key={item.reviewer} className="px-4 py-3">
                  <div className="font-medium text-gray-900">{item.reviewer}</div>
                  <div className="text-sm text-gray-500">{item.proposalCount} proposal(s)</div>
                  <div className="text-sm text-gray-700">{formatCurrency(item.honorarium)}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="font-semibold text-gray-900 mb-3">How This Works</h2>
        <ul className="list-disc list-inside space-y-2 text-sm text-gray-600">
          <li>Upload a CSV file or paste CSV data using the Request system column format.</li>
          <li>Process the data first so the page can validate reviewers and build the summary table.</li>
          <li>Generate a request letter or a consolidated voucher document directly from the admin portal.</li>
          <li>Files download immediately and are not saved back to Firestore.</li>
        </ul>
      </div>
    </div>
  );
}
