'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, doc, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import fs from 'fs/promises';
import path from 'path';

interface Reviewer {
  id: string;
  name: string;
}

interface ReviewerData {
  name: string;
}

interface ReviewersJSON {
  reviewers: Record<string, ReviewerData>;
}

export default function ReviewersPage() {
  const [reviewers, setReviewers] = useState<Reviewer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [jsonData, setJsonData] = useState<ReviewersJSON | null>(null);
  
  useEffect(() => {
    fetchReviewers();
    loadReviewersJSON();
  }, []);
  
  const loadReviewersJSON = async () => {
    try {
      // In a real environment, this would be an API call
      // For simplicity, we're hardcoding the JSON data here
      const reviewersData: ReviewersJSON = {
        "reviewers": {
          "DRAPL-001": {
            "name": "Dr. Allan Paulo L. Blaquera"
          },
          "DRNRD-002": {
            "name": "Dr. Nova R. Domingo"
          },
          "DRCUG-003": {
            "name": "Dr. Claudeth U. Gamiao"
          },
          "DRMKL-004": {
            "name": "Dr. Mark Klimson L. Luyun"
          },
          "MRWDM-005": {
            "name": "Mr. Wilfredo DJ P. Martin IV"
          },
          "MRSGI-006": {
            "name": "Mr. Sergio G. Imperio"
          },
          "DRMLB-007": {
            "name": "Dr. Marjorie L. Bambalan"
          },
          "MRSEI-008": {
            "name": "Mrs. Elizabeth C. Iquin"
          },
          "DRMT-009": {
            "name": "Dr. Milrose Tangonan"
          },
          "ENGVCB-010": {
            "name": "Engr. Verge C. Baccay"
          },
          "MRET-011": {
            "name": "Mr. Everett T. Laureta"
          },
          "MRMFBA-012": {
            "name": "Mrs. Maria Felina B. Agbayani"
          },
          "MRRBD-013": {
            "name": "Mrs. Rita B. Daliwag"
          },
          "MRLJ-014": {
            "name": "Mrs. Lita Jose"
          },
          "DRCDC-015": {
            "name": "Dr. Corazon Dela Cruz"
          },
          "DREY-016": {
            "name": "Dr. Ester Yu"
          },
          "MRAP-017": {
            "name": "Mr. Angelo Peralta"
          },
          "DRJF-018": {
            "name": "Dr. Janette Fermin"
          },
          "MRRF-019": {
            "name": "Mr. Rogelio Fermin"
          },
          "MRSVS-020": {
            "name": "Mrs. Vivian Sorita"
          },
          "DRBJ-021": {
            "name": "Dr. Benjamin Jularbal"
          },
          "MRSKC-022": {
            "name": "Mrs. Kristine Joy O. Cortes"
          },
          "MRSJS-023": {
            "name": "Mrs. Jean Sumait"
          },
          "DREEC-024": {
            "name": "Dr. Emman Earl Cacayurin"
          },
          "DRMT-025": {
            "name": "Dr. Marites Tenedor"
          },
          "DRMJM-026": {
            "name": "Dr. MJ Manuel"
          }
        }
      };
      
      setJsonData(reviewersData);
    } catch (err) {
      console.error('Error loading JSON data:', err);
      setError('Failed to load reviewers JSON data');
    }
  };
  
  const fetchReviewers = async () => {
    try {
      setLoading(true);
      const reviewersRef = collection(db, 'reviewers');
      const querySnapshot = await getDocs(reviewersRef);
      
      const reviewersList: Reviewer[] = [];
      querySnapshot.forEach((doc) => {
        reviewersList.push({ 
          id: doc.id, 
          name: doc.data().name || doc.id 
        });
      });
      
      setReviewers(reviewersList.sort((a, b) => a.name.localeCompare(b.name)));
      setError(null);
    } catch (err) {
      console.error('Error fetching reviewers:', err);
      setError('Failed to load reviewers');
    } finally {
      setLoading(false);
    }
  };
  
  const importReviewersFromJSON = async () => {
    try {
      if (!jsonData || !jsonData.reviewers) {
        setImportStatus('No reviewers data available to import');
        return;
      }
      
      setImporting(true);
      setImportStatus(null);
      
      // Get data from the JSON
      const jsonReviewers = jsonData.reviewers;
      
      if (Object.keys(jsonReviewers).length === 0) {
        setImportStatus('No reviewers found in the JSON data');
        setImporting(false);
        return;
      }
      
      // Use batch write for better performance
      const batch = writeBatch(db);
      
      // Process reviewers
      for (const [id, reviewer] of Object.entries(jsonReviewers)) {
        const reviewerRef = doc(collection(db, 'reviewers'), id);
        batch.set(reviewerRef, {
          name: reviewer.name
        }, { merge: true });
      }
      
      // Commit the batch
      await batch.commit();
      
      // Refresh the list
      await fetchReviewers();
      
      setImportStatus(`Successfully imported ${Object.keys(jsonReviewers).length} reviewers`);
    } catch (err) {
      console.error('Error importing reviewers:', err);
      setImportStatus(`Failed to import reviewers: ${err}`);
    } finally {
      setImporting(false);
    }
  };
  
  if (loading && !jsonData) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md flex justify-center">
        <p>Loading reviewers...</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Reviewers Management</h1>
        <div className="flex space-x-4">
          <Link
            href="/admin"
            className="bg-gray-200 text-gray-700 py-2 px-4 rounded hover:bg-gray-300"
          >
            Back to Dashboard
          </Link>
          
          <button
            onClick={importReviewersFromJSON}
            disabled={importing || !jsonData}
            className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {importing ? 'Importing...' : 'Import Reviewers from JSON'}
          </button>
        </div>
      </div>
      
      {error && (
        <div className="p-4 bg-red-100 text-red-800 rounded">
          {error}
        </div>
      )}
      
      {importStatus && (
        <div className={`p-4 ${importStatus.includes('Failed') ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'} rounded`}>
          {importStatus}
        </div>
      )}
      
      <div className="bg-white p-6 rounded-lg shadow-md">
        <h2 className="text-xl font-semibold mb-6">All Reviewers ({reviewers.length})</h2>
        
        {reviewers.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No reviewers found in the database.</p>
            <p>Click the "Import Reviewers from JSON" button to import reviewers from the JSON file.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {reviewers.map((reviewer) => (
              <div 
                key={reviewer.id} 
                className="p-4 border rounded-lg hover:shadow-md"
              >
                <div className="flex items-center">
                  <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-800 font-bold">
                    {reviewer.name.charAt(0)}
                  </div>
                  <div className="ml-3">
                    <p className="font-medium">{reviewer.name}</p>
                    <p className="text-xs text-gray-500">{reviewer.id}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {jsonData && (
        <div className="bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">JSON Preview</h2>
          <div className="bg-gray-100 p-4 rounded overflow-auto max-h-96">
            <pre className="text-sm">
              {JSON.stringify(jsonData, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
} 