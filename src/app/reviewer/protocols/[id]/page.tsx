'use client';

import { useState, useEffect } from 'react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import Script from 'next/script';
import { isOverdue, isDueSoon, getFormTypeName, formatDate, getReviewerFormType, getFormUrl } from '@/lib/utils';

interface Reviewer {
  id: string;
  name: string;
  status: string;
  document_type?: string;
  form_type?: string;
  due_date?: string;
  completed_at?: string;
}

interface Protocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  document_type: string;
  due_date: string;
  reviewer: string;  // For backward compatibility
  reviewers?: Reviewer[]; // New array structure
  status: string;
  protocol_file: string;
  created_at: string;
  completed_at?: string;
}

export default function ProtocolDetailPage() {
  const params = useParams();
  const id = typeof params?.id === 'string' ? params.id : '';
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [reviewer, setReviewer] = useState({ id: '', name: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusChanging, setStatusChanging] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [formInfo, setFormInfo] = useState<{formType: string; formName: string; formUrl: string}>({
    formType: '',
    formName: 'N/A',
    formUrl: ''
  });
  const router = useRouter();
  
  useEffect(() => {
    // Check if user is logged in
    const reviewerId = localStorage.getItem('reviewerId');
    const reviewerName = localStorage.getItem('reviewerName');
    
    if (!reviewerId) {
      router.push('/');
      return;
    }

    if (!id) {
      setError('Invalid protocol ID');
      setLoading(false);
      return;
    }
    
    setReviewer({
      id: reviewerId,
      name: reviewerName || reviewerId
    });
    
    fetchProtocolDetails(id, reviewerId, reviewerName || reviewerId);
  }, [id, router]);
  
  useEffect(() => {
    // Update form info when protocol changes
    if (protocol && reviewer) {
      const info = getReviewerFormType(protocol, reviewer.id, reviewer.name);
      setFormInfo(info);
    }
  }, [protocol, reviewer]);
  
  const fetchProtocolDetails = async (protocolId: string, reviewerId: string, reviewerName: string) => {
    try {
      setLoading(true);
      const protocolRef = doc(db, 'protocols', protocolId);
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
      
      // Check if this protocol is assigned to the current reviewer
      let isAssigned = false;
      
      // First check the reviewers array (new structure)
      if (protocolData.reviewers && Array.isArray(protocolData.reviewers)) {
        isAssigned = protocolData.reviewers.some(r => {
          const idMatch = r.id === reviewerId;
          const nameMatch = r.name === reviewerName;
          const nameIncludes = Boolean(r.name && reviewerName && r.name.toLowerCase().includes(reviewerName.toLowerCase()));
          const reverseIncludes = Boolean(reviewerName && r.name && reviewerName.toLowerCase().includes(r.name.toLowerCase()));
          
          return idMatch || nameMatch || nameIncludes || reverseIncludes;
        });
      }
      
      // Then check the single reviewer field (old structure)
      if (!isAssigned && protocolData.reviewer) {
        const idMatch = protocolData.reviewer === reviewerId;
        const nameMatch = protocolData.reviewer === reviewerName;
        const nameIncludes = Boolean(protocolData.reviewer && reviewerName && 
                            protocolData.reviewer.toLowerCase().includes(reviewerName.toLowerCase()));
        const reverseIncludes = Boolean(reviewerName && protocolData.reviewer && 
                                reviewerName.toLowerCase().includes(protocolData.reviewer.toLowerCase()));
        
        isAssigned = idMatch || nameMatch || nameIncludes || reverseIncludes;
      }
      
      if (!isAssigned) {
        setError('You do not have permission to view this protocol');
        setLoading(false);
        return;
      }
      
      setProtocol(protocolData);
      setError(null);
    } catch (err) {
      console.error('Error fetching protocol:', err);
      setError('Failed to load protocol details');
    } finally {
      setLoading(false);
    }
  };
  
  const completeReview = async () => {
    if (!protocol || !reviewer || !protocol.id) return;
    
    try {
      setStatusChanging(true);
      setSuccessMessage(null);
      
      const protocolRef = doc(db, 'protocols', protocol.id);
      const completedDate = new Date().toISOString();
      
      // Update the protocol with new data
      const updates: any = {
        completed_at: completedDate
      };
      
      // First update individual reviewer status in the reviewers array
      if (protocol.reviewers && Array.isArray(protocol.reviewers)) {
        const updatedReviewers = [...protocol.reviewers];
        let userFound = false;
        
        // Update the status of the current reviewer
        for (let i = 0; i < updatedReviewers.length; i++) {
          const r = updatedReviewers[i];
          const idMatch = r.id === reviewer.id;
          const nameMatch = r.name === reviewer.name;
          const nameIncludes = Boolean(r.name && reviewer.name && r.name.toLowerCase().includes(reviewer.name.toLowerCase()));
          const reverseIncludes = Boolean(reviewer.name && r.name && reviewer.name.toLowerCase().includes(r.name.toLowerCase()));
          
          if (idMatch || nameMatch || nameIncludes || reverseIncludes) {
            updatedReviewers[i] = { 
              ...r, 
              status: 'Completed',
              completed_at: completedDate
            };
            userFound = true;
            break;
          }
        }
        
        // If user wasn't found in the array, add them
        if (!userFound) {
          updatedReviewers.push({
            id: reviewer.id,
            name: reviewer.name,
            status: 'Completed',
            completed_at: completedDate
          });
        }
        
        updates.reviewers = updatedReviewers;
        
        // Check if all reviewers have completed their reviews
        const allCompleted = updatedReviewers.every(r => r.status === 'Completed');
        if (allCompleted) {
          updates.status = 'Completed';
        }
      } else {
        // Legacy behavior - update overall status
        updates.status = 'Completed';
        
        // Also add to reviewers array for future compatibility
        updates.reviewers = [{
          id: reviewer.id,
          name: reviewer.name,
          status: 'Completed',
          completed_at: completedDate
        }];
      }
      
      await updateDoc(protocolRef, updates);
      
      // Update the local state with the new data
      setProtocol({
        ...protocol,
        ...updates
      });
      
      setSuccessMessage('Protocol review marked as completed successfully!');
    } catch (err) {
      console.error('Error updating protocol status:', err);
      setError('Failed to update protocol status');
    } finally {
      setStatusChanging(false);
    }
  };
  
  const markAsInProgress = async () => {
    if (!protocol) return;
    
    try {
      setStatusChanging(true);
      setSuccessMessage(null);
      
      const protocolRef = doc(db, 'protocols', protocol.id);
      
      // Update the protocol with new data
      const updates: any = { 
        completed_at: null
      };
      
      // First update individual reviewer status in the reviewers array
      if (protocol.reviewers && Array.isArray(protocol.reviewers)) {
        const updatedReviewers = [...protocol.reviewers];
        let userFound = false;
        
        // Update the status of the current reviewer
        for (let i = 0; i < updatedReviewers.length; i++) {
          const r = updatedReviewers[i];
          const idMatch = r.id === reviewer.id;
          const nameMatch = r.name === reviewer.name;
          const nameIncludes = Boolean(r.name && reviewer.name && r.name.toLowerCase().includes(reviewer.name.toLowerCase()));
          const reverseIncludes = Boolean(reviewer.name && r.name && reviewer.name.toLowerCase().includes(r.name.toLowerCase()));
          
          if (idMatch || nameMatch || nameIncludes || reverseIncludes) {
            updatedReviewers[i] = { ...r, status: 'In Progress' };
            userFound = true;
            break;
          }
        }
        
        // If user wasn't found in the array, add them
        if (!userFound) {
          updatedReviewers.push({
            id: reviewer.id,
            name: reviewer.name,
            status: 'In Progress'
          });
        }
        
        updates.reviewers = updatedReviewers;
        
        // Set overall status to In Progress
        updates.status = 'In Progress';
      } else {
        // Legacy behavior - update overall status
        updates.status = 'In Progress';
        
        // Also add to reviewers array for future compatibility
        updates.reviewers = [{
          id: reviewer.id,
          name: reviewer.name,
          status: 'In Progress'
        }];
      }
      
      await updateDoc(protocolRef, updates);
      
      // Update the local state with the new data
      setProtocol({
        ...protocol,
        ...updates
      });
      
      setSuccessMessage('Protocol review marked as in progress');
    } catch (err) {
      console.error('Error updating protocol status:', err);
      setError('Failed to update protocol status');
    } finally {
      setStatusChanging(false);
    }
  };
  
  // Get the current reviewer's status
  const getCurrentReviewerStatus = (): string => {
    if (!protocol) return 'Unknown';
    
    if (protocol.reviewers && Array.isArray(protocol.reviewers)) {
      for (const r of protocol.reviewers) {
        const idMatch = r.id === reviewer.id;
        const nameMatch = r.name === reviewer.name;
        const nameIncludes = Boolean(r.name && reviewer.name && r.name.toLowerCase().includes(reviewer.name.toLowerCase()));
        const reverseIncludes = Boolean(reviewer.name && r.name && reviewer.name.toLowerCase().includes(r.name.toLowerCase()));
        
        if (idMatch || nameMatch || nameIncludes || reverseIncludes) {
          return r.status;
        }
      }
    }
    
    // Fall back to overall protocol status
    return protocol.status;
  };
  
  const handleLogout = () => {
    localStorage.removeItem('reviewerId');
    localStorage.removeItem('reviewerName');
    router.push('/');
  };
  
  // Function to open forms in a new window
  const openForm = (formUrl: string) => {
    window.open(formUrl, '_blank');
  };
  
  return (
    <div className="p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-gray-800">
          Protocol Details
        </h1>
        <Link
          href="/reviewer/dashboard"
          className="mt-2 sm:mt-0 text-sm text-blue-600 hover:text-blue-800 flex items-center"
        >
          ← Return to Dashboard
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-10">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-green-500"></div>
          <p className="mt-2 text-gray-500">Loading protocol details...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border-l-4 border-red-400 p-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </div>
        </div>
      ) : protocol ? (
        <>
          {successMessage && (
            <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-green-700">{successMessage}</p>
                </div>
              </div>
            </div>
          )}

          <div className="bg-white shadow overflow-hidden sm:rounded-lg">
            <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
              <h3 className="text-lg leading-6 font-medium text-gray-900 break-words">
                {protocol.protocol_name}
              </h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                {protocol.academic_level} • {protocol.release_period} Release
              </p>
            </div>
            
            <div className="border-t border-gray-200">
              <dl>
                <div className="bg-gray-50 px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Status</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      getCurrentReviewerStatus() === 'Completed'
                        ? 'bg-green-100 text-green-800'
                        : isOverdue(protocol.due_date)
                        ? 'bg-red-100 text-red-800'
                        : isDueSoon(protocol.due_date)
                        ? 'bg-yellow-100 text-yellow-800'
                        : 'bg-blue-100 text-blue-800'
                    }`}>
                      {getCurrentReviewerStatus() === 'Completed'
                        ? 'Completed'
                        : isOverdue(protocol.due_date)
                        ? 'Overdue'
                        : isDueSoon(protocol.due_date)
                        ? 'Due Soon'
                        : 'In Progress'}
                    </span>
                  </dd>
                </div>
                
                <div className="bg-white px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Due Date</dt>
                  <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                    {formatDate(protocol.due_date)}
                  </dd>
                </div>
                
                <div className="bg-gray-50 px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Review Form</dt>
                  <dd className="mt-1 text-sm sm:mt-0 sm:col-span-2">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <span className="text-gray-900">{formInfo.formName}</span>
                      <button
                        onClick={() => openForm(formInfo.formUrl)}
                        className="inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                        disabled={!formInfo.formUrl}
                      >
                        Open Review Form
                      </button>
                    </div>
                  </dd>
                </div>
                
                <div className="bg-white px-4 py-4 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">Protocol File</dt>
                  <dd className="mt-1 text-sm sm:mt-0 sm:col-span-2">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <span className="text-gray-900 break-all overflow-hidden text-ellipsis">{protocol.protocol_file}</span>
                      <a
                        href={protocol.protocol_file}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center px-3 py-1.5 border border-gray-300 text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                      >
                        View Protocol
                      </a>
                    </div>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
          
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-end">
            {getCurrentReviewerStatus() === 'Completed' ? (
              <button
                onClick={markAsInProgress}
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-yellow-600 hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
                disabled={statusChanging}
              >
                {statusChanging ? 'Processing...' : 'Mark as In Progress'}
              </button>
            ) : (
              <button
                onClick={completeReview}
                className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                disabled={statusChanging}
              >
                {statusChanging ? 'Processing...' : 'Mark as Completed'}
              </button>
            )}
            
            <Link
              href="/reviewer/dashboard"
              className="inline-flex justify-center py-2 px-4 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Return to Dashboard
            </Link>
          </div>
        </>
      ) : (
        <div className="text-center py-10">
          <p className="text-gray-500">No protocol data found.</p>
        </div>
      )}
      
      <Script src="https://forms.office.com/Pages/TopLevelScriptResources.aspx" strategy="lazyOnload" />
    </div>
  );
} 