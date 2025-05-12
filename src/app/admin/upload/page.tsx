'use client';

import { useState, ChangeEvent } from 'react';
import { collection, doc, writeBatch, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { getFormTypeName, processReleaseInfo } from '@/lib/utils';

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
  
  // Extract SPUP_REC_Code if available or generate one
  const spupRecCode = csvEntry['SPUP_REC_Code'] || 
                     csvEntry['REC Code'] || 
                     csvEntry['Protocol ID'] || 
                     `REC-${Math.floor(Math.random() * 10000).toString().padStart(4, '0')}`;
  
  // Extract principal investigator if available
  const principalInvestigator = csvEntry['Principal Investigator'] || 
                               csvEntry['PI'] || 
                               csvEntry['Investigator'] || 
                               '';
  
  // Extract adviser if available
  const adviser = csvEntry['Adviser'] || 
                 csvEntry['Advisor'] || 
                 '';
  
  // Extract course/program if available
  const courseProgram = csvEntry['Course'] || 
                       csvEntry['Program'] || 
                       csvEntry['Course/Program'] || 
                       '';
  
  // Extract release period from filename (e.g., first-release, april_1stweek)
  let releasePeriod = 'Unknown';
  let monthId = '';
  let weekId = '';
  
  if (filename.includes('first-release')) {
    releasePeriod = 'First';
  } else if (filename.includes('second-release')) {
    releasePeriod = 'Second';
  } else if (filename.includes('third-release')) {
    releasePeriod = 'Third';
  } else if (filename.includes('fourth-release')) {
    releasePeriod = 'Fourth';
  } else {
    // Check for month-week format (e.g., april_1stweek, may_2ndweek)
    const monthMatch = filename.match(/(january|february|march|april|may|june|july|august|september|october|november|december)/i);
    const weekMatch = filename.match(/(1st|2nd|3rd|4th)week/);
    
    if (monthMatch && weekMatch) {
      const month = monthMatch[0].charAt(0).toUpperCase() + monthMatch[0].slice(1).toLowerCase();
      const week = weekMatch[0].replace('week', '');
      
      // Extract month and year for the hierarchical path
      const currentYear = new Date().getFullYear();
      monthId = `${month}${currentYear}`;
      weekId = `week-${week.replace(/[a-z]/g, '')}`;
      
      releasePeriod = `${month} ${week} Week`;
    }
  }
  
  // Determine academic level from filename or protocol
  let academicLevel = 'Unknown';
  if (filename.includes('graduate')) {
    academicLevel = 'Graduate';
  } else if (filename.includes('undergraduate')) {
    academicLevel = 'Undergraduate';
  } else if (courseProgram && (
    courseProgram.includes('PhD') || 
    courseProgram.includes('Master') || 
    courseProgram.includes('MS') || 
    courseProgram.includes('MA')
  )) {
    academicLevel = 'Graduate';
  } else if (courseProgram) {
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
  const docId = spupRecCode || `${protocolNameField.replace(/\s+/g, '_')}_${documentField.replace(/\s+/g, '_')}_${reviewerCode}`;
  
  // Create a reviewer object with status
  const reviewerObj = {
    id: reviewerCode,
    name: reviewerField,
    status: 'In Progress',
    document_type: documentField,
    form_type: documentField,
    due_date: dueDate.toISOString().split('T')[0]
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
    created_at: new Date().toISOString(),
    // New fields for the new hierarchical structure
    research_title: protocolNameField,
    e_link: linkField,
    course_program: courseProgram,
    spup_rec_code: spupRecCode,
    principal_investigator: principalInvestigator,
    adviser: adviser,
    // Metadata for upload
    _path: monthId && weekId ? `${monthId}/${weekId}/${docId}` : null
  };
};

// Update this interface to include both old and new structure fields
interface MappedProtocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  reviewer: string; // For backward compatibility
  reviewers: { 
    id: string; 
    name: string; 
    status: string;
    document_type?: string;
    form_type?: string;
    due_date?: string;
  }[]; // New array of reviewers
  due_date: string;
  status: string; // Overall protocol status
  protocol_file: string;
  document_type: string;
  created_at: string;
  // New fields for the new structure
  research_title?: string;
  e_link?: string;
  course_program?: string;
  spup_rec_code?: string;
  principal_investigator?: string;
  adviser?: string;
  // Metadata for upload
  _path?: string | null;
}

// Define types to replace any
interface ParsedData {
  [key: string]: string;
}

