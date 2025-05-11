'use client';

import { useState, ChangeEvent } from 'react';
import { collection, doc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { getFormTypeName } from '@/lib/utils';

// CSV Parser function
const parseCSV = (csvText: string) => {
  const lines = csvText.split('\n');
  if (lines.length === 0) return [];
  
  // Find and parse headers - different files have different header names
  const headers = lines[0].split(',').map(header => header.trim());
  
  const result = [];
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue; // Skip empty lines
    
    const values = lines[i].split(',').map(value => value.trim());
    if (values.length < headers.length) continue; // Skip incomplete rows
    
    const entry: Record<string, string> = {};
    
    for (let j = 0; j < headers.length; j++) {
      entry[headers[j]] = values[j];
    }
    
    result.push(entry);
  }
  
  return result;
};

// Helper function to map CSV fields to our standardized protocol fields
const mapToProtocolData = (csvEntry: Record<string, string>, filename: string) => {
  // Determine the column names from the CSV file
  const protocolNameField = csvEntry['Main Folder'] || csvEntry['Folder'] || '';
  const reviewerField = csvEntry['Reviewer'] || '';
  const documentField = csvEntry['Document'] || '';
  const linkField = csvEntry['Link'] || csvEntry['Folder Link'] || '';
  
  // Extract release period from filename (e.g., first-release, april_1stweek)
  let releasePeriod = 'Unknown';
  if (filename.includes('first-release')) {
    releasePeriod = 'First';
  } else if (filename.includes('second-release')) {
    releasePeriod = 'Second';
  } else if (filename.includes('third-release')) {
    releasePeriod = 'Third';
  } else if (filename.includes('fourth-release')) {
    releasePeriod = 'Fourth';
  } else if (filename.includes('april') || filename.includes('may')) {
    // Extract the week information
    const weekMatch = filename.match(/(1st|2nd|3rd|4th)week/);
    const monthMatch = filename.match(/(april|may)/i);
    if (weekMatch && monthMatch) {
      releasePeriod = `${monthMatch[0].charAt(0).toUpperCase() + monthMatch[0].slice(1)} ${weekMatch[0].replace('week', 'Week')}`;
    }
  }
  
  // Determine academic level from filename or protocol
  let academicLevel = 'Unknown';
  if (filename.includes('graduate')) {
    academicLevel = 'Graduate';
  } else if (filename.includes('undergraduate')) {
    academicLevel = 'Undergraduate';
  }
  
  // Calculate due date (14 days from today by default)
  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(today.getDate() + parseInt(process.env.NEXT_PUBLIC_DEFAULT_REVIEW_DAYS || '14'));
  
  // Extract reviewer code (assumed to be something like "DRAPL-001" or a name)
  const reviewerCode = reviewerField.split(' ').length > 1 
    ? reviewerField.split(' ').map((word: string) => word.charAt(0)).join('') // Get initials if it's a name
    : reviewerField; // Use as is if it looks like a code already
  
  // Generate a unique document ID combining folder, form (document type), and reviewer code
  const docId = `${protocolNameField.replace(/\s+/g, '_')}_${documentField.replace(/\s+/g, '_')}_${reviewerCode}`;
  
  // Create a reviewer object with status
  const reviewerObj = {
    id: docId, // Use the new ID format
    name: reviewerField,
    status: 'In Progress'
  };
  
  return {
    id: docId,
    protocol_name: protocolNameField,
    release_period: releasePeriod,
    academic_level: academicLevel,
    reviewer: reviewerField,
    reviewers: [reviewerObj], // Add as an array with a single reviewer
    due_date: dueDate.toISOString().split('T')[0],
    status: 'In Progress',
    protocol_file: linkField,
    document_type: documentField,
    created_at: new Date().toISOString()
  };
};

// Update this interface to include a reviewers array with status for each reviewer
interface MappedProtocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  reviewer: string; // For backward compatibility
  reviewers: { 
    id: string; 
    name: string; 
    status: string; // Status for each individual reviewer
  }[]; // New array of reviewers
  due_date: string;
  status: string; // Overall protocol status
  protocol_file: string;
  document_type: string;
  created_at: string;
}

// Define types to replace any
interface ParsedData {
  [key: string]: string;
}

