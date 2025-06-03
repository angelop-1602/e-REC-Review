import React, { useState, useEffect } from 'react';
import { formatDate, getFormTypeName, isOverdue, isDueSoon, getReviewerFormType } from '@/lib/utils';
import { doc, collection, getDocs, query, where, orderBy, getDoc, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import ReassignmentModal from './ReassignmentModal';

interface Reviewer {
  id: string;
  name: string;
  status: string;
  form_type?: string;
  due_date?: string;
  completed_at?: Timestamp | null;
}

interface Protocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  reviewer?: string;
  reviewers?: Reviewer[];
  due_date: string;
  status: string;
  protocol_file: string;
  form_type?: string;
  created_at: string;
  last_audit_id?: string;
  last_audit_date?: any;
  updated_at?: any;
  _path?: string;
  last_reviewer?: string;
  relatedProtocols?: Protocol[];
}

interface AuditEntry {
  id: string;
  protocol_id: string;
  protocol_name: string;
  from: string;
  to: string;
  date: any;
  previous_due_date: string;
  new_due_date: string;
  type: string;
  status: string;
  timestamp: any;
}

interface ProtocolDetailsModalProps {
  isOpen: boolean;
  protocol: Protocol | null;
  onClose: () => void;
  onReassign?: (protocol: Protocol, reviewerId: string, reviewerName: string) => void;
  reviewerList: { id: string; name: string }[];
}