export default function CSVUploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<ParsedData[] | null>(null);
  const [mappedData, setMappedData] = useState<MappedProtocol[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
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
      
      // Track which protocols have been processed
      const protocolsProcessed = new Set();
      
      // Group protocols by protocol_name
      const protocolGroups = mappedData.reduce((acc, protocol) => {
        if (!acc[protocol.protocol_name]) {
          acc[protocol.protocol_name] = [];
        }
        acc[protocol.protocol_name].push(protocol);
        return acc;
      }, {} as Record<string, MappedProtocol[]>);
      
      let successCount = 0;
      
      // Process each group of protocols (same protocol_name)
      for (const [protocolName, protocols] of Object.entries(protocolGroups) as [string, MappedProtocol[]][]) {
        try {
          // Use the first protocol as the base
          const baseProtocol = protocols[0];
          
          // Create an array of reviewers from all protocols in this group
          const reviewers = protocols.map((p: MappedProtocol) => {
            // Extract reviewer code from name or use as is if already a code
            const reviewerCode = p.reviewer.split(' ').length > 1 
              ? p.reviewer.split(' ').map((word: string) => word.charAt(0)).join('') // Get initials if it's a name
              : p.reviewer; // Use as is if it looks like a code
              
            return {
              id: reviewerCode,
              name: p.reviewer,
              document_type: p.document_type,
              form_type: p.document_type, // Use same value for form_type
              due_date: p.due_date,
              status: 'In Progress'
            };
          });
          
          // Generate a unique document ID or use SPUP_REC_Code
          const groupDocId = baseProtocol.spup_rec_code || 
                           `${protocolName.replace(/\s+/g, '_')}`;
          
          // Prepare protocol data for upload
          const protocolData = {
            // Fields using new structure naming
            research_title: protocolName,
            e_link: baseProtocol.protocol_file,
            course_program: baseProtocol.course_program || baseProtocol.academic_level,
            spup_rec_code: baseProtocol.spup_rec_code || groupDocId,
            principal_investigator: baseProtocol.principal_investigator || '',
            adviser: baseProtocol.adviser || '',
            // Required standard fields
            reviewers: reviewers,
            due_date: baseProtocol.due_date,
            status: 'In Progress',
            created_at: new Date().toISOString()
          };
          
          // Extract path information
          let monthId, weekId, docId;
          
          if (baseProtocol._path) {
            const pathParts = baseProtocol._path.split('/');
            if (pathParts.length === 3) {
              [monthId, weekId, docId] = pathParts;
            }
          }
          
          // If no path provided or invalid, use release period to determine month/week
          if (!monthId || !weekId) {
            // Extract month and week from release period (e.g., "May 2nd Week")
            const releaseParts = baseProtocol.release_period.split(' ');
            if (releaseParts.length >= 2) {
              monthId = releaseParts[0].toLowerCase(); // "May"
              
              // Extract week number from the release period
              const weekMatch = baseProtocol.release_period.match(/(\d+)/);
              if (weekMatch && weekMatch[1]) {
                const weekNum = parseInt(weekMatch[1], 10);
                weekId = `week-${weekNum}`;
              } else {
                weekId = 'week-1'; // default if we can't determine
              }
            } else {
              // Default values if we can't parse
              monthId = 'unknown';
              weekId = 'week-1';
            }
          }
          
          // Use SPUP_REC_Code as docId, or generate one
          docId = baseProtocol.spup_rec_code || groupDocId;
          
          try {
            console.log(`Creating protocol in structure: protocols/${monthId}/${weekId}/${docId}`);
            
            // Create directory structure using setDoc for nested collections
            await setDoc(
              doc(db, 'protocols', monthId, weekId, docId),
              protocolData
            );
            
            successCount++;
          } catch (err) {
            console.error(`Error creating protocol ${protocolName}:`, err);
            // Continue with other protocols even if one fails
          }
          
          protocolsProcessed.add(protocolName);
        } catch (err) {
          console.error(`Error processing protocol group ${protocolName}:`, err);
          // Continue with other protocols even if one fails
        }
      }
      
      setSuccess(`Successfully uploaded ${successCount} protocols to Firebase.`);
    } catch (err) {
      console.error('Error uploading to Firebase:', err);
      setError(`Failed to upload to Firebase: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-semibold mb-4">CSV Protocol Upload</h1>
      
      <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
        <div className="mb-4">
          <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="csvFile">
            Select CSV File
          </label>
          <input
            className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
            id="csvFile"
            type="file"
            accept=".csv"
            onChange={handleFileChange}
          />
          {error && <p className="text-red-500 text-xs mt-1">{error}</p>}
        </div>
        
        <div className="flex space-x-2">
          <button
            className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
            onClick={handleParse}
            disabled={!file || loading}
          >
            {loading ? 'Processing...' : 'Parse CSV'}
          </button>
          
          <button
            className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline"
            onClick={uploadToFirebase}
            disabled={!mappedData || loading}
          >
            {loading ? 'Uploading...' : 'Upload to Firebase'}
          </button>
        </div>
        
        {success && (
          <div className="mt-4 p-2 bg-green-100 text-green-700 rounded">
            {success}
          </div>
        )}
      </div>
      
      {/* Display parsed data if available */}
      {parsedData && mappedData && (
        <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 overflow-x-auto">
          <h2 className="text-lg font-medium mb-2">Mapped Data Preview</h2>
          <p className="text-sm text-gray-500 mb-4">
            Review this data before uploading to Firebase. We've mapped your CSV to our protocol structure.
          </p>
          
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  ID/REC Code
                </th>
                <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Protocol Name
                </th>
                <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Reviewer
                </th>
                <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Document Type
                </th>
                <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Due Date
                </th>
                <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Release Period
                </th>
                <th scope="col" className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Structure Path
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {mappedData.map((item, index) => (
                <tr key={index} className={(index % 2 === 0) ? 'bg-white' : 'bg-gray-50'}>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                    {item.spup_rec_code || item.id}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                    {item.protocol_name}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                    {item.reviewer}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                    {getFormTypeName(item.document_type)}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                    {item.due_date}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                    {item.release_period}
                  </td>
                  <td className="px-2 py-2 whitespace-nowrap text-sm text-gray-900">
                    {item._path || 'No path information'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
} 