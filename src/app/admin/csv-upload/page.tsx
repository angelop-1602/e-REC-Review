'use client';

import { useState, useRef } from 'react';
import { setDoc, doc, collection } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Papa from 'papaparse';

// Interface for the CSV row data
interface CSVRow {
  'SPUP REC Code': string;
  'Principal Investigator': string;
  'Research Title': string;
  'Adviser': string;
  'Course/Program': string;
  'E Link': string;
  'PRA1'?: string;
  'PRA2'?: string;
  'ICA'?: string;
  'IACUC'?: string;
  'IACUC2'?: string;
  'CREF1'?: string;
  'CREF2'?: string;
  [key: string]: string | undefined;
}

// Interface for the processed protocol data
interface Protocol {
  spup_rec_code: string;
  principal_investigator: string;
  research_title: string;
  adviser: string;
  course_program: string;
  e_link: string;
  reviewers: { id: string; name: string; status: string; form_type: string; due_date: string }[];
  created_at: string;
}

export default function TestPage() {
  const [parsedData, setParsedData] = useState<CSVRow[]>([]);
  const [processedData, setProcessedData] = useState<Protocol[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [dueDate, setDueDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 14); // Default due date: 14 days from now
    return date.toISOString().split('T')[0];
  });
  
  // Month and week selection for Firebase structure
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const date = new Date();
    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return `${monthNames[date.getMonth()]}${date.getFullYear()}`;
  });
  const [selectedWeek, setSelectedWeek] = useState('week-1');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Notification state
  const [notification, setNotification] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    message: string;
  }>({
    isOpen: false,
    type: 'info',
    title: '',
    message: ''
  });

  // Generate month options for dropdown
  const generateMonthOptions = () => {
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const currentYear = new Date().getFullYear();
    const options = [];
    
    // Add options for current year and next year
    for (let year = currentYear; year <= currentYear + 1; year++) {
      for (const month of months) {
        options.push(`${month}${year}`);
      }
    }
    
    return options;
  };

  // Generate week options
  const generateWeekOptions = () => {
    const weeks = [];
    for (let i = 1; i <= 5; i++) {
      weeks.push(`week-${i}`);
    }
    return weeks;
  };

  const showNotification = (type: 'success' | 'error' | 'info' | 'warning', title: string, message: string) => {
    setNotification({
      isOpen: true,
      type,
      title,
      message
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setParsedData([]);
    setProcessedData([]);
    setUploadStatus('');
    
    // Parse the CSV file
    parseCSV(selectedFile);
  };

  const parseCSV = (csvFile: File) => {
    setLoading(true);
    
    Papa.parse<CSVRow>(csvFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (results.errors.length > 0) {
          showNotification('error', 'CSV Parsing Error', results.errors[0].message);
          setLoading(false);
          return;
        }
        
        if (results.data.length === 0) {
          showNotification('warning', 'Empty CSV', 'The CSV file appears to be empty.');
          setLoading(false);
          return;
        }
        
        // Check if required columns exist
        const requiredColumns = ['SPUP REC Code', 'Research Title', 'E Link'];
        const missingColumns = requiredColumns.filter(col => 
          !results.meta.fields?.includes(col)
        );
        
        if (missingColumns.length > 0) {
          showNotification('warning', 'Missing Columns', 
            `The CSV is missing required columns: ${missingColumns.join(', ')}.`
          );
          setLoading(false);
          return;
        }
        
        setParsedData(results.data);
        processData(results.data);
        setLoading(false);
      },
      error: (error) => {
        showNotification('error', 'CSV Parsing Error', error.message);
        setLoading(false);
      }
    });
  };

  const processData = (data: CSVRow[]) => {
    // Process the CSV data into Protocol objects
    const protocols: Protocol[] = data
      .filter(row => row['SPUP REC Code'] && row['Research Title'] && row['E Link'])
      .map(row => {
        const reviewerFormTypes = [
          { field: 'PRA1', form: 'PRA1' },
          { field: 'PRA2', form: 'PRA2' },
          { field: 'ICA', form: 'ICA' },
          { field: 'IACUC', form: 'IACUC' },
          { field: 'IACUC2', form: 'IACUC2' },
          { field: 'CREF1', form: 'CREF1' },
          { field: 'CREF2', form: 'CREF2' },
        ];
        
        // Extract reviewers
        const reviewers: { id: string; name: string; status: string; form_type: string; due_date: string }[] = [];
        
        for (const { field, form } of reviewerFormTypes) {
          if (row[field] && row[field]?.trim() !== '') {
            reviewers.push({
              id: row[field]!,
              name: row[field]!,
              status: 'In Progress',
              form_type: form,
              due_date: dueDate
            });
          }
        }
        
        const now = new Date();
        
        return {
          spup_rec_code: row['SPUP REC Code'],
          principal_investigator: row['Principal Investigator'] || '',
          research_title: row['Research Title'] || '',
          adviser: row['Adviser'] || '',
          course_program: row['Course/Program'] || '',
          e_link: row['E Link'] || '',
          reviewers: reviewers,
          created_at: now.toISOString()
        };
      });
    
    setProcessedData(protocols);
    showNotification('success', 'Data Processed', `Successfully processed ${protocols.length} protocols.`);
  };

  const uploadToFirestore = async () => {
    if (processedData.length === 0) {
      showNotification('warning', 'No Data', 'There are no protocols to upload.');
      return;
    }
    
    setLoading(true);
    setUploadStatus('Uploading...');
    
    try {
      // Upload each protocol to Firestore using the simplified structure
      const totalProtocols = processedData.length;
      let uploadedCount = 0;
      
      for (const protocol of processedData) {
        // In Firestore, we need to create the nested path correctly
        // First: get a reference to the month document
        const monthDocRef = doc(collection(db, 'protocols'), selectedMonth);
        
        // Second: create a collection with the week name directly under the month document
        const weekCollectionRef = collection(monthDocRef, selectedWeek);
        
        // Finally: create the protocol document directly in the week collection 
        const protocolDocRef = doc(weekCollectionRef, protocol.spup_rec_code);
        
        // Set the protocol data
        await setDoc(protocolDocRef, protocol);
        
        uploadedCount++;
        setUploadStatus(`Uploaded ${uploadedCount} of ${totalProtocols} protocols...`);
      }
      
      setUploadStatus(`Successfully uploaded ${totalProtocols} protocols.`);
      showNotification('success', 'Upload Complete', `Successfully uploaded ${totalProtocols} protocols to protocols/${selectedMonth}/${selectedWeek}/`);
      
      // Reset form
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      setParsedData([]);
      setProcessedData([]);
    } catch (error) {
      console.error('Error uploading to Firestore:', error);
      setUploadStatus('Upload failed. See console for details.');
      showNotification('error', 'Upload Failed', `An error occurred while uploading to Firestore: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const renderProtocolPreview = (protocol: Protocol) => {
    return (
      <div className="border rounded-md p-4 mb-4 bg-white shadow-sm">
        <h3 className="font-medium mb-2 text-blue-700">{protocol.research_title}</h3>
        <p className="text-xs text-gray-500 mb-2">
          Will be stored at: protocols/{selectedMonth}/{selectedWeek}/{protocol.spup_rec_code}
        </p>
        <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
          {JSON.stringify({
            spup_rec_code: protocol.spup_rec_code,
            research_title: protocol.research_title,
            principal_investigator: protocol.principal_investigator,
            adviser: protocol.adviser,
            course_program: protocol.course_program,
            e_link: protocol.e_link,
            reviewers: protocol.reviewers.map(r => ({
              id: r.id,
              name: r.name,
              form_type: r.form_type,
              status: r.status,
              due_date: r.due_date
            })),
            created_at: protocol.created_at
          }, null, 2)}
        </pre>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Test CSV Upload with New Format</h1>
        <p className="text-gray-600 mb-4">
          This page allows you to test the new CSV upload format, which uses SPUP REC Code as the document ID and 
          saves data in the new nested structure: protocols/month/week/SPUP_REC_Code.
        </p>
      </div>
      
      <div className="bg-white p-6 rounded-lg shadow-md mb-8">
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Upload CSV File
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500
              file:mr-4 file:py-2 file:px-4
              file:rounded-md file:border-0
              file:text-sm file:font-semibold
              file:bg-blue-50 file:text-blue-700
              hover:file:bg-blue-100"
            ref={fileInputRef}
            disabled={loading}
          />
          <p className="mt-2 text-sm text-gray-500">
            The CSV should include these columns: SPUP REC Code, Research Title, E Link, and optional reviewer columns.
          </p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Month
            </label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              disabled={loading}
            >
              {generateMonthOptions().map((month) => (
                <option key={month} value={month}>{month}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Week
            </label>
            <select
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(e.target.value)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              disabled={loading}
            >
              {generateWeekOptions().map((week) => (
                <option key={week} value={week}>{week}</option>
              ))}
            </select>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-1 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Due Date
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
              disabled={loading}
            />
          </div>
        </div>
        
        <div className="mt-6 flex justify-between">
          <div>
            {parsedData.length > 0 && (
              <span className="text-sm text-gray-600">
                {parsedData.length} rows found in CSV
              </span>
            )}
          </div>
          <div>
            <button
              type="button"
              onClick={uploadToFirestore}
              className="bg-blue-600 text-white py-2 px-4 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              disabled={loading || processedData.length === 0}
            >
              {loading ? 'Processing...' : 'Upload to Firestore'}
            </button>
          </div>
        </div>
        
        {uploadStatus && (
          <div className="mt-4 p-3 bg-blue-50 text-blue-700 rounded-md">
            {uploadStatus}
          </div>
        )}
      </div>
      
      {loading && (
        <div className="bg-white p-10 rounded-lg shadow-md flex justify-center items-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
          <span className="ml-3">Processing...</span>
        </div>
      )}
      
      {processedData.length > 0 && !loading && (
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Data Preview</h2>
          <p className="text-sm text-gray-500 mb-4">
            {processedData.length > 5 
              ? `Showing preview of the first 5 protocols out of ${processedData.length} total.` 
              : `Showing all ${processedData.length} protocols.`}
          </p>
          
          <div className="space-y-4">
            {processedData.slice(0, 5).map((protocol, index) => (
              <div key={index}>
                {renderProtocolPreview(protocol)}
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
} 