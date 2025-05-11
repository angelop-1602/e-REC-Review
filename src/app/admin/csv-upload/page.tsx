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
  
  // New protocol fields
  'SPUP REC Code'?: string;
  'Principal Investigator'?: string;
  'Research Title'?: string;
  'Adviser'?: string;
  'Course/Program'?: string;
  'E Link'?: string;
  'PRA1'?: string;
  'PRA2'?: string;
  'ICA'?: string;
  'IACUC'?: string;
  'IACUC2'?: string;
  'CREF1'?: string;
  'CREF2'?: string;
  
  [key: string]: string | undefined;
}

interface Protocol {
  id: string; // Will use SPUP REC Code when available, otherwise auto-generated
  protocol_name: string;
  release_period: string;
  academic_level: string;
  reviewer: string;
  reviewers?: { id: string; name: string; status: string; form_type?: string }[];
  due_date: string;
  status: string;
  protocol_file: string;
  document_type: string;
  created_at: string;
  
  // New protocol fields
  spup_rec_code?: string;
  principal_investigator?: string;
  research_title?: string;
  adviser?: string;
  course_program?: string;
  e_link?: string;
  
  [key: string]: string | { id: string; name: string; status: string; form_type?: string }[] | undefined;
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
  const [activeTab, setActiveTab] = useState<'protocols' | 'json'>('protocols');
  
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

  // Add a state for the JSON structure preview
  const [jsonPreview, setJsonPreview] = useState<{
    protocols: any;
    structure: string;
  } | null>(null);

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
        
        // Detect CSV format by checking headers
        const headers = results.meta.fields || [];
        const isNewFormat = headers.includes('SPUP REC Code') || headers.includes('Research Title');
        
