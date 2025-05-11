'use client';

import { useState, useRef, useEffect } from 'react';
import { processReleaseInfo, getFormTypeName } from '@/lib/utils';
import { doc, setDoc, Timestamp, writeBatch, collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Papa from 'papaparse';
import NotificationModal from '@/components/NotificationModal';
import Link from 'next/link';

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
  reviewers?: { id: string; name: string; status: string; document_type?: string }[];
  due_date: string;
  status: string;
  protocol_file: string;
  document_type: string;
  created_at: string;
  [key: string]: string | { id: string; name: string; status: string; document_type?: string }[] | undefined;
}

interface ReviewerInfo {
  id: string;
  name: string;
  protocols: number;
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
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [releaseInfo, setReleaseInfo] = useState<{
    releasePeriod: string;
    academicLevel: string | null;
    dueDate: string | null;
  } | null>(null);
  const [reviewers, setReviewers] = useState<ReviewerInfo[]>([]);
  const [existingReviewers, setExistingReviewers] = useState<Map<string, string>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Custom date input
  const [customDueDate, setCustomDueDate] = useState<string>('');
  const [useDynamicDueDate, setUseDynamicDueDate] = useState(true);
  
  // Preview state
  const [showPreview, setShowPreview] = useState(false);
  const [previewData, setPreviewData] = useState<Protocol[]>([]);
  const [batchSize, setBatchSize] = useState(50);
  
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

  // Progress tracking
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  // Fetch existing reviewers on component mount
  useEffect(() => {
    const fetchExistingReviewers = async () => {
      try {
        const reviewersMap = new Map<string, string>();
        
        // Fetch protocols to extract reviewer information
        const protocolsSnapshot = await getDocs(collection(db, 'protocols'));
        
        protocolsSnapshot.forEach(doc => {
          const data = doc.data();
          
          // Extract reviewers from the reviewers array
          if (data.reviewers && Array.isArray(data.reviewers)) {
            data.reviewers.forEach((reviewer: { id: string; name: string }) => {
              if (reviewer.id && reviewer.name) {
                reviewersMap.set(reviewer.id, reviewer.name);
              }
            });
          }
          
          // Also check for single reviewer field
          if (data.reviewer && typeof data.reviewer === 'string') {
            reviewersMap.set(data.reviewer, data.reviewer);
          }
        });
        
        setExistingReviewers(reviewersMap);
      } catch (error) {
        console.error('Error fetching existing reviewers:', error);
      }
    };
    
    fetchExistingReviewers();
  }, []);

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

    setFile(selectedFile);
    setProtocols([]);
    setPreviewData([]);
    setShowPreview(false);
    
    // Process the file name to extract release period and academic level
    if (selectedFile.name) {
      const info = processReleaseInfo(selectedFile.name);
      setReleaseInfo(info);
      
      // Initialize custom due date with the calculated one if available
      if (info.dueDate) {
        setCustomDueDate(info.dueDate);
      } else {
        // Set default due date as 14 days from now
        const defaultDueDate = new Date();
        defaultDueDate.setDate(defaultDueDate.getDate() + 14);
        setCustomDueDate(defaultDueDate.toISOString().split('T')[0]);
      }
    }