export default function CSVUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData[] | null>(null);
  const [mappedData, setMappedData] = useState<MappedProtocol[] | null>(null);
  
  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile && selectedFile.type === 'text/csv') {
      setFile(selectedFile);
      setError(null);
    } else {
      setFile(null);
      setError('Please select a valid CSV file');
    }
  };
  
  const handleParse = () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }
    
    setLoading(true);
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const csvData = e.target?.result as string;
        const parsedCSV = parseCSV(csvData);
        
        if (parsedCSV.length === 0) {
          throw new Error('No valid data found in the CSV file');
        }
        
        setParsedData(parsedCSV);
        
        // Map CSV data to protocol data structure
        const protocols = parsedCSV.map((entry) => 
          mapToProtocolData(entry, file.name)
        );
        
        setMappedData(protocols);
        setSuccess('CSV parsed successfully. Review the data below before uploading to Firebase.');
        setLoading(false);
      } catch (error) {
        console.error('Error parsing CSV:', error);
        setError('Failed to parse CSV file. Please check the format.');
        setLoading(false);
      }
    };
    
    reader.onerror = () => {
      setError('Error reading the file');
      setLoading(false);
    };
    
    reader.readAsText(file);
  };
  
  const uploadToFirebase = async () => {
    if (!mappedData || mappedData.length === 0) {
      setError('No data to upload');
      return;
    }
    
    setLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      const batch = writeBatch(db);
      
      // Track which reviewers exist to avoid duplicates
      const reviewersProcessed = new Set();
      
      // Group protocols by protocol_name
      const protocolGroups = mappedData.reduce((acc, protocol) => {
        if (!acc[protocol.protocol_name]) {
          acc[protocol.protocol_name] = [];
        }
        acc[protocol.protocol_name].push(protocol);
        return acc;
      }, {} as Record<string, MappedProtocol[]>);
      
      // Process each group of protocols (same protocol_name)
      (Object.entries(protocolGroups) as [string, MappedProtocol[]][]).forEach(([protocolName, protocols]) => {
        // Use the first protocol as the base
        const baseProtocol = protocols[0];
        
        // Create an array of reviewers from all protocols in this group
        const reviewers = protocols.map((p: MappedProtocol) => {
          // Extract reviewer code from name or use as is if already a code
          const reviewerCode = p.reviewer.split(' ').length > 1 
            ? p.reviewer.split(' ').map((word: string) => word.charAt(0)).join('') // Get initials if it's a name
            : p.reviewer; // Use as is if it looks like a code
            
          return {
            id: `${protocolName.replace(/\s+/g, '_')}_${p.document_type.replace(/\s+/g, '_')}_${reviewerCode}`,
            name: p.reviewer,
            document_type: p.document_type,
            due_date: p.due_date,
            status: 'In Progress'
          };
        });
        
        // Generate a unique document ID for the grouped protocol
        const groupDocId = `${protocolName.replace(/\s+/g, '_')}`;
        
        // Create protocol document with grouped reviewers
        const protocolRef = doc(collection(db, 'protocols'), groupDocId);
        batch.set(protocolRef, {
          protocol_name: protocolName,
          release_period: baseProtocol.release_period,
          academic_level: baseProtocol.academic_level,
          reviewers: reviewers,
          due_date: baseProtocol.due_date, // Base due date (could be the earliest)
          status: 'In Progress',
          protocol_file: baseProtocol.protocol_file,
          document_type: baseProtocol.document_type, // Base document type
          created_at: new Date().toISOString()
        });
        
        // Process each reviewer
        reviewers.forEach((reviewer: { id: string; name: string; document_type: string; due_date: string; status: string }) => {
          if (reviewer.name && !reviewersProcessed.has(reviewer.name)) {
            const reviewerRef = doc(collection(db, 'reviewers'), reviewer.name);
            batch.set(reviewerRef, { 
              name: reviewer.name
            }, { merge: true });
            
            reviewersProcessed.add(reviewer.name);
          }
        });
      });
      
      await batch.commit();
      
      // Count unique protocol groups
      const uniqueProtocolCount = Object.keys(protocolGroups).length;
      
      setSuccess(`Data successfully uploaded to Firebase! ${uniqueProtocolCount} protocols with ${mappedData.length} reviewers processed.`);
      setParsedData(null);
      setMappedData(null);
    } catch (err) {
      console.error('Error uploading to Firebase:', err);
      setError('Failed to upload data to Firebase. Please try again.');
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Upload CSV</h1>
      
      <div className="p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-4">CSV to Firebase Uploader</h2>
        
        <div className="mb-4">
          <p className="mb-2">Upload a CSV file with one of the following formats:</p>
          <div className="bg-gray-100 p-3 rounded text-sm font-mono overflow-x-auto">
            <p>Format 1: Main Folder,Reviewer,Document,Folder Link</p>
            <p>Format 2: Folder,Reviewer,Document,Link</p>
          </div>
        </div>
        
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select CSV File
          </label>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500 
                      file:mr-4 file:py-2 file:px-4 
                      file:rounded-full file:border-0 
                      file:text-sm file:font-semibold 
                      file:bg-blue-50 file:text-blue-700 
                      hover:file:bg-blue-100"
          />
        </div>
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-800 rounded">
            {error}
          </div>
        )}
        
        {success && (
          <div className="mb-4 p-3 bg-green-100 text-green-800 rounded">
            {success}
          </div>
        )}
        
        <div className="flex space-x-4">
          <button
            onClick={handleParse}
            disabled={!file || loading}
            className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? 'Processing...' : 'Parse CSV'}
          </button>
          
          {mappedData && (
            <button
              onClick={uploadToFirebase}
              disabled={loading}
              className="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600 disabled:opacity-50"
            >
              {loading ? 'Uploading...' : 'Upload to Firebase'}
            </button>
          )}
          
          <a 
            href="/admin"
            className="bg-gray-500 text-white py-2 px-4 rounded hover:bg-gray-600"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
      
      {mappedData && (
        <div className="p-6 bg-white rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Preview Protocol Data</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
              <thead>
                <tr className="bg-gray-100">
                  <th className="py-2 px-4 border-b">ID</th>
                  <th className="py-2 px-4 border-b">Protocol Name</th>
                  <th className="py-2 px-4 border-b">Release Period</th>
                  <th className="py-2 px-4 border-b">Academic Level</th>
                  <th className="py-2 px-4 border-b">Reviewer</th>
                  <th className="py-2 px-4 border-b">Due Date</th>
                  <th className="py-2 px-4 border-b">Form Type</th>
                </tr>
              </thead>
              <tbody>
                {mappedData.map((protocol, index) => (
                  <tr key={index}>
                    <td className="py-2 px-4 border-b">{protocol.id}</td>
                    <td className="py-2 px-4 border-b">{protocol.protocol_name}</td>
                    <td className="py-2 px-4 border-b">{protocol.release_period}</td>
                    <td className="py-2 px-4 border-b">{protocol.academic_level}</td>
                    <td className="py-2 px-4 border-b">{protocol.reviewer}</td>
                    <td className="py-2 px-4 border-b">{protocol.due_date}</td>
                    <td className="py-2 px-4 border-b">{getFormTypeName(protocol.document_type)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {parsedData && (
        <div className="p-6 bg-white rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Raw CSV Data</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full bg-white">
              <thead>
                <tr className="bg-gray-100">
                  {parsedData.length > 0 && Object.keys(parsedData[0]).map((header) => (
                    <th key={header} className="py-2 px-4 border-b">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsedData.map((row, index) => (
                  <tr key={index}>
                    {Object.values(row).map((value, i) => (
                      <td key={i} className="py-2 px-4 border-b">{value as string}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      <div className="p-6 bg-white rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-4">JSON Structure</h2>
        <p className="mb-2">The CSV will be converted to the following Firestore structure:</p>
        <div className="bg-gray-100 p-3 rounded text-sm font-mono overflow-x-auto">
          {`// Protocols Collection
{
  "protocols": {
    "SPUP_2024_0729_SR_YM": {
      "protocol_name": "SPUP_2024_0729_SR_YM",
      "release_period": "First",
      "academic_level": "Graduate",
      "reviewers": [
        {
          "id": "SPUP_2024_0729_SR_YM_PRA_FORM_NRD",
          "name": "Dr. Nova R. Domingo",
          "document_type": "PRA FORM",
          "due_date": "2024-06-01",
          "status": "In Progress"
        },
        {
          "id": "SPUP_2024_0729_SR_YM_ICA_FORM_APLB",
          "name": "Dr. Allan Paulo L. Blaquera",
          "document_type": "ICA FORM",
          "due_date": "2024-06-01",
          "status": "In Progress"
        },
        {
          "id": "SPUP_2024_0729_SR_YM_PRA_FORM_JPT",
          "name": "Mr. Jericho P. Teodoro",
          "document_type": "PRA FORM",
          "due_date": "2024-06-01",
          "status": "In Progress"
        }
      ],
      "status": "In Progress",
      "protocol_file": "https://sharepoint.link",
      "document_type": "Various",
      "created_at": "2024-05-18T12:00:00Z"
    }
  },

  // Reviewers Collection
  "reviewers": {
    "Dr. Nova R. Domingo": {
      "name": "Dr. Nova R. Domingo"
    },
    "Dr. Allan Paulo L. Blaquera": {
      "name": "Dr. Allan Paulo L. Blaquera"
    },
    "Mr. Jericho P. Teodoro": {
      "name": "Mr. Jericho P. Teodoro"
    }
  }
}`}
        </div>
      </div>
    </div>
  );
} 