        if (isNewFormat) {
          processNewFormatCSV(results.data);
        } else {
          processOldFormatCSV(results.data);
        }
      },
      error: (error) => {
        showNotification('error', 'CSV Parsing Error', error.message);
        setLoading(false);
      }
    });
  };

  const processNewFormatCSV = (data: ProtocolRow[]) => {
    // Validate required columns
    const firstRow = data[0] || {};
    const hasRequiredColumns = firstRow['SPUP REC Code'] !== undefined || 
                            firstRow['Research Title'] !== undefined;
    
    if (!hasRequiredColumns) {
      showNotification('warning', 'Missing Columns', 
        'The CSV is missing required columns for the new format. Please check your file.'
      );
      setLoading(false);
      return;
    }
    
    // Process data
    const processedProtocols = data
      .filter(row => (row['SPUP REC Code'] || row['Research Title']) && row['E Link']) // Skip rows without required fields
      .map((row) => {
        const reviewerFormTypes = [
          { field: 'PRA1', form: 'PRA1' },
          { field: 'PRA2', form: 'PRA2' },
          { field: 'ICA', form: 'ICA' },
          { field: 'IACUC', form: 'IACUC' },
          { field: 'IACUC2', form: 'IACUC2' },
          { field: 'CREF1', form: 'CREF1' },
          { field: 'CREF2', form: 'CREF2' }
        ];
        
        // Extract reviewers from each form type field
        const reviewers: { id: string; name: string; status: string; form_type: string }[] = [];
        
        for (const { field, form } of reviewerFormTypes) {
          if (row[field] && row[field]?.trim() !== '') {
            reviewers.push({
              id: row[field] || '',
              name: formatReviewerName(row[field] || ''),
              status: 'In Progress',
              form_type: form
            });
          }
        }
        
        const now = new Date();
        const protocolName = row['Research Title'] || row['SPUP REC Code'] || '';
        
        return {
          id: row['SPUP REC Code'] || '', // Set ID to SPUP REC Code if available
          protocol_name: protocolName,
          spup_rec_code: row['SPUP REC Code'] || '',
          principal_investigator: row['Principal Investigator'] || '',
          research_title: row['Research Title'] || '',
          adviser: row['Adviser'] || '',
          course_program: row['Course/Program'] || '',
          e_link: row['E Link'] || '',
          release_period: releaseInfo?.releasePeriod || 'Unknown',
          academic_level: releaseInfo?.academicLevel || 'Unknown',
          reviewer: reviewers.length > 0 ? reviewers[0].id : '',
          reviewers: reviewers,
          due_date: customDueDate || releaseInfo?.dueDate || now.toISOString().split('T')[0],
          status: 'In Progress',
          protocol_file: row['E Link'] || row['Link'] || row['Folder Link'] || '',
          document_type: '',
          created_at: now.toISOString(),
        } as Protocol;
      });
    
    // Group reviewers by reviewer ID for display
    const reviewerCounts = new Map<string, number>();
    processedProtocols.forEach(protocol => {
      if (protocol.reviewers && protocol.reviewers.length > 0) {
        protocol.reviewers.forEach(reviewer => {
          const currentCount = reviewerCounts.get(reviewer.id) || 0;
          reviewerCounts.set(reviewer.id, currentCount + 1);
        });
      } else if (protocol.reviewer) {
        const currentCount = reviewerCounts.get(protocol.reviewer) || 0;
        reviewerCounts.set(protocol.reviewer, currentCount + 1);
      }
    });
    
    // Convert reviewer counts to array for UI
    const reviewerInfoArray = Array.from(reviewerCounts).map(([id, count]) => ({
      id,
      name: existingReviewers.get(id) || id,
      protocols: count
    }));
    
    setProtocols(processedProtocols);
    setReviewers(reviewerInfoArray);
    setPreviewData(processedProtocols.slice(0, 5));
    setLoading(false);
    
    showNotification('success', 'CSV Parsed', `Successfully parsed ${processedProtocols.length} protocols using new format.`);
  };

  const processOldFormatCSV = (data: ProtocolRow[]) => {
    // Validate required columns
    const requiredColumns = ['Main Folder', 'Reviewer', 'Document', 'Link'];
    const missingColumns = requiredColumns.filter(col => 
      !Object.keys(data[0] || {}).includes(col) && 
      !(col === 'Main Folder' && Object.keys(data[0] || {}).includes('Folder')) &&
      !(col === 'Link' && Object.keys(data[0] || {}).includes('Folder Link'))
    );
    
    if (missingColumns.length > 0) {
      showNotification('warning', 'Missing Columns', 
        `The CSV is missing required columns: ${missingColumns.join(', ')}.`
      );
    }
    
    // Process data
    const processedData = data
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
    const reviewerInfoArray = Array.from(reviewerCounts).map(([id, count]) => ({
      id,
      name: existingReviewers.get(id) || id,
      protocols: count
    }));
    
    setProtocols(consolidatedProtocols);
    setReviewers(reviewerInfoArray);
    setPreviewData(consolidatedProtocols.slice(0, 5));
    setLoading(false);
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
    // Create a copy of the protocols for preview
    const previewData = [...protocols].slice(0, Math.min(protocols.length, 5));
    setPreviewData(previewData);
    
    // Generate a JSON structure preview
    if (protocols.length > 0) {
      // Create a sample structure based on the first protocol
      const sampleProtocol = protocols[0];
      const protocolId = sampleProtocol.id;
      
      // Create a simplified JSON structure
      const jsonStructure = {
        protocols: {
          [protocolId]: {
            protocol_name: sampleProtocol.protocol_name,
            release_period: sampleProtocol.release_period,
            academic_level: sampleProtocol.academic_level,
            reviewer: sampleProtocol.reviewer || null,
            reviewers: sampleProtocol.reviewers || [],
            due_date: sampleProtocol.due_date,
            status: sampleProtocol.status,
            protocol_file: sampleProtocol.protocol_file,
            document_type: sampleProtocol.document_type || null,
            created_at: sampleProtocol.created_at,
            // Include additional fields if available
            spup_rec_code: sampleProtocol.spup_rec_code || null,
            principal_investigator: sampleProtocol.principal_investigator || null,
            research_title: sampleProtocol.research_title || null,
            adviser: sampleProtocol.adviser || null,
            course_program: sampleProtocol.course_program || null,
            e_link: sampleProtocol.e_link || null,
          }
        }
      };
      
      // Set the JSON preview
      setJsonPreview({
        protocols: jsonStructure,
        structure: JSON.stringify(jsonStructure, null, 2)
      });
    } else {
      setJsonPreview(null);
    }
    
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
          // Create a document reference - use SPUP REC Code as ID if available, otherwise auto-generate
          let docRef;
          if (protocol.spup_rec_code && protocol.spup_rec_code.trim() !== '') {
            docRef = doc(collection(db, 'protocols'), protocol.spup_rec_code);
          } else {
            docRef = doc(collection(db, 'protocols'));
          }
          
          // Convert dates and timestamps
          const created = new Date();
          
          // Format the data for Firestore
          const protocolData = {
            ...protocol,
            id: protocol.spup_rec_code && protocol.spup_rec_code.trim() !== '' 
                ? protocol.spup_rec_code 
                : docRef.id,
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
    // Determine if this is using the new format
    const isNewFormat = protocol.spup_rec_code || protocol.research_title;
    
    // Create a nicely formatted JSON preview
    const previewData = isNewFormat ? {
      id: protocol.spup_rec_code || protocol.id,
      spup_rec_code: protocol.spup_rec_code || 'N/A',
      research_title: protocol.research_title || protocol.protocol_name,
      principal_investigator: protocol.principal_investigator || 'N/A',
      adviser: protocol.adviser || 'N/A',
      course_program: protocol.course_program || 'N/A',
      release_period: protocol.release_period,
      academic_level: protocol.academic_level,
      due_date: protocol.due_date,
      status: protocol.status,
      link: protocol.e_link || protocol.protocol_file || 'N/A',
      reviewers: protocol.reviewers ? protocol.reviewers.map(r => ({
        id: r.id,
        name: formatReviewerName(r.id),
        form_type: r.form_type || 'Unknown',
        status: r.status
      })) : [{
        id: protocol.reviewer,
        name: formatReviewerName(protocol.reviewer),
        form_type: 'Unknown',
        status: protocol.status
      }]
    } : {
      id: protocol.id,
      protocol_name: protocol.protocol_name,
      release_period: protocol.release_period,
      academic_level: protocol.academic_level,
      due_date: protocol.due_date,
      status: protocol.status,
      document_type: protocol.document_type,
      protocol_file: protocol.protocol_file,
      reviewer: formatReviewerName(protocol.reviewer),
      reviewers: protocol.reviewers ? protocol.reviewers.map(r => ({
        id: r.id,
        name: formatReviewerName(r.id),
        form_type: r.form_type || 'Unknown', 
        status: r.status
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
          When using the new format, the SPUP REC Code will be used as the document ID in Firestore.
        </p>
        <div className="mt-4">
          <Link 
            href="/admin/csv-upload/test-page" 
            className="bg-blue-100 text-blue-700 py-2 px-4 rounded-md shadow-sm hover:bg-blue-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Try New Protocol Upload Format
          </Link>
        </div>
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
            The system supports two CSV formats:
          </p>
          <ul className="mt-2 text-sm text-gray-500 list-disc list-inside">
            <li>
              <strong>Classic Format:</strong> CSV with columns for Main Folder/Folder, Reviewer, Document, Link/Folder Link
            </li>
            <li>
              <strong>New Protocol Format:</strong> CSV with columns for SPUP REC Code, Principal Investigator, Research Title, Adviser, Course/Program, E Link, and reviewer assignments (PRA1, PRA2, ICA, IACUC, IACUC2, CREF1, CREF2)
            </li>
          </ul>
          <p className="mt-2 text-sm text-gray-500">
            The filename should include release period information for automatic due date calculation.
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

      {showPreview && (
        <div className="mt-8">
          <h2 className="text-xl font-bold mb-4">Preview</h2>
          
          <div className="border-b border-gray-200 mb-4">
            <nav className="-mb-px flex space-x-8">
              <button
                onClick={() => setActiveTab('protocols')}
                className={`pb-2 font-medium text-sm ${
                  activeTab === 'protocols'
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                Protocol Preview
              </button>
              <button
                onClick={() => setActiveTab('json')}
                className={`pb-2 font-medium text-sm ${
                  activeTab === 'json'
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                JSON Structure
              </button>
            </nav>
          </div>
          
          {activeTab === 'protocols' && (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                {previewData.map((protocol, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {protocol.protocol_name}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {renderProtocolJsonPreview(protocol)}
                    </td>
                  </tr>
                ))}
              </table>
              
              {previewData.length < protocols.length && (
                <p className="text-sm text-gray-500 mt-2">
                  Showing {previewData.length} of {protocols.length} protocols...
                </p>
              )}
            </div>
          )}
          
          {activeTab === 'json' && jsonPreview && (
            <div className="mt-4">
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                <h3 className="text-lg font-medium mb-2">Firestore Database Structure</h3>
                <p className="text-sm text-gray-600 mb-4">
                  This is how your data will be structured in the Firestore database. Each protocol will be stored with the structure shown below.
                </p>
                
                <div className="relative">
                  <div className="absolute top-2 right-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(jsonPreview.structure);
                        showNotification('success', 'Copied', 'JSON structure copied to clipboard');
                      }}
                      className="text-sm text-blue-600 hover:text-blue-800"
                    >
                      Copy
                    </button>
                  </div>
                  <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg text-sm overflow-x-auto">
                    {jsonPreview.structure}
                  </pre>
                </div>
                
                <p className="text-sm text-gray-600 mt-4">
                  <strong>Note:</strong> The actual data structure may vary based on the content of your CSV file. 
                  Null or undefined values will not be stored in the database.
                </p>
              </div>
            </div>
          )}
          
          <div className="mt-6 flex flex-wrap items-center space-x-4">
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