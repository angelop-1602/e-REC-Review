'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import { isOverdue, isDueSoon, getFormTypeName, getReviewerFormType } from '@/lib/utils';

interface Reviewer {
  id: string;
  name: string;
  status: string;
  document_type: string;
  due_date: string;
}

// Define the Protocol type
interface Protocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  reviewer: string;
  reviewers?: Reviewer[];
  due_date: string;
  status: string;
  protocol_file: string;
  document_type: string;
  created_at: string;
  reassignment_history?: {
    from: string;
    to: string;
    date: any;
    reason: string;
  }[];
  // Add new properties for grouped protocols
  reviewerCount?: number;
  completedReviewerCount?: number;
  relatedProtocols?: Protocol[];
}

export default function ProtocolDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const router = useRouter();
  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusChanging, setStatusChanging] = useState(false);
  const [selectedReviewer, setSelectedReviewer] = useState<string | null>(null);
  
  useEffect(() => {
    const fetchProtocol = async () => {
      try {
        setLoading(true);
        const protocolRef = doc(db, 'protocols', id);
        const protocolSnap = await getDoc(protocolRef);
        
        if (protocolSnap.exists()) {
          setProtocol({
            id: protocolSnap.id,
            ...protocolSnap.data()
          } as Protocol);
        } else {
          setError('Protocol not found');
        }
      } catch (err) {
        console.error('Error fetching protocol:', err);
        setError('Failed to load protocol details');
      } finally {
        setLoading(false);
      }
    };
    
    fetchProtocol();
  }, [id]);
  
  const markAsCompleted = async () => {
    if (!protocol) return;
    
    try {
      setStatusChanging(true);
      const protocolRef = doc(db, 'protocols', protocol.id);
      
      // If we're updating a specific reviewer's status
      if (selectedReviewer && protocol.reviewers) {
        const updatedReviewers = protocol.reviewers.map(r => 
          r.name === selectedReviewer 
            ? { ...r, status: 'Completed' } 
            : r
        );
        
        // Check if all reviewers are completed to update overall status
        const allCompleted = updatedReviewers.every(r => r.status === 'Completed');
        const someCompleted = updatedReviewers.some(r => r.status === 'Completed');
        
        let newStatus = 'In Progress';
        if (allCompleted) {
          newStatus = 'Completed';
        } else if (someCompleted) {
          newStatus = 'Partially Completed';
        }
        
        await updateDoc(protocolRef, {
          reviewers: updatedReviewers,
          status: newStatus
        });
        
        setProtocol({
          ...protocol,
          reviewers: updatedReviewers,
          status: newStatus
        });
      } else {
        // Legacy update for overall status
        await updateDoc(protocolRef, {
          status: 'Completed',
          // If reviewers array exists, mark all as completed
          ...(protocol.reviewers ? {
            reviewers: protocol.reviewers.map(r => ({ ...r, status: 'Completed' }))
          } : {})
        });
        
        setProtocol({
          ...protocol,
          status: 'Completed',
          ...(protocol.reviewers ? {
            reviewers: protocol.reviewers.map(r => ({ ...r, status: 'Completed' }))
          } : {})
        });
      }
    } catch (err) {
      console.error('Error updating protocol status:', err);
      setError('Failed to update protocol status');
    } finally {
      setStatusChanging(false);
      setSelectedReviewer(null);
    }
  };
  
  const markAsInProgress = async () => {
    if (!protocol) return;
    
    try {
      setStatusChanging(true);
      const protocolRef = doc(db, 'protocols', protocol.id);
      
      // If we're updating a specific reviewer's status
      if (selectedReviewer && protocol.reviewers) {
        const updatedReviewers = protocol.reviewers.map(r => 
          r.name === selectedReviewer 
            ? { ...r, status: 'In Progress' } 
            : r
        );
        
        // Check if any reviewers are still completed to update overall status
        const someCompleted = updatedReviewers.some(r => r.status === 'Completed');
        const newStatus = someCompleted ? 'Partially Completed' : 'In Progress';
        
        await updateDoc(protocolRef, {
          reviewers: updatedReviewers,
          status: newStatus
        });
        
        setProtocol({
          ...protocol,
          reviewers: updatedReviewers,
          status: newStatus
        });
      } else {
        // Legacy update for overall status
        await updateDoc(protocolRef, {
          status: 'In Progress',
          // If reviewers array exists, mark all as in progress
          ...(protocol.reviewers ? {
            reviewers: protocol.reviewers.map(r => ({ ...r, status: 'In Progress' }))
          } : {})
        });
        
        setProtocol({
          ...protocol,
          status: 'In Progress',
          ...(protocol.reviewers ? {
            reviewers: protocol.reviewers.map(r => ({ ...r, status: 'In Progress' }))
          } : {})
        });
      }
    } catch (err) {
      console.error('Error updating protocol status:', err);
      setError('Failed to update protocol status');
    } finally {
      setStatusChanging(false);
      setSelectedReviewer(null);
    }
  };
  
  // Get due date status indicator
  const getDueDateStatus = () => {
    if (!protocol) return null;
    
    if (protocol.status === 'Completed') {
      return <span className="text-green-600 font-medium">Completed</span>;
    } else if (isOverdue(protocol.due_date)) {
      return <span className="text-red-600 font-medium">Overdue</span>;
    } else if (isDueSoon(protocol.due_date)) {
      return <span className="text-yellow-600 font-medium">Due Soon</span>;
    } else {
      return <span className="text-gray-600 font-medium">On Schedule</span>;
    }
  };
  
  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md">
        <p>Loading protocol details...</p>
      </div>
    );
  }
  
  if (error) {
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
  
  if (!protocol) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md">
        <p>Protocol not found</p>
        <div className="mt-4">
          <Link href="/admin/protocols" className="text-blue-500 hover:underline">
            Back to Protocols
          </Link>
        </div>
      </div>
    );
  }
  
  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Protocol Details</h1>
        <div className="flex space-x-2">
          <Link 
            href="/admin/protocols" 
            className="bg-gray-200 text-gray-700 py-2 px-4 rounded hover:bg-gray-300"
          >
            Back to Protocols
          </Link>
        </div>
      </div>
      
      <div className="p-6 bg-white rounded-lg shadow-md">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h2 className="text-xl font-semibold mb-4">Protocol Information</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Protocol Name</p>
                <p className="font-medium">{protocol.protocol_name}</p>
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
                <p className="text-sm text-gray-500">Due Date</p>
                <div className="flex items-center space-x-2">
                  <p className="font-medium">{protocol.due_date}</p>
                  {getDueDateStatus()}
                </div>
              </div>
              <div>
                <p className="text-sm text-gray-500">Protocol Link</p>
                <a 
                  href={protocol.protocol_file} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-blue-500 hover:underline"
                >
                  View Protocol Document
                </a>
              </div>
            </div>
          </div>
          
          <div>
            <h2 className="text-xl font-semibold mb-4">Status & Links</h2>
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Overall Status</p>
                <div className="flex items-center space-x-2">
                  <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                    protocol.status === 'Completed' 
                      ? 'bg-green-100 text-green-800' 
                      : protocol.status === 'Partially Completed'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {protocol.status}
                  </span>
                  
                  {/* Show reviewer completion count if available */}
                  {(protocol.reviewerCount && protocol.completedReviewerCount !== undefined) ? (
                    <span className="text-xs text-gray-600">
                      ({protocol.completedReviewerCount}/{protocol.reviewerCount} reviewers)
                    </span>
                  ) : (
                    protocol.reviewers && (
                      <span className="text-xs text-gray-600">
                        ({protocol.reviewers.filter(r => r.status === 'Completed').length}/{protocol.reviewers.length} reviewers)
                      </span>
                    )
                  )}
                </div>
                
                {/* Progress bar for completion */}
                {protocol.reviewers && protocol.reviewers.length > 0 && (
                  <div className="mt-2 w-full bg-gray-200 rounded-full h-2.5">
                    <div 
                      className="bg-blue-600 h-2.5 rounded-full" 
                      style={{ 
                        width: `${(protocol.reviewers.filter(r => r.status === 'Completed').length / protocol.reviewers.length) * 100}%` 
                      }}
                    ></div>
                  </div>
                )}
              </div>
              
              <div>
                <p className="text-sm text-gray-500">Reviewers</p>
                {protocol.reviewers && protocol.reviewers.length > 0 ? (
                  <div className="space-y-2">
                    {protocol.reviewers.map((reviewer, index) => {
                      // Use per-reviewer due date if available, otherwise use protocol due date
                      const reviewerDueDate = reviewer.due_date || protocol.due_date;
                      const isReviewerOverdue = reviewerDueDate && isOverdue(reviewerDueDate) && reviewer.status !== 'Completed';
                      const isReviewerDueSoon = reviewerDueDate && isDueSoon(reviewerDueDate) && !isOverdue(reviewerDueDate) && reviewer.status !== 'Completed';
                      
                      return (
                        <div 
                          key={index} 
                          className={`flex flex-col p-3 border rounded hover:bg-gray-50 ${
                            isReviewerOverdue ? 'border-red-200 bg-red-50' :
                            isReviewerDueSoon ? 'border-yellow-200 bg-yellow-50' : 
                            reviewer.status === 'Completed' ? 'border-green-200 bg-green-50' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center space-x-2">
                              <span className={`inline-block w-3 h-3 rounded-full ${
                                reviewer.status === 'Completed' ? 'bg-green-500' : 
                                isReviewerOverdue ? 'bg-red-500' :
                                isReviewerDueSoon ? 'bg-yellow-500' : 'bg-blue-500'
                              }`}></span>
                              <span className="font-medium">{reviewer.name}</span>
                              <span className={`text-sm ${
                                reviewer.status === 'Completed' ? 'text-green-600' : 
                                isReviewerOverdue ? 'text-red-600' :
                                isReviewerDueSoon ? 'text-yellow-600' : 'text-gray-500'
                              }`}>
                                ({reviewer.status}
                                {isReviewerOverdue && ' - Overdue'}
                                {isReviewerDueSoon && ' - Due Soon'})
                              </span>
                            </div>
                            <div className="flex space-x-2">
                              <button
                                onClick={() => {
                                  setSelectedReviewer(reviewer.name);
                                  if (reviewer.status === 'In Progress') {
                                    markAsCompleted();
                                  } else {
                                    markAsInProgress();
                                  }
                                }}
                                disabled={statusChanging}
                                className={`text-xs py-1 px-2 rounded ${
                                  reviewer.status === 'In Progress' 
                                    ? 'bg-green-100 text-green-600 hover:bg-green-200'
                                    : 'bg-yellow-100 text-yellow-600 hover:bg-yellow-200'
                                }`}
                              >
                                {statusChanging && selectedReviewer === reviewer.name 
                                  ? 'Updating...' 
                                  : reviewer.status === 'In Progress' 
                                    ? 'Mark Completed' 
                                    : 'Mark In Progress'
                                }
                              </button>
                              
                              {/* Add individual reassign button for each reviewer that is not completed */}
                              {reviewer.status !== 'Completed' && (
                                <Link
                                  href={`/admin/protocols/${protocol.id}/reviewer/${encodeURIComponent(reviewer.name)}/reassign`}
                                  className={`text-xs py-1 px-2 rounded bg-red-100 text-red-600 hover:bg-red-200`}
                                >
                                  Reassign
                                </Link>
                              )}
                            </div>
                          </div>
                          
                          {/* Show document type and due date for each reviewer */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-1 px-5 py-2 bg-white rounded">
                            <div className="text-xs text-gray-600">
                              <span className="font-medium">Form:</span> {reviewer.document_type ? (
                                <>
                                  {reviewer.document_type} 
                                  <span className="ml-1 text-blue-600">
                                    ({getFormTypeName(reviewer.document_type)})
                                  </span>
                                </>
                              ) : 'N/A'}
                            </div>
                            
                            <div className="text-xs text-gray-600">
                              <span className="font-medium">Due date:</span>{' '}
                              {reviewerDueDate ? new Date(reviewerDueDate).toLocaleDateString() : 'Not set'}
                              {isReviewerOverdue && (
                                <span className="ml-2 text-red-600 font-medium">(Overdue)</span>
                              )}
                              {isReviewerDueSoon && (
                                <span className="ml-2 text-yellow-600 font-medium">(Due soon)</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div>
                    <p className="font-medium">{protocol.reviewer}</p>
                    <div className="mt-2 flex space-x-2">
                      <button
                        onClick={markAsCompleted}
                        disabled={statusChanging}
                        className="bg-green-500 text-white py-1 px-3 rounded text-sm hover:bg-green-600 disabled:opacity-50"
                      >
                        {statusChanging ? 'Updating...' : 'Mark as Completed'}
                      </button>
                      
                      {/* For legacy protocols with just a reviewer field, add reassign button */}
                      {protocol.status !== 'Completed' && (
                        <Link
                          href={`/admin/protocols/${protocol.id}/reviewer/${encodeURIComponent(protocol.reviewer)}/reassign`}
                          className="bg-red-500 text-white py-1 px-3 rounded text-sm hover:bg-red-600"
                        >
                          Reassign
                        </Link>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              
            </div>
          </div>
        </div>
      </div>
      
      {protocol.reassignment_history && protocol.reassignment_history.length > 0 && (
        <div className="p-6 bg-white rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">Reassignment History</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">From</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">To</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Reason</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {protocol.reassignment_history.map((entry, index) => (
                  <tr key={index}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {entry.date?.toDate ? entry.date.toDate().toLocaleDateString() : new Date(entry.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{entry.from}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{entry.to}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{entry.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
} 