'use client';

import { useState, useRef } from 'react';
import { processReleaseInfo, getFormTypeName } from '@/lib/utils';
import { doc, setDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Papa from 'papaparse';

interface ProtocolRow {
  'Main Folder'?: string;
  'Folder'?: string;
  'Reviewer'?: string;
  'Document'?: string;
  'Link'?: string;
  'Folder Link'?: string;
  [key: string]: string | undefined;
}

interface Protocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  reviewer: string;
  reviewers?: { id: string; name: string; status: string }[];
  due_date: string;
  status: string;
  protocol_file: string;
  document_type: string;
  created_at: string;
  [key: string]: string | { id: string; name: string; status: string }[] | undefined;
}

// These interfaces are used in the type casting operations
// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface CSVData {
  [key: string]: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface PartialProtocol {
  protocol_name: string;
  reviewer: string;
  document_type: string;
  protocol_file: string;
  [key: string]: string | undefined;
}

export default function CSVUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [releaseInfo, setReleaseInfo] = useState<{
    releasePeriod: string;
    academicLevel: string | null;
    dueDate: string | null;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError(null);
    setSuccess(null);
    
    // Process the file name to extract release period and academic level
    if (selectedFile.name) {
      const info = processReleaseInfo(selectedFile.name);
      setReleaseInfo(info);
    }

    // Parse the CSV file
    parseCSV(selectedFile);
  };

  const parseCSV = (csvFile: File) => {
    Papa.parse<ProtocolRow>(csvFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        // Process data
        const processedData = results.data.map((row) => {
          // Cast the minimal protocol data to PartialProtocol
          return {
            ...row,
            protocol_name: row['Main Folder'] || row['Folder'] || '',
            reviewer: row['Reviewer'] || '',
            document_type: row['Document'] || '',
            protocol_file: row['Link'] || row['Folder Link'] || '',
          } as unknown as Protocol; // Force cast to Protocol since we'll add missing fields when uploading
        });
        setProtocols(processedData);
      },
      error: (error) => {
        setError(`Error parsing CSV: ${error.message}`);
      }
    });
  };

  const uploadToFirestore = async () => {
    if (!protocols.length || !releaseInfo) {
      setError('No data to upload or release information is missing');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Group by protocol name
      const protocolGroups: { [key: string]: Protocol[] } = {};
      
      protocols.forEach(row => {
        if (!row.protocol_name) return;
        
        if (!protocolGroups[row.protocol_name]) {
          protocolGroups[row.protocol_name] = [];
        }
        
        protocolGroups[row.protocol_name].push(row);
      });

      // Process each protocol group
      const promises = Object.entries(protocolGroups).map(async ([protocolName, rows]) => {
        try {
          // Create protocol document
          const protocolData = {
            protocol_name: protocolName,
            release_period: releaseInfo.releasePeriod,
            academic_level: releaseInfo.academicLevel || 'Unknown',
            due_date: releaseInfo.dueDate || '',
            status: 'In Progress',
            protocol_file: rows[0].protocol_file,
            created_at: Timestamp.now(),
            reviewers: rows.map((row) => ({
              id: row.reviewer,
              name: row.reviewer,
              status: 'In Progress',
              document_type: row.document_type
            }))
          };

          // Use the protocol name as the document ID (or a sanitized version of it)
          const sanitizedId = protocolName.replace(/[\\/:*?"<>|]/g, '_');
          await setDoc(doc(db, 'protocols', sanitizedId), protocolData);
          
          return { success: true, protocolName };
        } catch (err) {
          console.error(`Error uploading ${protocolName}:`, err);
          return { success: false, protocolName, error: err };
        }
      });

      const results = await Promise.all(promises);
      const failedUploads = results.filter(r => !r.success);
      
      if (failedUploads.length > 0) {
        setError(`Some protocols failed to upload: ${failedUploads.map(f => f.protocolName).join(', ')}`);
      } else {
        setSuccess(`Successfully uploaded ${results.length} protocols with ${protocols.length} reviewers`);
        setFile(null);
        setProtocols([]);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    } catch (err) {
      console.error('Error in upload process:', err);
      setError('Failed to upload protocols');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="bg-white p-6 rounded-lg shadow-md mb-6">
      <h1 className="text-2xl font-bold border-b-2 border-gray-200 pb-2 mb-4">CSV Upload</h1>
        <h2 className="text-xl font-semibold mb-4">Upload Protocol CSV File</h2>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Select CSV File
          </label>
          <input
            type="file"
            accept=".csv"
            ref={fileInputRef}
            onChange={handleFileChange}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          <p className="mt-2 text-sm text-gray-500">
            After processing, you&apos;ll see a preview of your data and have the option to &quot;Upload to Firestore&quot; or &quot;Clear&quot; and try again.
          </p>
        </div>

        {releaseInfo && (
          <div className="mb-4 p-4 bg-blue-50 rounded">
            <h3 className="font-medium text-blue-700">File Information</h3>
            <p><strong>Release Period:</strong> {releaseInfo.releasePeriod}</p>
            {releaseInfo.academicLevel && <p><strong>Academic Level:</strong> {releaseInfo.academicLevel}</p>}
            {releaseInfo.dueDate && <p><strong>Due Date:</strong> {releaseInfo.dueDate}</p>}
          </div>
        )}

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

        <div className="mt-6">
          <button
            onClick={uploadToFirestore}
            disabled={!file || loading || protocols.length === 0}
            className="bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Uploading...' : 'Upload to Firestore'}
          </button>
        </div>
      </div>

      {protocols.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Preview ({protocols.length} entries)</h2>
          
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Protocol Name</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reviewer</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Form Type</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {protocols.slice(0, 10).map((row, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.protocol_name}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.reviewer}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{getFormTypeName(row.document_type)}</td>
                  </tr>
                ))}
                {protocols.length > 10 && (
                  <tr>
                    <td colSpan={3} className="px-6 py-4 text-sm text-gray-500 text-center">
                      ...and {protocols.length - 10} more entries
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
} 