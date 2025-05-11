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
  
  const markAsCompleted = async () => {
    if (!protocol) return;
    
    try {
      setStatusChanging(true);
      setSuccessMessage(null);
      
      const protocolRef = doc(db, 'protocols', protocol.id);
      const currentTime = new Date().toISOString();
      
      // Update the protocol with new data
      const updates: any = { completed_at: currentTime };
      
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
            updatedReviewers[i] = { ...r, status: 'Completed' };
            userFound = true;
            break;
          }
        }
        
        // If user wasn't found in the array, add them
        if (!userFound) {
          updatedReviewers.push({
            id: reviewer.id,
            name: reviewer.name,
            status: 'Completed'
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
          status: 'Completed'
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
  
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100">
        <header className="bg-slate-800 text-white p-4">
          <div className="container mx-auto">
            <h1 className="text-xl font-bold">e-REC Reviewer Portal</h1>
          </div>
        </header>
        <main className="container mx-auto p-4">
          <div className="bg-white p-6 rounded-lg shadow-md flex justify-center">
            <p>Loading protocol details...</p>
          </div>
        </main>
      </div>
    );
  }
  
  if (error || !protocol) {
    return (
      <div className="min-h-screen bg-gray-100">
        <header className="bg-slate-800 text-white p-4">
          <div className="container mx-auto">
            <h1 className="text-xl font-bold">e-REC Reviewer Portal</h1>
          </div>
        </header>
        <main className="container mx-auto p-4">
          <div className="bg-white p-6 rounded-lg shadow-md">
            <p className="text-red-600 mb-4">{error || 'Protocol not found'}</p>
            <Link href="/reviewer/dashboard" className="bg-blue-500 text-white py-2 px-4 rounded">
              Back to Dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }
  
  const currentReviewerStatus = getCurrentReviewerStatus();
  
  return (
    <div className="min-h-screen bg-gray-100">  
      <main className="container mx-auto p-4">
        <div className="mb-4">
          <Link href="/reviewer/dashboard" className="text-blue-500 hover:underline flex items-center">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
        </div>
        
        {successMessage && (
          <div className="mb-4 p-3 bg-green-100 text-green-800 rounded">
            {successMessage}
          </div>
        )}
        
        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-800 rounded">
            {error}
          </div>
        )}
        
        <div className="bg-white p-6 rounded-lg shadow-md mb-6">
          <div className="flex justify-between items-start mb-6">
            <h1 className="text-2xl font-bold">{protocol.protocol_name}</h1>
            <div>
              <div className="flex items-center">
                {currentReviewerStatus === 'Completed' ? (
                  <div className="flex items-center">
                    <div className="w-6 h-6 mr-2 rounded-full border-2 border-green-500 flex items-center justify-center">
                      <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full text-sm font-medium">
                      Completed
                    </span>
                  </div>
                ) : protocol.due_date && isOverdue(protocol.due_date) ? (
                  <div className="flex items-center">
                    <div className="w-6 h-6 mr-2 rounded-full border-2 border-red-500 flex items-center justify-center">
                      <svg className="w-4 h-4 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="bg-red-100 text-red-800 px-3 py-1 rounded-full text-sm font-medium">
                      Overdue
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center">
                    <div className="w-6 h-6 mr-2 rounded-full border-2 border-yellow-500 flex items-center justify-center">
                      <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                    </div>
                    <span className="bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-sm font-medium">
                      In Progress
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          {/* Progress Tracker */}
          <div className="mb-8">
            <div className="relative">
              <div className="overflow-hidden h-2 mb-4 text-xs flex rounded bg-gray-200">
                <div 
                  style={{ width: currentReviewerStatus === 'Completed' ? '100%' : '50%' }} 
                  className={`shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center ${currentReviewerStatus === 'Completed' ? 'bg-green-500' : 'bg-yellow-500'}`}
                ></div>
              </div>
              <div className="flex justify-between">
                <div className="text-xs text-gray-500">Assigned</div>
                <div className="text-xs text-gray-500">In Progress</div>
                <div className="text-xs text-gray-500">Completed</div>
              </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <h2 className="text-lg font-semibold mb-4">Protocol Information</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Form Type</p>
                  <p className="font-medium">
                    {formInfo.formName}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Release Period</p>
                  <p className="font-medium">{protocol.release_period}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Academic Level</p>
                  <p className="font-medium">{protocol.academic_level}</p>
                </div>
              </div>
            </div>
            
            <div>
              <h2 className="text-lg font-semibold mb-4">Review Information</h2>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-gray-500">Reviewer</p>
                  <p className="font-medium">{reviewer.name}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Due Date</p>
                  <p className={`font-medium ${protocol.due_date && isOverdue(protocol.due_date) && currentReviewerStatus !== 'Completed' ? 'text-red-600' : ''}`}>
                    {protocol.due_date ? formatDate(protocol.due_date) : 'Not set'}
                    {protocol.due_date && isOverdue(protocol.due_date) && currentReviewerStatus !== 'Completed' && (
                      <span className="ml-2 text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                        Overdue
                      </span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500">Assigned Date</p>
                  <p className="font-medium">{new Date(protocol.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            </div>
          </div>
          
          {/* Action Buttons Section */}
          <div className="mb-8 bg-gray-50 p-6 rounded-lg border border-gray-200">
            <h2 className="text-xl font-semibold mb-4">Review Actions</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <h3 className="text-md font-medium mb-3">Step 1: Access Protocol Document</h3>
                <a 
                  href={protocol.protocol_file} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="bg-blue-600 text-white py-3 px-4 rounded-md inline-flex items-center hover:bg-blue-700 w-full justify-center"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                  Open Protocol in SharePoint
                </a>
              </div>
              
              <div>
                <h3 className="text-md font-medium mb-3">Step 2: Submit Review Form</h3>
                {formInfo.formUrl ? (
                  <button 
                    className="bg-indigo-600 text-white py-3 px-4 rounded-md inline-flex items-center hover:bg-indigo-700 w-full justify-center"
                    onClick={() => openForm(formInfo.formUrl)}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Open {formInfo.formType || 'Review'} Form
                  </button>
                ) : (
                  <div className="bg-gray-100 p-3 rounded-md text-sm text-gray-600">
                    Please select the appropriate form below
                  </div>
                )}
              </div>
            </div>
            
            <div className="mt-6">
              <h3 className="text-md font-medium mb-3">Step 3: Mark Review Status</h3>
              {currentReviewerStatus === 'In Progress' ? (
                <button
                  onClick={markAsCompleted}
                  disabled={statusChanging}
                  className="bg-green-600 text-white py-3 px-4 rounded-md inline-flex items-center hover:bg-green-700 w-full justify-center disabled:opacity-50"
                >
                  {statusChanging ? (
                    <span className="flex items-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Updating...
                    </span>
                  ) : (
                    <span className="flex items-center">
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                      </svg>
                      Mark Review as Completed
                    </span>
                  )}
                </button>
              ) : (
                <button
                  onClick={markAsInProgress}
                  disabled={statusChanging}
                  className="bg-yellow-500 text-white py-3 px-4 rounded-md inline-flex items-center hover:bg-yellow-600 w-full justify-center disabled:opacity-50"
                >
                  {statusChanging ? (
                    <span className="flex items-center">
                      <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Updating...
                    </span>
                  ) : (
                    <span className="flex items-center">
                      <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                      </svg>
                      Return to In Progress
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
          
          {/* All Available Forms */}
          <div className="border-t pt-6">
            <h2 className="text-lg font-semibold mb-4">All Available Review Forms</h2>
            <p className="mb-4 text-sm text-gray-600">
              If the auto-detected form is incorrect, you can select from any of the forms below:
            </p>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button 
                className={`py-2 px-4 rounded ${formInfo.formType === 'ICA' ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                onClick={() => openForm(getFormUrl('ICA'))}
              >
                ICA Form
              </button>
              <button 
                className={`py-2 px-4 rounded ${formInfo.formType === 'PRA' ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                onClick={() => openForm(getFormUrl('PRA'))}
              >
                PRA Form
              </button>
              <button 
                className={`py-2 px-4 rounded ${formInfo.formType === 'CFEFR' ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                onClick={() => openForm(getFormUrl('CFEFR'))}
              >
                CFEFR Form
              </button>
              <button 
                className={`py-2 px-4 rounded ${formInfo.formType === 'PRA-EX' || formInfo.formType === 'PRA_EX' ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                onClick={() => openForm(getFormUrl('PRA-EX'))}
              >
                PRA-EX Form
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 