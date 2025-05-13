import { collection, getDocs, query, orderBy, Timestamp } from 'firebase/firestore';
import { db } from './firebaseconfig';

/**
 * Convert a Firestore timestamp to a readable date string
 */
const formatTimestamp = (timestamp: Timestamp | null | undefined): string => {
  if (!timestamp || !timestamp.toDate) return '';
  return timestamp.toDate().toISOString();
};

/**
 * Process Firestore data to make it export-friendly
 * - Converts Timestamps to ISO strings
 * - Converts arrays to JSON strings
 * - Handles nested objects
 */
const processFieldForExport = (value: any): string | number | boolean => {
  if (value === null || value === undefined) {
    return '';
  }
  
  if (value instanceof Timestamp) {
    return formatTimestamp(value);
  }
  
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  
  return value;
};

/**
 * Convert an array of objects to CSV format
 */
const convertToCSV = (data: any[]): string => {
  if (data.length === 0) return '';
  
  // Get all unique keys from all objects
  const allKeys = new Set<string>();
  data.forEach(item => {
    Object.keys(item).forEach(key => allKeys.add(key));
  });
  
  // Create header row
  const keys = Array.from(allKeys);
  let csv = keys.join(',') + '\n';
  
  // Add data rows
  data.forEach(item => {
    const row = keys.map(key => {
      const value = processFieldForExport(item[key]);
      
      // Properly handle values that might contain commas
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    
    csv += row.join(',') + '\n';
  });
  
  return csv;
};

/**
 * Process a collection for export
 */
const processCollectionForExport = (documents: any[]): any[] => {
  return documents.map(doc => {
    const processedDoc: { [key: string]: any } = { id: doc.id };
    
    // Process each field in the document
    Object.entries(doc.data()).forEach(([key, value]) => {
      processedDoc[key] = processFieldForExport(value);
    });
    
    return processedDoc;
  });
};

/**
 * Fetch and export a specific collection
 */
export const exportCollection = async (collectionName: string, orderByField?: string): Promise<{ csv: string, json: string }> => {
  try {
    let q;
    if (orderByField) {
      q = query(collection(db, collectionName), orderBy(orderByField));
    } else {
      q = query(collection(db, collectionName));
    }
    
    const querySnapshot = await getDocs(q);
    const documents = querySnapshot.docs;
    
    const processedData = processCollectionForExport(documents);
    
    // Generate CSV
    const csv = convertToCSV(processedData);
    
    // Generate JSON
    const json = JSON.stringify(processedData, null, 2);
    
    return { csv, json };
  } catch (error) {
    console.error(`Error exporting collection ${collectionName}:`, error);
    throw error;
  }
};

/**
 * Download data as a file
 */
export const downloadAsFile = (data: string, fileName: string, type: 'csv' | 'json'): void => {
  const mimeTypes = {
    csv: 'text/csv',
    json: 'application/json'
  };
  
  const blob = new Blob([data], { type: mimeTypes[type] });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

export const generateExportFileName = (collectionName: string, type: 'csv' | 'json'): string => {
  const date = new Date().toISOString().split('T')[0];
  return `${collectionName}_export_${date}.${type}`;
}; 