    // Parse the CSV file
    parseCSV(selectedFile);
  };

  const parseCSV = (csvFile: File) => {
    setLoading(true);
    
    Papa.parse<ProtocolRow>(csvFile, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        // Validate results
        if (results.errors.length > 0) {
          showNotification('error', 'CSV Parsing Error', results.errors[0].message);
          setLoading(false);
          return;
        }
        
        if (results.data.length === 0) {
          showNotification('warning', 'Empty CSV', 'The CSV file appears to be empty or does not contain valid data.');
          setLoading(false);
          return;
        }
        
        // Validate required columns
        const requiredColumns = ['Main Folder', 'Reviewer', 'Document', 'Link'];
        const missingColumns = requiredColumns.filter(col => 
          !results.meta.fields?.includes(col) && 
          !(col === 'Main Folder' && results.meta.fields?.includes('Folder')) &&
          !(col === 'Link' && results.meta.fields?.includes('Folder Link'))
        );
        
        if (missingColumns.length > 0) {
          showNotification('warning', 'Missing Columns', 
            `The CSV is missing required columns: ${missingColumns.join(', ')}.`
          );
        }
        
        // Process data
        const processedData = results.data
          .filter(row => (row['Main Folder'] || row['Folder']) && row['Reviewer']) // Skip rows without protocol name or reviewer
          .map((row) => {
            return {
              protocol_name: row['Main Folder'] || row['Folder'] || '',
              reviewer: row['Reviewer'] || '',
              document_type: row['Document'] || '',
              protocol_file: row['Link'] || row['Folder Link'] || '',
            } as PartialProtocol;
          });
        
        // Group by protocol name to identify duplicates and multiple reviewers
        const groupedData: { [protocolName: string]: PartialProtocol[] } = {};
        processedData.forEach((item) => {
          if (!groupedData[item.protocol_name]) {
            groupedData[item.protocol_name] = [];
          }
          groupedData[item.protocol_name].push(item);
        });
        
        // Create consolidated protocols with multiple reviewers if needed
        const consolidatedProtocols: Protocol[] = [];
        const now = new Date();
        
        // Track unique reviewers and their protocol counts
        const reviewerCounts = new Map<string, number>();
        
        Object.entries(groupedData).forEach(([protocolName, items]) => {
          // Base protocol with common data
          const baseProtocol: Protocol = {
            id: '', // This will be auto-generated
            protocol_name: protocolName,
            release_period: releaseInfo?.releasePeriod || 'Unknown',
            academic_level: releaseInfo?.academicLevel || 'Unknown',
            reviewer: '', // This will be overridden or used as fallback
            due_date: customDueDate || releaseInfo?.dueDate || now.toISOString().split('T')[0],
            status: 'In Progress',
            protocol_file: '',
            document_type: '',
            created_at: now.toISOString(),
          };
          
          if (items.length === 1) {
            // Single reviewer case
            const item = items[0];
            baseProtocol.reviewer = item.reviewer;
            baseProtocol.protocol_file = item.protocol_file;
            baseProtocol.document_type = item.document_type;
            
            // Track reviewer count
            const currentCount = reviewerCounts.get(item.reviewer) || 0;
            reviewerCounts.set(item.reviewer, currentCount + 1);
            
            consolidatedProtocols.push(baseProtocol);
          } else {
            // Multiple reviewers case
            baseProtocol.reviewer = items[0].reviewer; // Set first reviewer as fallback
            baseProtocol.protocol_file = items[0].protocol_file;
            baseProtocol.document_type = items[0].document_type;
            
            // Add all reviewers to the reviewers array
            baseProtocol.reviewers = items.map(item => ({
              id: item.reviewer,
              name: item.reviewer,
              status: 'In Progress',
              document_type: item.document_type
            }));
            
            // Track reviewer counts
            items.forEach(item => {
              const currentCount = reviewerCounts.get(item.reviewer) || 0;
              reviewerCounts.set(item.reviewer, currentCount + 1);
            });
            
            consolidatedProtocols.push(baseProtocol);
          }
        });
        
        // Convert reviewer counts to array for UI
        const reviewerInfoArray: ReviewerInfo[] = Array.from(reviewerCounts).map(([id, count]) => ({
          id,
          name: id, // Use ID as name until we get proper names
          protocols: count
        }));
        
        setProtocols(consolidatedProtocols);
        setReviewers(reviewerInfoArray);
        
        // Generate preview data (first 5 protocols)
        setPreviewData(consolidatedProtocols.slice(0, 5));
        
        setLoading(false);
      },
      error: (error) => {
        showNotification('error', 'CSV Parsing Error', error.message);
        setLoading(false);
      }
    });
  };

  const formatReviewerName = (reviewerId: string): string => {
    // Use existing reviewer name if available, otherwise use the ID
    return existingReviewers.get(reviewerId) || reviewerId;
  };
  
  const updateDueDate = () => {
    if (!customDueDate) {
      showNotification('warning', 'Missing Due Date', 'Please specify a due date.');
      return;
    }
    
    const updatedProtocols = protocols.map(protocol => ({
      ...protocol,
      due_date: customDueDate
    }));
    
    setProtocols(updatedProtocols);
    setPreviewData(updatedProtocols.slice(0, 5));
    showNotification('success', 'Due Date Updated', `Due date has been set to ${customDueDate} for all protocols.`);
  };

  const generatePreview = () => {
    setShowPreview(true);
  };

  const uploadToFirestore = async () => {
    if (protocols.length === 0) {
      showNotification('warning', 'No Data', 'There are no protocols to upload.');
      return;
    }
    
    try {
      setIsUploading(true);
      setUploadProgress(0);
      
      // Use batched writes for better performance and atomicity
      const totalProtocols = protocols.length;
      const batches = Math.ceil(totalProtocols / batchSize);
      let processedCount = 0;
      
      for (let i = 0; i < batches; i++) {
        const batch = writeBatch(db);
        const start = i * batchSize;
        const end = Math.min(start + batchSize, totalProtocols);
        const currentBatchItems = protocols.slice(start, end);
        
        for (const protocol of currentBatchItems) {
          // Create a new document with auto-generated ID
          const docRef = doc(collection(db, 'protocols'));
          
          // Convert dates and timestamps
          const created = new Date();
          
          // Format the data for Firestore
          const protocolData = {
            ...protocol,
            id: docRef.id,
            created_at: created.toISOString()
          };
          
          if (protocol.reviewers) {
            // Make sure reviewer names are properly formatted
            protocolData.reviewers = protocol.reviewers.map(reviewer => ({
              ...reviewer,
              name: formatReviewerName(reviewer.id)
            }));
          }
          
          // Add to batch
          batch.set(docRef, protocolData);
        }
        
        // Commit the batch
        await batch.commit();
        
        // Update progress
        processedCount += currentBatchItems.length;
        setUploadProgress(Math.floor((processedCount / totalProtocols) * 100));
      }
      
      showNotification('success', 'Upload Successful', `${totalProtocols} protocols have been uploaded to Firestore.`);
      
      // Reset form
      setFile(null);
      setProtocols([]);
      setPreviewData([]);
      setShowPreview(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Error uploading to Firestore:', error);
      showNotification('error', 'Upload Failed', 'An error occurred while uploading protocols to Firestore.');
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const renderProtocolJsonPreview = (protocol: Protocol) => {
    // Create a nicely formatted JSON preview
    const previewData = {
      protocol_name: protocol.protocol_name,
      release_period: protocol.release_period,
      academic_level: protocol.academic_level,
      due_date: protocol.due_date,
      status: protocol.status,
      document_type: protocol.document_type,
      protocol_file: protocol.protocol_file,
      reviewer: formatReviewerName(protocol.reviewer),
      reviewers: protocol.reviewers ? protocol.reviewers.map(r => ({
        ...r,
        name: formatReviewerName(r.id)
      })) : undefined
    };
    
    return (
      <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
        {JSON.stringify(previewData, null, 2)}
      </pre>
    );
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Upload Protocol CSV</h1>
        <p className="text-gray-600">
          Upload a CSV file containing protocol information. The file will be converted to JSON format for storage in Firestore.
        </p>
      </div>
      
      <div className="bg-white p-6 rounded-lg shadow-md mb-8">
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Upload CSV File
          </label>
          <div className="mt-1 flex items-center">
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
              disabled={loading || isUploading}
            />
          </div>
          <p className="mt-2 text-sm text-gray-500">
            Please upload a CSV file containing protocol information. The filename should include release period information.
          </p>
        </div>
        
        {releaseInfo && (
          <div className="mb-6 bg-blue-50 p-4 rounded-md">
            <h3 className="text-md font-semibold text-blue-800 mb-2">Extracted Information from Filename</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <span className="block text-sm font-medium text-gray-700">Release Period</span>
                <span className="block mt-1 text-sm text-gray-900">{releaseInfo.releasePeriod || 'Not detected'}</span>
              </div>
              <div>
                <span className="block text-sm font-medium text-gray-700">Academic Level</span>
                <span className="block mt-1 text-sm text-gray-900">{releaseInfo.academicLevel || 'Not detected'}</span>
              </div>
              <div>
                <span className="block text-sm font-medium text-gray-700">Auto-calculated Due Date</span>
                <span className="block mt-1 text-sm text-gray-900">{releaseInfo.dueDate || 'Not detected'}</span>
              </div>
            </div>
          </div>
        )}

        <div className="mb-6">
          <div className="flex items-center mb-4">
            <input
              id="dynamicDueDate"
              type="checkbox"
              checked={useDynamicDueDate}
              onChange={(e) => setUseDynamicDueDate(e.target.checked)}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              disabled={loading || isUploading}
            />
            <label htmlFor="dynamicDueDate" className="ml-2 block text-sm text-gray-900">
              Use automatic due date calculation based on release period
            </label>
          </div>
          
          {!useDynamicDueDate && (
            <div className="flex items-end space-x-4">
              <div className="flex-grow">
                <label htmlFor="customDueDate" className="block text-sm font-medium text-gray-700 mb-1">
                  Custom Due Date
                </label>
                <input
                  type="date"
                  id="customDueDate"
                  value={customDueDate}
                  onChange={(e) => setCustomDueDate(e.target.value)}
                  className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
                  disabled={loading || isUploading}
                />
              </div>
              <button
                type="button"
                onClick={updateDueDate}
                className="bg-gray-200 text-gray-700 py-2 px-4 rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
                disabled={loading || isUploading || !customDueDate}
              >
                Apply Due Date
              </button>
            </div>
          )}
        </div>
        
        <div className="mb-6">
          <label htmlFor="batchSize" className="block text-sm font-medium text-gray-700 mb-1">
            Batch Size (for processing large files)
          </label>
          <select
            id="batchSize"
            value={batchSize}
            onChange={(e) => setBatchSize(Number(e.target.value))}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
            disabled={loading || isUploading}
          >
            <option value={10}>10 protocols per batch</option>
            <option value={25}>25 protocols per batch</option>
            <option value={50}>50 protocols per batch</option>
            <option value={100}>100 protocols per batch</option>
          </select>
          <p className="mt-1 text-xs text-gray-500">
            Smaller batch sizes are recommended for larger files to prevent timeouts
          </p>
        </div>
        
        <div className="mt-6 flex justify-between">
          <div>
            {protocols.length > 0 && (
              <span className="text-sm text-gray-600">
                {protocols.length} protocols found in CSV
              </span>
            )}
          </div>
          <div className="flex space-x-4">
            <button
              type="button"
              onClick={generatePreview}
              className="bg-gray-100 text-gray-700 py-2 px-4 border border-gray-300 rounded-md shadow-sm hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
              disabled={loading || isUploading || protocols.length === 0}
            >
              Preview Data
            </button>
            <button
              type="button"
              onClick={uploadToFirestore}
              className="bg-blue-600 text-white py-2 px-4 rounded-md shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              disabled={loading || isUploading || protocols.length === 0}
            >
              {isUploading ? 'Uploading...' : 'Upload to Firestore'}
            </button>
          </div>
        </div>
        
        {isUploading && (
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div 
                className="bg-blue-600 h-2.5 rounded-full" 
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
            <p className="text-center text-sm mt-1 text-gray-600">
              Uploading protocols ({uploadProgress}%)
            </p>
          </div>
        )}
      </div>
      
      {loading && (
        <div className="bg-white p-10 rounded-lg shadow-md flex justify-center items-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
          <span className="ml-3">Processing CSV data...</span>
        </div>
      )}

      {showPreview && previewData.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-md mb-8">
          <h2 className="text-xl font-semibold mb-4">Data Preview</h2>
          <p className="text-sm text-gray-500 mb-4">
            Showing preview of the first {previewData.length} protocols out of {protocols.length} total.
            The data will be formatted as shown below when uploaded to Firestore.
          </p>
          
          <div className="divide-y divide-gray-200">
            {previewData.map((protocol, index) => (
              <div key={index} className="py-4">
                <h3 className="font-medium mb-2">{protocol.protocol_name}</h3>
                {renderProtocolJsonPreview(protocol)}
              </div>
            ))}
          </div>
        </div>
      )}
      
      {reviewers.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-md mb-8">
          <h2 className="text-xl font-semibold mb-4">Reviewer Summary</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reviewer ID
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Protocols Assigned
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {reviewers.map((reviewer, index) => (
                  <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {reviewer.id}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatReviewerName(reviewer.id)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {reviewer.protocols}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Link 
          href="/admin/protocols" 
          className="bg-gray-100 text-gray-700 py-2 px-4 border border-gray-300 rounded-md shadow-sm hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
        >
          Go to Protocols List
        </Link>
      </div>
      
      {/* Notification Modal */}
      <NotificationModal
        isOpen={notification.isOpen}
        type={notification.type}
        title={notification.title}
        message={notification.message}
        onClose={() => setNotification({ ...notification, isOpen: false })}
      />
    </div>
  );
} 