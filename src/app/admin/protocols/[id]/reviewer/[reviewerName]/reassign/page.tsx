'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { doc, getDoc, collection, getDocs, updateDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import { getFormTypeName } from '@/lib/utils';

interface ReviewerData {
  id: string;
  name: string;
  status: string;
  document_type?: string;
  due_date?: string;
}

interface Protocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  reviewer: string;
  reviewers?: ReviewerData[];
  due_date: string;
  status: string;
  protocol_file: string;
  document_type: string;
  created_at: string;
  spup_rec_code?: string;
  research_title?: string;
  course_program?: string;
  principal_investigator?: string;
  adviser?: string;
  reassignment_history?: {
    from: string;
    to: string;
    date: Timestamp;
    reason: string;
  }[];
}

export default function ReassignReviewerPage() {
  const params = useParams();
  const id = params.id as string;
  const reviewerName = decodeURIComponent(params.reviewerName as string);
  const router = useRouter();
  
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [currentReviewer, setCurrentReviewer] = useState<ReviewerData | null>(null);
  const [availableReviewers, setAvailableReviewers] = useState<ReviewerData[]>([]);
  const [selectedReviewer, setSelectedReviewer] = useState<string>('');
  const [newDueDate, setNewDueDate] = useState<string>('');
  const [reassignmentReason, setReassignmentReason] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch protocol data
        const protocolRef = doc(db, 'protocols', id);
        const protocolSnap = await getDoc(protocolRef);
        
        if (!protocolSnap.exists()) {
          setError('Protocol not found');
          setLoading(false);
          return;
        }
        
        const protocolData = { 
          id: protocolSnap.id,
          ...protocolSnap.data() 
        } as Protocol;
        
        setProtocol(protocolData);
        
        // Find the current reviewer in the protocol
        let foundReviewer: ReviewerData | null = null;
        
        if (protocolData.reviewers && protocolData.reviewers.length > 0) {
          foundReviewer = protocolData.reviewers.find(r => r.name === reviewerName) || null;
        } else if (protocolData.reviewer === reviewerName) {
          // For legacy format
          foundReviewer = {
            id: reviewerName,
            name: reviewerName,
            status: protocolData.status,
            document_type: protocolData.document_type,
            due_date: protocolData.due_date
          };
        }
        
        if (!foundReviewer) {
          setError('Reviewer not found in this protocol');
          setLoading(false);
          return;
        }
        
        setCurrentReviewer(foundReviewer);
        
        // Auto-calculate new due date (14 days from today)
        const today = new Date();
        const futureDate = new Date();
        futureDate.setDate(today.getDate() + 14); // Add 14 days
        setNewDueDate(futureDate.toISOString().split('T')[0]);
        
        // Fetch all reviewers
        const reviewersRef = collection(db, 'reviewers');
        const reviewersSnap = await getDocs(reviewersRef);
        
        const reviewersData: ReviewerData[] = [];
        reviewersSnap.forEach((doc) => {
          const reviewer = { id: doc.id, ...doc.data() } as ReviewerData;
          
          // Skip the current reviewer and any reviewers already assigned to this protocol
          if (reviewer.name !== reviewerName && 
              (!protocolData.reviewers || 
                !protocolData.reviewers.some(r => r.name === reviewer.name))) {
            reviewersData.push(reviewer);
          }
        });
        
        setAvailableReviewers(reviewersData);
        
      } catch (err) {
        console.error('Error fetching data:', err);
        setError('Failed to load data');
      } finally {
        setLoading(false);
      }
    };
    
    fetchData();
  }, [id, reviewerName]);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!protocol || !currentReviewer) {
      setError('Protocol or reviewer data is missing');
      return;
    }
    
    if (!selectedReviewer) {
      setError('Please select a new reviewer');
      return;
    }
    
    if (!newDueDate) {
      setError('Please set a due date');
      return;
    }
    
    if (!reassignmentReason.trim()) {
      setError('Please provide a reason for reassignment');
      return;
    }
    
    try {
      setSubmitting(true);
      setError(null);
      setSuccess(null);
      
      const protocolRef = doc(db, 'protocols', protocol.id);
      
      // Find the selected reviewer's full info
      const newReviewerInfo = availableReviewers.find(r => r.name === selectedReviewer);
      
      if (!newReviewerInfo) {
        throw new Error('Selected reviewer not found');
      }
      
      // Create new reviewer object
      const newReviewer: ReviewerData = {
        id: newReviewerInfo.id || selectedReviewer,
        name: selectedReviewer,
        status: 'In Progress',
        document_type: currentReviewer.document_type,
        due_date: newDueDate
      };
      
      // Create reassignment history entry
      const reassignmentEntry = {
        from: currentReviewer.name,
        to: selectedReviewer,
        date: Timestamp.now(),
        reason: reassignmentReason
      };
      
      if (protocol.reviewers && protocol.reviewers.length > 0) {
        // Replace the current reviewer with the new reviewer in the reviewers array
        const updatedReviewers = protocol.reviewers.map(r => 
          r.name === currentReviewer.name ? newReviewer : r
        );
        
        // Update the protocol with the new reviewer
        await updateDoc(protocolRef, {
          reviewers: updatedReviewers,
          // Add reassignment to history
          reassignment_history: protocol.reassignment_history 
            ? [...protocol.reassignment_history, reassignmentEntry]
            : [reassignmentEntry]
        });
      } else {
        // For legacy protocols with just a reviewer field
        await updateDoc(protocolRef, {
          reviewer: selectedReviewer,
          due_date: newDueDate,
          reviewers: [newReviewer],
          // Add reassignment to history
          reassignment_history: protocol.reassignment_history 
            ? [...protocol.reassignment_history, reassignmentEntry]
            : [reassignmentEntry]
        });
      }
      
      setSuccess('Reviewer successfully reassigned!');
      
      // Navigate back to the protocol details page after a short delay
      setTimeout(() => {
        router.push(`/admin/protocols/${protocol.id}`);
      }, 2000);
      
    } catch (err) {
      console.error('Error reassigning reviewer:', err);
      setError('Failed to reassign reviewer');
    } finally {
      setSubmitting(false);
    }
  };
  
  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md">
        <p>Loading data...</p>
      </div>
    );
  }
  
  if (error && !protocol) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md">
        <p className="text-red-600">{error}</p>
        <div className="mt-4">
          <Link href="/admin/protocols" className="text-blue-500 hover:underline">
            Back to Protocols
          </Link>
        </div>
      </div>
    );
  }
  
  return (
    <div className="space-y-6 p-6">      
      <div className="p-6 bg-white rounded-lg shadow-md">
        {protocol && currentReviewer && (
          <>
            <div className="mb-6">
            <h1 className="text-2xl font-bold mb-4 border-b-2 border-gray-200 pb-2">Reassign Reviewer</h1>
              <h2 className="text-xl font-semibold mb-4">Protocol Information</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500">SPUP REC Code</p>
                  <p className="font-medium">{protocol.spup_rec_code || protocol.id}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Research Title</p>
                  <p className="font-medium">{protocol.research_title || protocol.protocol_name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Release Period</p>
                  <p className="font-medium">{protocol.release_period}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Academic Level</p>
                  <p className="font-medium">{protocol.academic_level}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Form Type</p>
                  <p className="font-medium">
                    {currentReviewer.document_type ? (
                      <>
                        {currentReviewer.document_type}
                        <span className="ml-2 text-xs text-blue-600">
                          ({getFormTypeName(currentReviewer.document_type)})
                        </span>
                      </>
                    ) : protocol.document_type ? (
                      <>
                        {protocol.document_type}
                        <span className="ml-2 text-xs text-blue-600">
                          ({getFormTypeName(protocol.document_type)})
                        </span>
                      </>
                    ) : 'Not specified'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Current Reviewer</p>
                  <div className="flex items-center space-x-1">
                    <span>{currentReviewer.name}</span>
                    <span className={`inline-block w-2 h-2 rounded-full ${
                      currentReviewer.status === 'Completed' ? 'bg-green-500' : 'bg-yellow-500'
                    }`}></span>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Current Due Date</p>
                  <p className="font-medium text-red-600">
                    {currentReviewer.due_date || protocol.due_date} 
                    {new Date(currentReviewer.due_date || protocol.due_date) < new Date() ? ' (Overdue)' : ''}
                  </p>
                </div>
              </div>
            </div>
            
            <form onSubmit={handleSubmit}>
              <h2 className="text-xl font-semibold mb-4">Reassignment Details</h2>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select New Reviewer
                </label>
                {availableReviewers.length === 0 ? (
                  <p className="text-gray-500">No available reviewers found.</p>
                ) : (
                  <select
                    value={selectedReviewer}
                    onChange={(e) => setSelectedReviewer(e.target.value)}
                    className="p-2 border rounded-md w-full"
                    required
                  >
                    <option value="">-- Select a reviewer --</option>
                    {availableReviewers.map((reviewer) => (
                      <option key={reviewer.id} value={reviewer.name}>
                        {reviewer.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  New Due Date
                </label>
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="p-2 border rounded-md w-full"
                  required
                />
                <p className="mt-1 text-sm text-gray-500">
                  Default is 14 days from today: {new Date(newDueDate).toLocaleDateString()}
                </p>
              </div>
              
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reason for Reassignment
                </label>
                <textarea
                  value={reassignmentReason}
                  onChange={(e) => setReassignmentReason(e.target.value)}
                  className="p-2 border rounded-md w-full h-24"
                  placeholder="Explain why this reviewer is being reassigned"
                  required
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
                  type="submit"
                  disabled={submitting || availableReviewers.length === 0 || !selectedReviewer}
                  className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 disabled:opacity-50"
                >
                  {submitting ? 'Reassigning...' : 'Reassign Reviewer'}
                </button>
                <Link 
                  href={`/admin/protocols/${id}`}
                  className="bg-gray-200 text-gray-700 py-2 px-4 rounded hover:bg-gray-300"
                >
                  Cancel
                </Link>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
} 