export default function ProtocolDetailsModal({
  isOpen,
  protocol,
  onClose,
  onReassign,
  reviewerList
}: ProtocolDetailsModalProps) {
  const [auditHistory, setAuditHistory] = useState<AuditEntry[]>([]);
  const [loadingAudit, setLoadingAudit] = useState(false);
  const [localProtocol, setLocalProtocol] = useState<Protocol | null>(null);
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignmentData, setReassignmentData] = useState<{
    protocol: Protocol;
    reviewerId: string;
    reviewerName: string;
  } | null>(null);

  useEffect(() => {
    if (protocol) {
      setLocalProtocol(protocol);
    }
  }, [protocol]);

  useEffect(() => {
    const fetchAuditHistory = async () => {
      if (!localProtocol || !isOpen) return;
      
      try {
        setLoadingAudit(true);
        
        // Get the protocol reference
        let protocolRef;
        if (localProtocol._path) {
          const pathParts = localProtocol._path.split('/');
          if (pathParts.length === 3) {
            protocolRef = doc(db, 'protocols', pathParts[0], pathParts[1], pathParts[2]);
          } else {
            console.error('Invalid protocol path format');
            return;
          }
        } else {
          console.error('Protocol path information missing');
          return;
        }
        
        // Query the audits subcollection
        const auditsRef = collection(protocolRef, 'audits');
        const q = query(auditsRef, orderBy('date', 'desc'));
        
        const auditSnap = await getDocs(q);
        
        const auditEntries: AuditEntry[] = [];
        auditSnap.forEach((doc) => {
          const data = doc.data() as AuditEntry;
          auditEntries.push(data);
        });
        
        setAuditHistory(auditEntries);
      } catch (err) {
        console.error('Error fetching audit history:', err);
      } finally {
        setLoadingAudit(false);
      }
    };
    
    fetchAuditHistory();
  }, [localProtocol, isOpen]);

  const handleReassign = (protocol: Protocol, reviewerId: string, reviewerName: string) => {
    setReassignmentData({
      protocol,
      reviewerId,
      reviewerName
    });
    setReassignModalOpen(true);
  };

  const handleReassignmentSuccess = async (updatedReviewer: { id: string; name: string; due_date: string }) => {
    if (localProtocol && reassignmentData) {
      // Optimistically update the local reviewer list
      const updatedProtocol = {
        ...localProtocol,
        reviewers: localProtocol.reviewers?.map(r =>
          r.id === reassignmentData.reviewerId
            ? { ...r, id: updatedReviewer.id, name: updatedReviewer.name, due_date: updatedReviewer.due_date, status: 'In Progress' }
            : r
        )
      };
      setLocalProtocol(updatedProtocol);

      // Now refetch from Firestore to ensure consistency
      let protocolRef;
      if (localProtocol._path) {
        const pathParts = localProtocol._path.split('/');
        if (pathParts.length === 3) {
          protocolRef = doc(db, 'protocols', pathParts[0], pathParts[1], pathParts[2]);
        } else {
          protocolRef = doc(db, 'protocols', localProtocol.id);
        }
      } else {
        protocolRef = doc(db, 'protocols', localProtocol.id);
      }

      // Fetch the latest protocol data
      const protocolSnap = await getDoc(protocolRef);
      if (protocolSnap.exists()) {
        const snapData = protocolSnap.data();
        setLocalProtocol(prev => ({
          ...prev,
          ...snapData,
          id: protocolSnap.id,
          protocol_name: snapData.protocol_name ?? prev?.protocol_name ?? '',
          release_period: snapData.release_period ?? prev?.release_period ?? '',
          academic_level: snapData.academic_level ?? prev?.academic_level ?? '',
          due_date: snapData.due_date ?? prev?.due_date ?? '',
          status: snapData.status ?? prev?.status ?? '',
          protocol_file: snapData.protocol_file ?? prev?.protocol_file ?? '',
          created_at: snapData.created_at ?? prev?.created_at ?? '',
        }));
      }
    }
    setReassignModalOpen(false);
    setReassignmentData(null);
  };

  if (!isOpen || !localProtocol) return null;
  
  // Function to get status badge with appropriate styling
  const getStatusBadge = (status: string, dueDate: string) => {
    if (status === 'Completed') {
      return <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Completed</span>;
    } else if (isOverdue(dueDate)) {
      return <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">Overdue</span>;
    } else if (isDueSoon(dueDate)) {
      return <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">Due Soon</span>;
    } else {
      return <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">In Progress</span>;
    }
  };

  // Function to get status badge with appropriate styling
  const getReviewerStatusBadge = (status: string, dueDate: string) => {
    if (status === 'Completed') {
      return <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Completed</span>;
    } else if (isOverdue(dueDate)) {
      return <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">Overdue</span>;
    } else if (isDueSoon(dueDate)) {
      return <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">Due Soon</span>;
    } else {
      return <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">In Progress</span>;
    }
  };

  // Get the reviewer's form type for a specific protocol
  const getReviewerFormType = (protocol: Protocol, reviewerId: string, reviewerName: string): { formName: string; formType: string } => {
    if (protocol.reviewers && Array.isArray(protocol.reviewers)) {
      // Use more comprehensive matching to find the reviewer
      for (const r of protocol.reviewers) {
        const idMatch = r.id === reviewerId;
        const nameMatch = r.name === reviewerName;
        const nameIncludes = Boolean(r.name && reviewerName && 
                      r.name.toLowerCase().includes(reviewerName.toLowerCase()));
        const reverseIncludes = Boolean(reviewerName && r.name && 
                      reviewerName.toLowerCase().includes(r.name.toLowerCase()));
        
        if (idMatch || nameMatch || nameIncludes || reverseIncludes) {
          if (r.form_type) {
            return {
              formName: getFormTypeName(r.form_type),
              formType: r.form_type
            };
          }
        }
      }
    }
    
    // If we couldn't find it in the reviewers array, use the protocol's form_type
    return {
      formName: getFormTypeName(protocol.form_type || ''),
      formType: protocol.form_type || ''
    };
  };

  // Helper to get the latest completed date among reviewers
  function getLatestCompletedDate(reviewers: Reviewer[]): string | null {
    const completedDates = reviewers
      .filter(r => r.status === 'Completed' && r.completed_at)
      .map(r => r.completed_at instanceof Timestamp ? r.completed_at.toDate().toISOString() : null)
      .filter((date): date is string => date !== null)
      .sort((a, b) => (a > b ? -1 : 1)); // Sort descending
    return completedDates.length > 0 ? completedDates[0] : null;
  }

  // In your render logic for the protocol's due date
  const allCompleted = Array.isArray(localProtocol.reviewers) &&
    localProtocol.reviewers.length > 0 &&
    localProtocol.reviewers.every(r => r.status === 'Completed');

  const completedDate = allCompleted
    ? getLatestCompletedDate(localProtocol.reviewers as Reviewer[])
    : null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-bold">{localProtocol.protocol_name}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mb-6">
          <div className="bg-gray-50 p-5 rounded-lg flex flex-col gap-2 border border-gray-100">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-lg font-semibold text-gray-700">Protocol Information</span>
            </div>
            <dl className="grid grid-cols-1 gap-y-2">
              <div className="flex justify-between">
                  <dt className="text-xs text-gray-500">Status</dt>
                <dd>{getReviewerStatusBadge(localProtocol.status, localProtocol.due_date)}</dd>
                </div>
              <div className="flex justify-between">
                  <dt className="text-xs text-gray-500">Release Period</dt>
                <dd className="text-sm font-medium">{localProtocol.release_period}</dd>
                </div>
              <div className="flex justify-between">
                  <dt className="text-xs text-gray-500">Academic Level</dt>
                <dd className="text-sm font-medium">{localProtocol.academic_level}</dd>
                </div>
              <div className="flex justify-between">
                  <dt className="text-xs text-gray-500">Due Date</dt>
                <dd className="text-sm font-medium">
                  {allCompleted && completedDate
                    ? `Completed: ${formatDate(completedDate)}`
                    : formatDate(localProtocol.due_date)}
                </dd>
                </div>
              <div className="flex justify-between">
                  <dt className="text-xs text-gray-500">Created At</dt>
                <dd className="text-sm font-medium">{formatDate(localProtocol.created_at.split('T')[0])}</dd>
              </div>
              {localProtocol.last_reviewer && (
                <div className="flex justify-between">
                  <dt className="text-xs text-gray-500">Last Reviewer</dt>
                  <dd className="text-sm font-medium">{localProtocol.last_reviewer}</dd>
                </div>
              )}
              </dl>
            <div className="mt-4 flex justify-end">
              {localProtocol.protocol_file ? (
                <a
                  href={localProtocol.protocol_file}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 text-center"
                >
                  Open Protocol File
                </a>
              ) : (
                <span className="text-sm text-red-500">No file uploaded.</span>
              )}
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-500 mb-1">Reviewers</h4>
          <div className="bg-gray-50 p-4 rounded-md overflow-x-auto">
            {localProtocol.reviewers && localProtocol.reviewers.length > 0 ? (
              <table className="min-w-full divide-y divide-gray-200 rounded-lg overflow-hidden">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Reviewer</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Form Type</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Due Date</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {localProtocol.reviewers.map((reviewer, index) => {
                    const formInfo = getReviewerFormType(localProtocol, reviewer.id, reviewer.name);
                    const completedDate = reviewer.completed_at instanceof Timestamp 
                      ? reviewer.completed_at.toDate().toISOString()
                      : null;
                    return (
                    <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{reviewer.name}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">{formInfo.formName || 'N/A'}</td>
                        <td className="px-4 py-3 text-sm">{getReviewerStatusBadge(reviewer.status, reviewer.due_date || localProtocol.due_date)}</td>
                        <td className="px-4 py-3 text-sm text-gray-700">
                          {reviewer.status === 'Completed' && completedDate
                            ? `Completed: ${formatDate(completedDate)}`
                            : formatDate(reviewer.due_date || localProtocol.due_date)}
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {reviewer.status !== 'Completed' && onReassign && (
                          <button
                              onClick={() => {
                                const formInfo = getReviewerFormType(localProtocol, reviewer.id, reviewer.name);
                                onReassign(localProtocol, reviewer.id, reviewer.name);
                              }}
                              className="text-blue-600 hover:text-blue-800 font-medium border border-blue-200 rounded px-3 py-1 transition-colors"
                          >
                            Reassign
                          </button>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : localProtocol.reviewer ? (
              <div className="flex flex-col">
                <div className="flex justify-between items-center p-2 bg-white rounded-md">
                  <div>
                    <p className="font-medium">{localProtocol.reviewer}</p>
                    <p className="text-xs text-gray-500">{getFormTypeName(localProtocol.form_type || '')}</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {getReviewerStatusBadge(localProtocol.status, localProtocol.due_date)}
                    {localProtocol.status !== 'Completed' && onReassign && (
                      <button
                        onClick={() => {
                          const formInfo = getReviewerFormType(localProtocol, localProtocol.reviewer || '', localProtocol.reviewer || '');
                          onReassign(localProtocol, localProtocol.reviewer || '', localProtocol.reviewer || '');
                        }}
                        className="text-blue-600 hover:text-blue-800 font-medium ml-3 border border-blue-200 rounded px-3 py-1 transition-colors"
                      >
                        Reassign
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">No reviewers assigned to this protocol.</p>
            )}
          </div>
        </div>

        {/* Audit History Section */}
        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-500 mb-1">Reassignment History</h4>
          <div className="bg-gray-50 p-4 rounded-md">
            {loadingAudit ? (
              <div className="flex justify-center items-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-blue-500"></div>
              </div>
            ) : auditHistory.length > 0 ? (
              <div className="space-y-4">
                {auditHistory.map((entry) => (
                  <div key={entry.id} className="bg-white p-4 rounded-md shadow-sm">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm font-medium">
                          Reassigned from <span className="text-gray-600">{entry.from}</span> to{' '}
                          <span className="text-gray-600">{entry.to}</span>
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Date: {formatDate(entry.date.toDate())}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">
                          Previous due date: {formatDate(entry.previous_due_date)}
                        </p>
                        <p className="text-xs text-gray-500">
                          New due date: {formatDate(entry.new_due_date)}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-4">No reassignment history available.</p>
            )}
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Close
          </button>
        </div>
      </div>

      {/* Reassignment Modal */}
      {reassignmentData && (
        <ReassignmentModal
          isOpen={reassignModalOpen}
          protocol={reassignmentData.protocol}
          currentReviewer={
            localProtocol?.reviewers?.find(r => r.id === reassignmentData.reviewerId)
            || { id: reassignmentData.reviewerId, name: reassignmentData.reviewerName, status: 'In Progress', due_date: localProtocol?.due_date || '' }
          }
          reviewerList={reviewerList}
          loading={false}
          onCancel={() => {
            setReassignModalOpen(false);
            setReassignmentData(null);
          }}
          onSuccess={handleReassignmentSuccess}
        />
      )}
    </div>
  );
} 