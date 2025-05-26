'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, doc, updateDoc, getDoc, collectionGroup } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { isOverdue, isDueSoon, formatDate, getFormTypeName } from '@/lib/utils';
import ReassignmentModal from '@/components/ReassignmentModal';

import ProtocolStatusCard from '@/components/ProtocolStatusCard';

interface Reviewer {
  id: string;
  name: string;
  status: string;
  document_type?: string;
  due_date?: string;
  form_type?: string;
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
  document_type?: string;
  created_at: string;
  research_title?: string;
  e_link?: string;
  course_program?: string;
  spup_rec_code?: string;
  principal_investigator?: string;
  adviser?: string;
  _path?: string;
  reassignment_history?: any[];
}

export default function DueDateMonitorPage() {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewerList, setReviewerList] = useState<{id: string; name: string}[]>([]);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'overdue' | 'due-soon'>('all');
  const [expandedProtocol, setExpandedProtocol] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterRelease, setFilterRelease] = useState('all');
  const [releaseOptions, setReleaseOptions] = useState<string[]>([]);
  
  // Modal states
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reassignmentData, setReassignmentData] = useState<{
    protocolId: string;
    protocolName: string;
    reviewerId: string;
    reviewerName: string;
    loading: boolean;
    currentDueDate: string;
  } | null>(null);
  
  const [notification, setNotification] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    message: string;
  }>({
    isOpen: false,
    type: 'info',
    title: '',
    message: ''
  });

  // Add state for bulk selection
  const [selectedProtocols, setSelectedProtocols] = useState<string[]>([]);
  const [bulkReassignModalOpen, setBulkReassignModalOpen] = useState(false);
  const [bulkReassignmentLoading, setBulkReassignmentLoading] = useState(false);
  const [bulkNewReviewer, setBulkNewReviewer] = useState('');
  
  const showNotification = (type: 'success' | 'error' | 'info' | 'warning', title: string, message: string) => {
    setNotification({
      isOpen: true,
      type,
      title,
      message
    });
  };

  // Helper function to ensure due dates are in the correct format (copied from dashboard)
  const ensureValidDueDate = (dueDate: string | Date | { toDate(): Date } | undefined): string => {
    if (!dueDate) return '';
    if (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return dueDate;
    }
    if (dueDate && typeof dueDate === 'object' && 'toDate' in dueDate) {
      try {
        const date = dueDate.toDate();
        return date.toISOString().split('T')[0];
      } catch (err) {
        console.error('Error converting timestamp to date:', err);
      }
    }
    if (typeof dueDate === 'string' && dueDate.trim() !== '') {
      try {
        const date = new Date(dueDate);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      } catch (err) {
        console.error('Error parsing date string:', err);
      }
    }
    console.warn(`Could not parse due date: ${dueDate}`);
    return '';
  };

  // Helper function to get the most relevant due date from a protocol
  const getLatestDueDate = (protocol: Protocol): string => {
    // If protocol has no reviewers array or it's empty, use the protocol's due date
    if (!protocol.reviewers || protocol.reviewers.length === 0) {
      return ensureValidDueDate(protocol.due_date);
    }
    
    // Get current date to identify in-progress reviews
    const today = new Date().toISOString().split('T')[0];
    
    // Filter to only include active (non-completed) reviewers
    const activeReviewers = protocol.reviewers.filter(r => r.status !== 'Completed');
    
    // If there are no active reviewers, get the latest due date from all reviewers
    if (activeReviewers.length === 0) {
      // For protocols that are fully completed, find the latest due date from any reviewer
      const allDueDates = protocol.reviewers
        .map(r => ensureValidDueDate(r.due_date))
        .filter(date => date !== '')
        .sort((a, b) => b.localeCompare(a)); // Sort desc
        
      return allDueDates.length > 0 ? allDueDates[0] : ensureValidDueDate(protocol.due_date);
    }
    
    // Find the earliest upcoming due date among active reviewers
    const upcomingDueDates = activeReviewers
      .map(r => ensureValidDueDate(r.due_date))
      .filter(date => date !== '' && date >= today)
      .sort(); // Sort asc
      
    // If there are upcoming due dates, use the earliest one
    if (upcomingDueDates.length > 0) {
      return upcomingDueDates[0];
    }
    
    // If there are no upcoming due dates, get the most recent overdue date
    const overdueDates = activeReviewers
      .map(r => ensureValidDueDate(r.due_date))
      .filter(date => date !== '' && date < today)
      .sort((a, b) => b.localeCompare(a)); // Sort desc
      
    if (overdueDates.length > 0) {
      return overdueDates[0];
    }
    
    // Fallback to protocol's due date if no reviewer due dates are available
    return ensureValidDueDate(protocol.due_date);
  };

  useEffect(() => {
    const fetchProtocols = async () => {
      try {
        setLoading(true);
        const protocols: Protocol[] = [];
        for (let weekNum = 1; weekNum <= 4; weekNum++) {
          const weekCollection = `week-${weekNum}`;
          const protocolsGroupQuery = query(collectionGroup(db, weekCollection));
          const protocolsGroupSnapshot = await getDocs(protocolsGroupQuery);
          for (const protocolDoc of protocolsGroupSnapshot.docs) {
            const data = protocolDoc.data() as Protocol;
            const path = protocolDoc.ref.path;
            const pathParts = path.split('/');
            if (pathParts.length < 4) continue;
            const monthId = pathParts[1];
            const weekId = pathParts[2];
            const mappedProtocol: Protocol = {
              ...data,
              id: protocolDoc.id,
              protocol_name: data.research_title || '',
              protocol_file: data.e_link || '',
              release_period: `${monthId} ${weekId}`,
              academic_level: data.course_program || '',
              due_date: ensureValidDueDate(data.due_date),
              status: data.status || 'In Progress',
              created_at: data.created_at || new Date().toISOString(),
              _path: `${monthId}/${weekId}/${protocolDoc.id}`
            };
            protocols.push(mappedProtocol);
          }
        }
        setProtocols(protocols);
      } catch (err) {
        console.error('Error fetching protocols:', err);
        setNotification({
          isOpen: true,
          type: 'error',
          title: 'Error',
          message: 'Failed to load protocols'
        });
      } finally {
        setLoading(false);
      }
    };
    fetchProtocols();
  }, []);

  // Filter protocols based on filters
  const filteredProtocols = protocols.filter(protocol => {
    // Filter by search term
    const matchesSearch = 
      searchTerm === '' || 
      protocol.protocol_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      protocol.spup_rec_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      protocol.principal_investigator?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (protocol.reviewer && protocol.reviewer.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (protocol.reviewers && protocol.reviewers.some(r => r.name.toLowerCase().includes(searchTerm.toLowerCase())));
    
    // Filter by release period
    const matchesRelease = 
      filterRelease === 'all' || 
      protocol.release_period === filterRelease;
    
    return matchesSearch && matchesRelease;
  });

  // Extract overdue reviewers from all protocols (dashboard logic)
  const extractedOverdueReviewers = protocols.flatMap(protocol => {
    if (protocol.reviewers && protocol.reviewers.length > 0) {
      return protocol.reviewers
        .map(reviewer => {
          const reviewerDueDate = ensureValidDueDate(reviewer.due_date || '');
          if (reviewer.status !== 'Completed' && reviewerDueDate && isOverdue(reviewerDueDate)) {
            return {
              protocolId: protocol.id,
              spupRecCode: protocol.spup_rec_code || protocol.id,
              reviewerId: reviewer.id,
              reviewerName: reviewer.name,
              dueDate: reviewerDueDate,
              protocolPath: protocol._path
            };
          }
          return null;
        })
        .filter(Boolean);
    } else if (protocol.reviewer && protocol.status !== 'Completed' && isOverdue(protocol.due_date)) {
      return [{
        protocolId: protocol.id,
        spupRecCode: protocol.spup_rec_code || protocol.id,
        reviewerId: protocol.reviewer,
        reviewerName: protocol.reviewer,
        dueDate: protocol.due_date,
        protocolPath: protocol._path
      }];
    }
    return [];
  });
  const sortedOverdueReviewers = [...extractedOverdueReviewers].filter(Boolean).sort((a, b) => {
    if (!a || !b || !a.dueDate || !b.dueDate) return 0;
    return a.dueDate.localeCompare(b.dueDate);
  });
  console.log('Extracted Overdue Reviewers:', sortedOverdueReviewers);

  // Count protocols by status - only for protocols with due dates
  const counts = {
    total: protocols.length,
    overdue: extractedOverdueReviewers.length,
    dueSoon: protocols.filter(p => {
      const latestDueDate = getLatestDueDate(p);
      return (
        // Check if protocol is due soon
        (latestDueDate && isDueSoon(latestDueDate) && p.status !== 'Completed') ||
        // Or if any reviewer is due soon
        (p.reviewers && p.reviewers.some(r => 
          r.status !== 'Completed' && 
          r.due_date && 
          isDueSoon(r.due_date)
        ))
      );
    }).length,
    completed: protocols.filter(p => p.status === 'Completed').length,
  };

  const handleExpand = (protocolId: string) => {
    setExpandedProtocol(expandedProtocol === protocolId ? null : protocolId);
  };

  const initiateReassign = (protocol: Protocol, reviewerId: string, reviewerName: string) => {
    let currentDueDate = '';
    if (protocol.reviewers && protocol.reviewers.length > 0) {
      const reviewer = protocol.reviewers.find(r => r.id === reviewerId);
      if (reviewer && reviewer.due_date) {
        currentDueDate = ensureValidDueDate(reviewer.due_date);
      }
    }
    setReassignmentData({
      protocolId: protocol.id,
      protocolName: protocol.protocol_name || protocol.research_title || '',
      reviewerId,
      reviewerName,
      loading: false,
      currentDueDate: currentDueDate || protocol.due_date
    });
    setReassignModalOpen(true);
  };

  const handleReassign = async (newReviewerId: string, newDueDate?: string) => {
    try {
      if (!reassignmentData) return;
      setReassignmentData({
        ...reassignmentData,
        loading: true
      });
      const { protocolId, reviewerId, currentDueDate } = reassignmentData;
      const protocol = protocols.find(p => p.id === protocolId);
      if (!protocol) {
        showNotification('error', 'Error', 'Protocol not found');
        return;
      }
      let protocolRef;
      if (protocol._path) {
        const pathParts = protocol._path.split('/');
        if (pathParts.length === 3) {
          const [month, week, id] = pathParts;
          protocolRef = doc(db, 'protocols', month, week, id);
        } else {
          showNotification('error', 'Error', 'Invalid protocol path format');
          return;
        }
      } else {
        showNotification('error', 'Error', 'Protocol path information missing');
        return;
      }
      const protocolDoc = await getDoc(protocolRef);
      if (!protocolDoc.exists()) {
        showNotification('error', 'Error', 'Protocol document not found');
        return;
      }
      const protocolData = protocolDoc.data();
      const newReviewer = reviewerList.find(r => r.id === newReviewerId);
      if (!newReviewer) {
        showNotification('error', 'Error', 'New reviewer not found');
        return;
      }
      const dueDateToUse = newDueDate || currentDueDate;
      let updatedReviewers: Reviewer[] = [];
      let previousReviewerInfo = null;
      if (protocolData.reviewers && Array.isArray(protocolData.reviewers)) {
        updatedReviewers = [...protocolData.reviewers];
        const reviewerIndex = updatedReviewers.findIndex(r => r.id === reviewerId);
        if (reviewerIndex >= 0) {
          // Save previous reviewer info
          const prev = updatedReviewers[reviewerIndex];
          previousReviewerInfo = {
            id: prev.id,
            name: prev.name,
            due_date: prev.due_date,
            reassignedAt: new Date().toISOString()
          };
          // Replace the reviewer
          updatedReviewers[reviewerIndex] = {
            ...updatedReviewers[reviewerIndex],
            id: newReviewer.id,
            name: newReviewer.name,
            status: 'In Progress',
            due_date: dueDateToUse
          };
        }
      } else if (protocolData.reviewer) {
        previousReviewerInfo = {
          id: protocolData.reviewer,
          name: protocolData.reviewer,
          due_date: protocolData.due_date,
          reassignedAt: new Date().toISOString()
        };
        updatedReviewers = [{
          id: newReviewer.id,
          name: newReviewer.name,
          status: 'In Progress',
          document_type: protocolData.document_type,
          form_type: protocolData.document_type || protocolData.form_type,
          due_date: dueDateToUse
        }];
      }
      // Update the document with reassignment_history
      await updateDoc(protocolRef, {
        reviewers: updatedReviewers,
        updated_at: new Date().toISOString(),
        reassignment_history: previousReviewerInfo
          ? (protocolData.reassignment_history ? [...protocolData.reassignment_history, previousReviewerInfo] : [previousReviewerInfo])
          : protocolData.reassignment_history || []
      });
      setProtocols(prevProtocols =>
        prevProtocols.map(p => {
          if (p.id === protocolId) {
            return {
              ...p,
              reviewers: updatedReviewers
            };
          }
          return p;
        })
      );
      showNotification('success', 'Success', `Reviewer reassigned successfully with due date: ${formatDate(dueDateToUse)}`);
      setReassignModalOpen(false);
      setReassignmentData(null);
    } catch (error) {
      console.error('Error reassigning reviewer:', error);
      showNotification('error', 'Error', `Failed to reassign reviewer: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      if (reassignmentData) {
        setReassignmentData({
          ...reassignmentData,
          loading: false
        });
      }
    }
  };

  const getStatusLabel = (status: string, dueDate: string) => {
    if (status === 'Completed') {
      return <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Completed</span>;
    } else if (dueDate && dueDate.trim() !== '' && isOverdue(dueDate)) {
      return <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">Overdue</span>;
    } else if (dueDate && dueDate.trim() !== '' && isDueSoon(dueDate)) {
      return <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">Due Soon</span>;
    } else {
      return <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">In Progress</span>;
    }
  };

  // Analytics: Reviewers Who Lost Reviews
  const lostReviewersMap: Record<string, { name: string; count: number }> = {};
  protocols.forEach(protocol => {
    if (protocol.reassignment_history && Array.isArray(protocol.reassignment_history)) {
      protocol.reassignment_history.forEach((entry: any) => {
        if (entry && entry.id && entry.name) {
          if (!lostReviewersMap[entry.id]) {
            lostReviewersMap[entry.id] = { name: entry.name, count: 0 };
          }
          lostReviewersMap[entry.id].count++;
        }
      });
    }
  });
  const lostReviewers = Object.values(lostReviewersMap).sort((a, b) => b.count - a.count);

  if (loading) {
    return (
      <div className="p-8">
        <div className="flex justify-center items-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Overdue Reviewers</h1>
        <p className="text-gray-600">
          List of all reviewers who are overdue. You can reassign them to another reviewer.
        </p>
      </div>
      <div className="bg-white rounded-lg shadow-md">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
          <h3 className="text-lg font-medium text-gray-900">Overdue Reviewers</h3>
          <span className="text-blue-600 text-sm">{sortedOverdueReviewers.length} found</span>
        </div>
        <div className="p-4">
          {sortedOverdueReviewers.length > 0 ? (
            <ul className="divide-y divide-gray-200">
              {sortedOverdueReviewers.map((reviewer, index) => reviewer && (
                <li key={`${reviewer.protocolId}-${reviewer.reviewerId}-${index}`} className="py-3">
                  <div className="flex justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{reviewer.spupRecCode}</p>
                      <p className="text-xs text-gray-500">Reviewer: <span className="font-medium">{reviewer.reviewerName}</span></p>
                      <p className="text-xs text-gray-500">Due: {formatDate(reviewer.dueDate)}</p>
                    </div>
                    <div className="flex flex-col items-end">
                      <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full mb-2">Overdue</span>
                      <button
                        onClick={() => {
                          const protocol = protocols.find(p => p.id === reviewer.protocolId);
                          if (protocol) {
                            initiateReassign(protocol, reviewer.reviewerId, reviewer.reviewerName);
                          }
                        }}
                        className="text-blue-600 hover:text-blue-800 text-xs"
                      >
                        Reassign
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-center py-4 text-gray-500">No overdue reviewers.</p>
          )}
        </div>
      </div>
      <ReassignmentModal
        isOpen={reassignModalOpen}
        protocolName={reassignmentData?.protocolName || ''}
        currentReviewerName={reassignmentData?.reviewerName || ''}
        reviewerList={reviewerList}
        loading={reassignmentData?.loading || false}
        onCancel={() => setReassignModalOpen(false)}
        onReassign={handleReassign}
      />
      {/* Analytics: Reviewers Who Lost Reviews */}
      {lostReviewers.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6 my-8">
          <h2 className="text-xl font-bold mb-4">Reviewers Who Lost Reviews</h2>
          <ul className="divide-y divide-gray-200">
            {lostReviewers.map((reviewer, idx) => (
              <li key={idx} className="py-2 flex justify-between items-center">
                <span className="text-sm font-medium text-gray-900">{reviewer.name}</span>
                <span className="text-sm text-red-600 font-semibold">{reviewer.count} lost</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
} 