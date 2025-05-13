'use client';

import { useState, useEffect } from 'react';
import { exportCollection, downloadAsFile, generateExportFileName } from '@/lib/exportUtils';
import { COLORS, STYLES } from '@/lib/colors';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';

export default function DataExportPage() {
  const [exportFormat, setExportFormat] = useState<'csv' | 'json'>('csv');
  const [loading, setLoading] = useState<boolean>(false);
  const [exportStatus, setExportStatus] = useState<{
    success?: string;
    error?: string;
  }>({});
  
  // Structure navigation state
  const [monthFolders, setMonthFolders] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [loadingStructure, setLoadingStructure] = useState<boolean>(true);

  // Load month folders on component mount
  useEffect(() => {
    fetchMonthFolders();
  }, []);

  // Function to fetch available months from Firestore
  const fetchMonthFolders = async () => {
    setLoadingStructure(true);
    try {
      // Get all month folders in protocols collection
      const protocolsRef = collection(db, 'protocols');
      const monthsSnapshot = await getDocs(protocolsRef);
      
      const months: string[] = [];
      
      // Get all month folders
      for (const monthDoc of monthsSnapshot.docs) {
        months.push(monthDoc.id);
      }
      
      setMonthFolders(months);
      
      // Set default selection if available
      if (months.length > 0) {
        setSelectedMonth(months[0]);
      }
    } catch (error) {
      console.error("Error fetching month folders:", error);
      setExportStatus({
        error: `Failed to load month folders: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setLoadingStructure(false);
    }
  };

  const handleExport = async () => {
    // Determine what to export based on selected month
    let exportPath = 'protocols';
    let exportLabel = 'All Protocols';
    
    if (selectedMonth) {
      exportPath = `protocols/${selectedMonth}`;
      exportLabel = `Protocols for ${selectedMonth}`;
    }

    try {
      setLoading(true);
      setExportStatus({});

      // Export collection or subcollection
      const data = await exportCollection(exportPath);
      
      // Generate filename with month included if filtering
      const fileName = generateExportFileName(
        selectedMonth ? `protocols_${selectedMonth}` : 'all_protocols', 
        exportFormat
      );
      
      // Download the file
      if (exportFormat === 'csv') {
        downloadAsFile(data.csv, fileName, 'csv');
      } else {
        downloadAsFile(data.json, fileName, 'json');
      }

      setExportStatus({
        success: `Successfully exported ${exportLabel} as ${exportFormat.toUpperCase()}`
      });
    } catch (error) {
      console.error('Export error:', error);
      setExportStatus({
        error: `Failed to export data: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <h1 style={STYLES.brandGreenText} className="text-2xl font-bold">Protocol Data Export</h1>
      
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-lg font-medium mb-4">Export Protocol Data</h2>
        
        <div className="space-y-6 max-w-2xl">
          {loadingStructure ? (
            <div className="text-center py-4">
              <p>Loading available months...</p>
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="month" className="block text-sm font-medium text-gray-700 mb-1">
                  Select Month
                </label>
                <select
                  id="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full p-2 border rounded focus:ring-green-500 focus:border-green-500"
                >
                  <option value="">All Months</option>
                  {monthFolders.map(month => (
                    <option key={month} value={month}>
                      {month}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-sm text-gray-500">
                  {selectedMonth 
                    ? `Export all protocols for ${selectedMonth}` 
                    : "Export protocols from all months"}
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Export Format
                </label>
                <div className="flex space-x-4">
                  <label className="inline-flex items-center">
                    <input
                      type="radio"
                      className="form-radio text-green-600"
                      name="exportFormat"
                      value="csv"
                      checked={exportFormat === 'csv'}
                      onChange={() => setExportFormat('csv')}
                    />
                    <span className="ml-2">CSV (Spreadsheet)</span>
                  </label>
                  <label className="inline-flex items-center">
                    <input
                      type="radio"
                      className="form-radio text-green-600"
                      name="exportFormat"
                      value="json"
                      checked={exportFormat === 'json'}
                      onChange={() => setExportFormat('json')}
                    />
                    <span className="ml-2">JSON (Data)</span>
                  </label>
                </div>
              </div>
            </>
          )}
          
          {exportStatus.success && (
            <div style={{ backgroundColor: COLORS.brand.green[50], color: COLORS.brand.green[800] }} className="p-3 rounded">
              {exportStatus.success}
            </div>
          )}
          
          {exportStatus.error && (
            <div className="p-3 bg-red-50 text-red-800 rounded">
              {exportStatus.error}
            </div>
          )}
          
          <div>
            <button
              onClick={handleExport}
              disabled={loading || loadingStructure}
              style={STYLES.brandGreenButton}
              className="px-6 py-2 rounded shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
            >
              {loading ? 'Exporting...' : 'Export Data'}
            </button>
          </div>
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-lg font-medium mb-4">Export Instructions</h2>
        
        <div className="prose prose-sm max-w-none">
          <p>
            This tool allows you to export protocol data from the e-REC Review System for reporting or analysis purposes.
          </p>
          
          <h3>How to use:</h3>
          <ol>
            <li>Select a month (or leave blank to export all months)</li>
            <li>Choose your preferred file format (CSV for spreadsheets, JSON for data processing)</li>
            <li>Click "Export Data" to generate and download the file</li>
          </ol>
          
          <h3>Data Security Notes:</h3>
          <ul>
            <li>Exported data may contain sensitive information - handle with care</li>
            <li>Store exported files securely and delete when no longer needed</li>
            <li>Follow your organization's data handling policies</li>
          </ul>
        </div>
      </div>
    </div>
  );
} 