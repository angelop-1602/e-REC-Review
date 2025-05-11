'use client';

import { useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Reviewer {
  id: string;
  name: string;
}

interface Protocol {
  protocol_name: string;
  reviewer: string; // For backward compatibility
  reviewers?: Reviewer[]; // New field for multiple reviewers
}

export default function HomePage() {
  const [reviewerInput, setReviewerInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!reviewerInput.trim()) {
      setError('Please enter your Reviewer ID or name');
      return;
    }
    
    setLoading(true);
    setError(null);
    
    try {
      console.log("Attempting login with:", reviewerInput);
      
      // Check in protocols collection for the reviewer
      console.log("Checking protocols collection for reviewer");
      const protocolsRef = collection(db, 'protocols');
      const protocolsQuery = query(protocolsRef);
      const protocolsSnapshot = await getDocs(protocolsQuery);
      
      console.log("Found protocols:", protocolsSnapshot.size);
      
      // First look for a match in the reviewers array of each protocol
      let foundReviewer: { id: string; name: string } | null = null;
      
      protocolsSnapshot.forEach(doc => {
        const protocol = doc.data() as Protocol;
        
        // Check in reviewers array (new structure)
        if (protocol.reviewers && Array.isArray(protocol.reviewers)) {
          for (const reviewer of protocol.reviewers) {
            if ((reviewer.id && reviewer.id.toLowerCase() === reviewerInput.toLowerCase()) ||
                (reviewer.name && 
                 (reviewer.name.toLowerCase() === reviewerInput.toLowerCase() ||
                  reviewer.name.toLowerCase().includes(reviewerInput.toLowerCase()) ||
                  reviewerInput.toLowerCase().includes(reviewer.name.toLowerCase())))) {
              console.log("Found reviewer in reviewers array:", reviewer);
              foundReviewer = {
                id: reviewer.id || reviewer.name,
                name: reviewer.name
              };
              break;
            }
          }
        }
        
        // If not found in reviewers array, check the reviewer field (old structure)
        if (!foundReviewer && protocol.reviewer) {
          if (protocol.reviewer.toLowerCase() === reviewerInput.toLowerCase() ||
              protocol.reviewer.toLowerCase().includes(reviewerInput.toLowerCase()) ||
              reviewerInput.toLowerCase().includes(protocol.reviewer.toLowerCase())) {
            console.log("Found reviewer in reviewer field:", protocol.reviewer);
            foundReviewer = {
              id: protocol.reviewer,
              name: protocol.reviewer
            };
          }
        }
      });
      
      if (foundReviewer) {
        // Use the found reviewer info
        localStorage.setItem('reviewerId', foundReviewer.id);
        localStorage.setItem('reviewerName', foundReviewer.name);
        router.push('/reviewer/dashboard');
        return;
      }
      
      // Then, check reviewers collection
      const reviewersRef = collection(db, 'reviewers');
      const allReviewersQuery = query(reviewersRef);
      const allReviewers = await getDocs(allReviewersQuery);

      console.log("Total reviewers in collection:", allReviewers.size);
      
      let matchFound = false;
      
      // Check for name match in reviewer documents
      allReviewers.forEach(doc => {
        const reviewerData = doc.data();
        
        // Check if the input matches either the ID or name
        if (doc.id.toLowerCase() === reviewerInput.toLowerCase() || 
            (reviewerData.name && 
             (reviewerData.name.toLowerCase() === reviewerInput.toLowerCase() ||
              reviewerData.name.toLowerCase().includes(reviewerInput.toLowerCase()) ||
              reviewerInput.toLowerCase().includes(reviewerData.name.toLowerCase())))) {
          console.log("Found matching reviewer in reviewers collection:", doc.id);
          
          localStorage.setItem('reviewerId', doc.id);
          localStorage.setItem('reviewerName', reviewerData.name || doc.id);
          matchFound = true;
          router.push('/reviewer/dashboard');
          return;
        }
      });
      
      if (!matchFound) {
        // If we got here, no match was found
        setError('Reviewer ID or name not found. Please check and try again.');
      }
    } catch (err) {
      console.error('Login error:', err);
      setError('An error occurred during login. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-blue-50 to-indigo-100">
      <header className="bg-slate-800 text-white p-4">
        <div className="container mx-auto flex justify-between items-center">
          <h1 className="text-2xl font-bold">e-REC Ethics Review System</h1>

        </div>
      </header>
      
      <main className="flex-grow flex items-center justify-center p-4 ">
        <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-slate-800">e-REC Reviewer Portal</h1>
            <p className="text-gray-600 mt-2">Sign in to access your assigned protocols</p>
          </div>
          
          {error && (
            <div className="mb-4 p-3 bg-red-100 text-red-800 rounded text-sm">
              {error}
            </div>
          )}
          
          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label htmlFor="reviewerInput" className="block text-sm font-medium text-gray-700 mb-1">
                Reviewer Code
              </label>
              <input
                id="reviewerInput"
                type="text"
                placeholder="e.g., XXXX-0000"
                value={reviewerInput}
                onChange={(e) => setReviewerInput(e.target.value)}
                className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
              <p className="mt-1 text-xs text-gray-500">
                Enter your Reviewer Code as shown in the system
              </p>
            </div>
            
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-3 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50"
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </main>
      
      <footer className="mt-auto bg-slate-800 text-white p-4">
        <div className="container mx-auto text-center text-sm">
          &copy; {new Date().getFullYear()} e-REC Ethics Review System
        </div>
      </footer>
    </div>
  );
}
