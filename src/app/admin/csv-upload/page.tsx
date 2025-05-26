// Final integrated code below will:
// 1. Use parsed reviewer ID to fetch their name from `/reviewers/{id}`
// 2. Process the data BEFORE upload
// 3. Show a Firestore structure preview
// 4. Preserve file upload + paste into table behavior with editable cell

'use client';

import { useState, useRef, useEffect } from 'react';
import { setDoc, doc, collection, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Papa from 'papaparse';

const headers = [
  'SPUP REC Code', 'Principal Investigator', 'Research Title', 'Adviser', 'Course/Program',
  'E Link', 'PRA1', 'PRA2', 'ICA', 'IACUC', 'IACUC2', 'CREF1', 'CREF2'
];

type CSVRow = { [key: string]: string };
type Reviewer = { id: string; name: string; form_type: string; status: string; due_date: string };
type Protocol = {
  spup_rec_code: string;
  principal_investigator: string;
  research_title: string;
  adviser: string;
  course_program: string;
  e_link: string;
  reviewers: Reviewer[];
  created_at: string;
};

export default function CSVUploader() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CSVRow[]>([]);
  const [processedData, setProcessedData] = useState<Protocol[]>([]);
  const [uploadStatus, setUploadStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return date.toISOString().split('T')[0];
  });
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const date = new Date();
    return `${date.toLocaleString('default', { month: 'long' })}${date.getFullYear()}`;
  });
  const [selectedWeek, setSelectedWeek] = useState('week-1');
  const [previewData, setPreviewData] = useState<Protocol[]>([]);

  const reviewerCache = new Map<string, string>();

  useEffect(() => {
    setPreviewData(processedData);
  }, [processedData]);

  const fetchReviewerName = async (id: string): Promise<string> => {
    if (reviewerCache.has(id)) return reviewerCache.get(id)!;
    const snap = await getDoc(doc(db, 'reviewers', id));
    const name = snap.exists() ? snap.data().name || id : id;
    if (!snap.exists()) console.warn(`Reviewer not found for ID: ${id}`);
    reviewerCache.set(id, name);
    return name;
  };

  const processData = async (data: CSVRow[]) => {
    const processed: Protocol[] = [];

    for (const row of data) {
      if (!row['SPUP REC Code'] || !row['Research Title'] || !row['E Link']) continue;

      const currentDueDate = dueDate;
      const reviewers: Reviewer[] = [];
      for (const header of headers.slice(6)) {
        const reviewerCode = row[header]?.trim();
        if (reviewerCode) {
          const name = await fetchReviewerName(reviewerCode);
          reviewers.push({ id: reviewerCode, name, form_type: header, status: 'In Progress', due_date: currentDueDate });
        }
      }

      processed.push({
        spup_rec_code: row['SPUP REC Code'],
        principal_investigator: row['Principal Investigator'] || '',
        research_title: row['Research Title'] || '',
        adviser: row['Adviser'] || '',
        course_program: row['Course/Program'] || '',
        e_link: row['E Link'] || '',
        reviewers,
        created_at: new Date().toISOString()
      });
    }
    setProcessedData(processed);
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const pasted = e.clipboardData.getData('text/plain');
    const lines = pasted.trim().split(/\r?\n/);
    const parsed: CSVRow[] = lines.map(line => {
      const values = line.split('\t');
      const obj: CSVRow = {};
      headers.forEach((h, i) => (obj[h] = values[i] || ''));
      return obj;
    });
    setRows(parsed);
    await processData(parsed);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    Papa.parse<CSVRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (result) => {
        setRows(result.data);
        await processData(result.data);
      }
    });
  };

  const uploadToFirestore = async () => {
    if (!processedData.length) return;
    setUploadStatus('Uploading...');
    setLoading(true);
    try {
      const baseRef = doc(collection(db, 'protocols'), selectedMonth);
      const weekRef = collection(baseRef, selectedWeek);
      for (const protocol of processedData) {
        const docRef = doc(weekRef, protocol.spup_rec_code);
        await setDoc(docRef, protocol);
      }
      setUploadStatus(`Successfully uploaded ${processedData.length} protocols.`);
    } catch (e) {
      console.error(e);
      setUploadStatus('Upload failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold mb-4 text-blue-800">CSV Upload with Reviewer Mapping</h1>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
          <input className="border rounded-md p-2 w-full focus:ring-blue-500 focus:border-blue-500" type="text" value={selectedMonth} onChange={e => setSelectedMonth(e.target.value)} placeholder="Month" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Week</label>
          <select className="border rounded-md p-2 w-full focus:ring-blue-500 focus:border-blue-500" value={selectedWeek} onChange={e => setSelectedWeek(e.target.value)}>
            {[1, 2, 3, 4, 5].map(i => <option key={i} value={`week-${i}`}>Week {i}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
          <input 
            type="date" 
            className="border rounded-md p-2 w-full focus:ring-blue-500 focus:border-blue-500"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
          />
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">Upload CSV File</label>
        <input className="border rounded-md p-2 w-full focus:ring-blue-500 focus:border-blue-500" type="file" onChange={handleFileChange} ref={fileInputRef} />
        <p className="mt-2 text-xs text-gray-500">Or paste Excel data directly into the table below (tab-separated, with headers matching: {headers.join(', ')})</p>
      </div>

      <div className="overflow-auto border rounded-lg bg-white shadow mb-6">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr>
              {headers.map(h => <th key={h} className="border p-2 bg-blue-50 text-blue-800 font-semibold whitespace-nowrap">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={headers.length} className="text-center py-8 text-gray-400">
                  <div
                    contentEditable
                    suppressContentEditableWarning
                    onPaste={handlePaste}
                    className="outline-none border-2 border-dashed border-blue-300 bg-blue-50 rounded-md p-6 text-gray-500 hover:bg-blue-100 focus:bg-blue-100 transition-all duration-150 cursor-text"
                    style={{ minHeight: 60 }}
                  >
                    Paste Excel data here (Tab-separated)
                  </div>
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className={i % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  {headers.map(h => <td key={h} className="border p-2 whitespace-nowrap">{r[h]}</td>)}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <button onClick={uploadToFirestore} className="mt-4 bg-blue-600 text-white px-6 py-2 rounded-md shadow hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-150 disabled:opacity-50" disabled={loading || !processedData.length}>
        {loading ? 'Uploading...' : 'Upload to Firestore'}
      </button>

      {uploadStatus && <p className="mt-2 text-sm text-blue-700 font-medium">{uploadStatus}</p>}

      <div className="mt-8">
        <h2 className="text-lg font-bold mb-3 text-blue-800">Preview Parsed Protocols</h2>
        {previewData.length === 0 && <p className="text-gray-400 text-sm">No data parsed yet.</p>}
        {previewData.slice(0, 5).map((p, idx) => (
          <div key={idx} className="border p-3 mb-3 rounded bg-gray-50 text-xs">
            <pre>{JSON.stringify(p, null, 2)}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
