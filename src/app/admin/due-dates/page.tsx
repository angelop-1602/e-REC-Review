'use client';

import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, doc, updateDoc, getDoc, runTransaction, collectionGroup } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { isOverdue, isDueSoon, formatDate, getFormTypeName } from '@/lib/utils';
import ReassignmentModal from '@/components/ReassignmentModal';
import NotificationModal from '@/components/NotificationModal';
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

  // Helper function to ensure due dates are in the correct format
  const ensureValidDueDate = (dueDate: any): string => {
    if (!dueDate) return '';
    
    // If it's already a string in YYYY-MM-DD format, return it
    if (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return dueDate;
    }
    
    // If it's a timestamp object from Firestore
    if (dueDate && typeof dueDate === 'object' && dueDate.toDate) {
      try {
        const date = dueDate.toDate();
        return date.toISOString().split('T')[0]; // Get YYYY-MM-DD part
      } catch (err) {
        console.error('Error converting timestamp to date:', err);
      }
    }
    
    // If it's a date string but not in YYYY-MM-DD format, try to convert it
    if (typeof dueDate === 'string' && dueDate.trim() !== '') {
      try {
        const date = new Date(dueDate);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0]; // Get YYYY-MM-DD part
        }
      } catch (err) {
        console.error('Error parsing date string:', err);
      }
    }
    
    // If we got here, we couldn't parse the due date
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
        
        // Initialize array to hold all protocols
        const fetchedProtocols: Protocol[] = [];
        const uniqueReleases = new Set<string>();
        const uniqueReviewers = new Map<string, { id: string; name: string }>();
        
        // Query the hierarchical structure
        console.log('Fetching protocols from Firebase...');
        
        // First, attempt to use collectionGroup query for most efficient retrieval
        try {
          console.log("Attempting collectionGroup query...");
          
          // Use collection group queries to get all protocol documents across all subcollections
          for (let weekNum = 1; weekNum <= 4; weekNum++) {
            const weekCollection = `week-${weekNum}`;
            console.log(`Querying collection group: ${weekCollection}`);
            const protocolsGroupQuery = query(collectionGroup(db, weekCollection));
            const protocolsGroupSnapshot = await getDocs(protocolsGroupQuery);
            
            console.log(`Found ${protocolsGroupSnapshot.size} documents in ${weekCollection}`);
            
            // Process protocols from the collection group query
            for (const protocolDoc of protocolsGroupSnapshot.docs) {
              const data = protocolDoc.data() as Protocol;
              const path = protocolDoc.ref.path;
              
              // Extract the month and week from the path
              // Path format: "protocols/{month}/{week}/{SPUP_REC_Code}"
              const pathParts = path.split('/');
              if (pathParts.length < 4) {
                console.log(`Invalid path format for protocol: ${path}`);
                continue;
              }
              
              const monthId = pathParts[1];
              const weekId = pathParts[2];
              
              // Create a mapped protocol that works with our UI
              const mappedProtocol: Protocol = {
                ...data,
                id: protocolDoc.id,
                // Map new field names to consistent names for the UI
                protocol_name: data.research_title || '',
                protocol_file: data.e_link || '',
                release_period: `${monthId} ${weekId}`,
                academic_level: data.course_program || '',
                // Ensure the due date is valid and in the correct format
                due_date: ensureValidDueDate(data.due_date),
                // Add missing required fields with defaults if not present
                status: data.status || 'In Progress',
                created_at: data.created_at || new Date().toISOString(),
                // Add metadata for tracking
                _path: `${monthId}/${weekId}/${protocolDoc.id}`
              };
              
              // Only add protocols with a valid due date
              if (mappedProtocol.due_date && mappedProtocol.due_date.trim() !== '') {
                fetchedProtocols.push(mappedProtocol);
                
                if (mappedProtocol.release_period) {
                  uniqueReleases.add(mappedProtocol.release_period);
                }
                
                // Extract reviewers for filters
                if (mappedProtocol.reviewers && mappedProtocol.reviewers.length > 0) {
                  mappedProtocol.reviewers.forEach((reviewer: Reviewer) => {
                    if (reviewer.id && reviewer.name) {
                      uniqueReviewers.set(reviewer.id, {
                        id: reviewer.id,
                        name: reviewer.name
                      });
                    }
                  });
                }
              }
            }
          }
        } catch (err) {
          console.error("CollectionGroup query failed, falling back to hierarchical queries:", err);
          
          // Fallback to hierarchical queries if collectionGroup is not set up
          // First get all month documents
          const monthsRef = collection(db, 'protocols');
          console.log(`Fetching months from protocols collection...`);
          const monthsSnapshot = await getDocs(monthsRef);
          console.log(`Found ${monthsSnapshot.docs.length} documents in protocols collection`);
          
          // For each month, get all weeks
          for (const monthDoc of monthsSnapshot.docs) {
            const monthId = monthDoc.id;
            console.log(`Processing month: ${monthId}`);
            
            try {
              // Get weeks within this month
              const weeksRef = collection(monthDoc.ref, monthId);
              console.log(`Fetching weeks for month ${monthId}...`);
              const weeksSnapshot = await getDocs(weeksRef);
              console.log(`Found ${weeksSnapshot.docs.length} weeks for month ${monthId}`);
              
              // For each week, get all protocols
              for (const weekDoc of weeksSnapshot.docs) {
                const weekId = weekDoc.id;
                console.log(`Processing week: ${weekId} in month ${monthId}`);
                
                // Get protocols within this week
                const protocolsRef = collection(weekDoc.ref, weekId);
                console.log(`Fetching protocols for ${monthId}/${weekId}...`);
                const protocolsSnapshot = await getDocs(protocolsRef);
                console.log(`Found ${protocolsSnapshot.docs.length} protocols in ${monthId}/${weekId}`);
                
                for (const protocolDoc of protocolsSnapshot.docs) {
                  const data = protocolDoc.data();
                  
                  // Create a mapped protocol that works with our UI
                  const mappedProtocol: Protocol = {
                    ...data,
                    id: protocolDoc.id,
                    // Map new field names to consistent names for the UI
                    protocol_name: data.research_title || '',
                    protocol_file: data.e_link || '',
                    release_period: `${monthId} ${weekId}`,
                    academic_level: data.course_program || '',
                    // Ensure the due date is valid and in the correct format
                    due_date: ensureValidDueDate(data.due_date),
                    // Add missing required fields with defaults if not present in data
                    status: data.status || 'In Progress',
                    created_at: data.created_at || new Date().toISOString(),
                    // Add metadata for tracking
                    _path: `${monthId}/${weekId}/${protocolDoc.id}`
                  };
                  
                  // Only add protocols with a valid due date
                  if (mappedProtocol.due_date && mappedProtocol.due_date.trim() !== '') {
                    fetchedProtocols.push(mappedProtocol);
                    
                    if (mappedProtocol.release_period) {
                      uniqueReleases.add(mappedProtocol.release_period);
                    }
                    
                    // Extract reviewers for filters
                    if (mappedProtocol.reviewers && mappedProtocol.reviewers.length > 0) {
                      mappedProtocol.reviewers.forEach((reviewer: Reviewer) => {
                        if (reviewer.id && reviewer.name) {
                          uniqueReviewers.set(reviewer.id, {
                            id: reviewer.id,
                            name: reviewer.name
                          });
                        }
                      });
                    }
                  }
                }
              }
            } catch (err) {
              console.error(`Error fetching protocols for month ${monthId}:`, err);
              // Continue with other months even if one fails
            }
          }
        }
        
        console.log(`Fetched a total of ${fetchedProtocols.length} protocols with due dates.`);
        
        // Convert uniqueReviewers map to array for the reviewer list dropdown
        setReviewerList(Array.from(uniqueReviewers.values()));
        setProtocols(fetchedProtocols);
        
        // Sort release periods chronologically
        const sortedReleases = Array.from(uniqueReleases).sort((a, b) => {
          const aIsNumerical = /first|second|third|fourth/i.test(a);
          const bIsNumerical = /first|second|third|fourth/i.test(b);
          
          if (aIsNumerical && !bIsNumerical) return -1;
          if (!aIsNumerical && bIsNumerical) return 1;
          
          if (aIsNumerical && bIsNumerical) {
            const orderMap: {[key: string]: number} = {
              'first': 1, 'second': 2, 'third': 3, 'fourth': 4
            };
            const aOrder = orderMap[a.toLowerCase().split(' ')[0]] || 99;
            const bOrder = orderMap[b.toLowerCase().split(' ')[0]] || 99;
            return aOrder - bOrder;
          }
          
          // For monthly releases, sort by month
          return a.localeCompare(b);
        });
        
        setReleaseOptions(sortedReleases);
      } catch (err) {
        console.error('Error fetching protocols:', err);
        showNotification('error', 'Error', 'Failed to load protocols');
      } finally {
        setLoading(false);
      }
    };
    
    fetchProtocols();
  }, []);

  // Filter protocols based on filters
  const filteredProtocols = protocols.filter(protocol => {
    // Only include protocols with a due date
    if (!protocol.due_date || protocol.due_date.trim() === '') {
      return false;
    }
    
    // Filter by status
    const matchesStatus = 
      selectedFilter === 'all' || 
      (selectedFilter === 'overdue' && isOverdue(protocol.due_date) && protocol.status !== 'Completed') ||
      (selectedFilter === 'due-soon' && isDueSoon(protocol.due_date) && protocol.status !== 'Completed');
    
    // Filter by search term
    const matchesSearch = 
      searchTerm === '' || 
      protocol.protocol_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (protocol.reviewer && protocol.reviewer.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (protocol.reviewers && protocol.reviewers.some(r => r.name.toLowerCase().includes(searchTerm.toLowerCase())));
    
    // Filter by release period
    const matchesRelease = 
      filterRelease === 'all' || 
      protocol.release_period === filterRelease;
    
    return matchesStatus && matchesSearch && matchesRelease;
  });

  // Count protocols by status - only for protocols with due dates
  const counts = {
    total: protocols.length,
    overdue: protocols.filter(p => p.due_date && isOverdue(p.due_date) && p.status !== 'Completed').length,
    dueSoon: protocols.filter(p => p.due_date && isDueSoon(p.due_date) && p.status !== 'Completed').length,
    completed: protocols.filter(p => p.status === 'Completed').length,
  };

  const handleExpand = (protocolId: string) => {
    setExpandedProtocol(expandedProtocol === protocolId ? null : protocolId);
  };

  const initiateReassign = (protocol: Protocol, reviewerId: string, reviewerName: string) => {
    // Find the reviewer's current due date
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
      
      // Get the document reference using the protocol path
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
      
      // Get the current protocol data
      const protocolDoc = await getDoc(protocolRef);
      
      if (!protocolDoc.exists()) {
        showNotification('error', 'Error', 'Protocol document not found');
        return;
      }
      
      const protocolData = protocolDoc.data();
      
      // Find the new reviewer from the list to get their name
      const newReviewer = reviewerList.find(r => r.id === newReviewerId);
      if (!newReviewer) {
        showNotification('error', 'Error', 'New reviewer not found');
        return;
      }
      
      // Use the provided new due date or keep the current one
      const dueDateToUse = newDueDate || currentDueDate;
      
      // Create updated reviewers array
      let updatedReviewers: Reviewer[] = [];
      
      // Handle protocols with reviewers array
      if (protocolData.reviewers && Array.isArray(protocolData.reviewers)) {
        // Find the reviewer to replace
        updatedReviewers = [...protocolData.reviewers];
        
        // Find the reviewer index
        const reviewerIndex = updatedReviewers.findIndex(r => r.id === reviewerId);
        
        if (reviewerIndex >= 0) {
          // Replace the reviewer, keeping other properties the same but updating due date
          updatedReviewers[reviewerIndex] = {
            ...updatedReviewers[reviewerIndex],
            id: newReviewer.id,
            name: newReviewer.name,
            status: 'In Progress', // Reset status for new reviewer
            due_date: dueDateToUse // Use new due date
          };
        }
      } 
      // Handle protocols with single reviewer field - convert to reviewers array
      else if (protocolData.reviewer) {
        // Create a reviewers array with the new reviewer
        updatedReviewers = [{
          id: newReviewer.id,
          name: newReviewer.name,
          status: 'In Progress',
          document_type: protocolData.document_type,
          form_type: protocolData.document_type || protocolData.form_type,
          due_date: dueDateToUse
        }];
      }
      
      // Update the document
      await updateDoc(protocolRef, {
        reviewers: updatedReviewers,
        updated_at: new Date().toISOString()
      });
      
      // Update local state
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
      
      // Show success message
      showNotification('success', 'Success', `Reviewer reassigned successfully with due date: ${formatDate(dueDateToUse)}`);
      
      // Close the modal
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

  // Add a function to handle bulk reassignment
  const handleBulkReassign = async (newReviewerId: string) => {
    if (selectedProtocols.length === 0 || !newReviewerId) {
      showNotification('error', 'Error', 'No protocols selected or missing new reviewer');
      return;
    }

    try {
      setBulkReassignmentLoading(true);
      
      // Process each selected protocol
      for (const protocolId of selectedProtocols) {
        const protocol = protocols.find(p => p.id === protocolId);
        
        if (!protocol) continue;
        
        // Get the document reference using the protocol path
        let protocolRef;
        if (protocol._path) {
          const pathParts = protocol._path.split('/');
          if (pathParts.length === 3) {
            const [month, week, id] = pathParts;
            protocolRef = doc(db, 'protocols', month, week, id);
          } else {
            console.error(`Invalid path format for protocol: ${protocol.id}`);
            continue; // Skip this protocol and continue with others
          }
        } else {
          console.error(`Missing path information for protocol: ${protocol.id}`);
          continue; // Skip protocols without path information
        }
        
        // Get the current protocol data
        const protocolDoc = await getDoc(protocolRef);
        
        if (!protocolDoc.exists()) {
          console.error(`Protocol ${protocolId} not found`);
          continue;
        }
        
        const protocolData = protocolDoc.data() as Protocol;
        
        // Find the new reviewer details
        const newReviewer = reviewerList.find(r => r.id === newReviewerId);
        
        if (!newReviewer) {
          console.error('New reviewer not found');
          continue;
        }
        
        // Update the reviewers array with the new assignment
        let updatedReviewers: Reviewer[] = [];
        
        if (protocolData.reviewers && protocolData.reviewers.length > 0) {
          // Replace all reviewers that are not completed
          updatedReviewers = protocolData.reviewers.map(reviewer => {
            if (reviewer.status !== 'Completed') {
              return {
                id: newReviewerId,
                name: newReviewer.name,
                status: 'In Progress',
                document_type: reviewer.document_type
              };
            }
            return reviewer;
          });
        } else if (protocolData.reviewer) {
          // Handle single reviewer case - convert to reviewers array
          updatedReviewers = [{
            id: newReviewerId,
            name: newReviewer.name,
            status: 'In Progress',
            document_type: protocolData.document_type
          }];
        }
        
        // Update the protocol document
        await updateDoc(protocolRef, {
          reviewers: updatedReviewers,
          // Remove the single reviewer field if it exists
          reviewer: null,
          // Update the last_updated timestamp
          last_updated: new Date().toISOString()
        });
      }
      
      // Refresh the protocols list
      window.location.reload();
      
      // Show success message
      showNotification(
        'success',
        'Protocols Reassigned',
        `Successfully reassigned ${selectedProtocols.length} protocols to ${reviewerList.find(r => r.id === newReviewerId)?.name}`
      );
      
      // Reset selection
      setSelectedProtocols([]);
      setBulkReassignModalOpen(false);
    } catch (error) {
      console.error('Error in bulk reassignment:', error);
      showNotification(
        'error',
        'Reassignment Failed',
        'There was an error reassigning the protocols. Please try again.'
      );
    } finally {
      setBulkReassignmentLoading(false);
    }
  };
  
  // Add a function to toggle protocol selection
  const toggleProtocolSelection = (protocolId: string) => {
    setSelectedProtocols(prev => {
      if (prev.includes(protocolId)) {
        return prev.filter(id => id !== protocolId);
      } else {
        return [...prev, protocolId];
      }
    });
  };
  
  // Add function to select all filteredProtocols that are overdue
  const selectAllOverdue = () => {
    const overdueIds = filteredProtocols
      .filter(p => isOverdue(p.due_date) && p.status !== 'Completed')
      .map(p => p.id);
    
    setSelectedProtocols(overdueIds);
  };
  
  // Add function to clear selection
  const clearSelection = () => {
    setSelectedProtocols([]);
  };

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
        <h1 className="text-2xl font-bold mb-2">Due Date Management</h1>
        <p className="text-gray-600">
          Monitor and manage protocol due dates. Reassign overdue protocols to new reviewers.
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <ProtocolStatusCard 
          title="Total Protocols" 
          count={counts.total} 
          icon={
            <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          }
          color="blue"
        />
        <ProtocolStatusCard 
          title="Completed" 
          count={counts.completed} 
          icon={
            <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
          }
          color="green"
        />
        <ProtocolStatusCard 
          title="Overdue" 
          count={counts.overdue} 
          icon={
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          }
          color="red"
        />
        <ProtocolStatusCard 
          title="Due Soon" 
          count={counts.dueSoon} 
          icon={
            <svg className="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          }
          color="yellow"
        />
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">
              Search
            </label>
            <input
              type="text"
              id="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by protocol or reviewer name..."
              className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="status-filter" className="block text-sm font-medium text-gray-700 mb-1">
              Status Filter
            </label>
            <select
              id="status-filter"
              value={selectedFilter}
              onChange={(e) => setSelectedFilter(e.target.value as 'all' | 'overdue' | 'due-soon')}
              className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Protocols</option>
              <option value="overdue">Overdue</option>
              <option value="due-soon">Due Soon</option>
            </select>
          </div>
          <div>
            <label htmlFor="release-filter" className="block text-sm font-medium text-gray-700 mb-1">
              Release Period
            </label>
            <select
              id="release-filter"
              value={filterRelease}
              onChange={(e) => setFilterRelease(e.target.value)}
              className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Releases</option>
              {releaseOptions.map(release => (
                <option key={release} value={release}>{release}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Add bulk action controls */}
      {selectedProtocols.length > 0 && (
        <div className="flex flex-wrap justify-between items-center mb-4 p-3 bg-blue-50 rounded-md border border-blue-200">
          <div className="flex items-center">
            <span className="font-medium">{selectedProtocols.length} protocol(s) selected</span>
            <button 
              onClick={clearSelection}
              className="ml-2 text-sm text-blue-600 hover:text-blue-800"
            >
              Clear selection
            </button>
          </div>
          <button
            onClick={() => setBulkReassignModalOpen(true)}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm hover:bg-blue-700"
            disabled={selectedProtocols.length === 0}
          >
            Bulk Reassign
          </button>
        </div>
      )}

      {/* Protocols List */}
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
          <h3 className="text-lg leading-6 font-medium text-gray-900">
            Protocol Due Dates
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">
            {filteredProtocols.length} protocols found with the current filters
          </p>
        </div>
        {filteredProtocols.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {/* Add a checkbox column for bulk actions */}
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-10">
                    {selectedFilter === 'overdue' && (
                      <button
                        onClick={selectAllOverdue}
                        className="text-xs text-blue-600 hover:text-blue-800"
                      >
                        Select All
                      </button>
                    )}
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    SPUP REC Code
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Protocol Name
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Release Period
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Due Date
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredProtocols.map((protocol) => (
                  <React.Fragment key={protocol.id}>
                    <tr className="hover:bg-gray-50">
                      {/* Add checkbox for selection */}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {protocol.status !== 'Completed' && (
                          <input
                            type="checkbox"
                            checked={selectedProtocols.includes(protocol.id)}
                            onChange={() => toggleProtocolSelection(protocol.id)}
                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                          />
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">{protocol.spup_rec_code || protocol.id}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">{protocol.protocol_name || protocol.research_title}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-500">{protocol.release_period}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-500">{formatDate(getLatestDueDate(protocol))}</div>
                      </td>
                      <td className="px-6 py-4">
                        {getStatusLabel(protocol.status, getLatestDueDate(protocol))}
                      </td>
                      <td className="px-6 py-4 text-right text-sm font-medium">
                        <button
                          onClick={() => handleExpand(protocol.id)}
                          className="text-blue-600 hover:text-blue-900 mr-3"
                        >
                          {expandedProtocol === protocol.id ? 'Hide Details' : 'View Reviewers'}
                        </button>
                      </td>
                    </tr>
                    {expandedProtocol === protocol.id && (
                      <tr className="bg-gray-50">
                        <td colSpan={5} className="px-6 py-4">
                          <div className="border rounded-md p-3">
                            <h4 className="font-medium mb-2">Reviewers</h4>
                            {protocol.reviewers && protocol.reviewers.length > 0 ? (
                              <div className="space-y-2">
                                {protocol.reviewers.map((reviewer, idx) => (
                                  <div key={idx} className="flex justify-between items-center p-2 bg-white rounded-md">
                                    <div>
                                      <p className="font-medium">{reviewer.name}</p>
                                      <p className="text-xs text-gray-500">
                                        {getFormTypeName(reviewer.document_type || '')}
                                      </p>
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      {getStatusLabel(reviewer.status, protocol.due_date)}
                                      {reviewer.status !== 'Completed' && isOverdue(protocol.due_date) && (
                                        <button
                                          onClick={() => initiateReassign(protocol, reviewer.id, reviewer.name)}
                                          className="text-red-600 hover:text-red-800 font-medium ml-3"
                                        >
                                          Reassign
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex justify-between items-center p-2 bg-white rounded-md">
                                <div>
                                  <p className="font-medium">{protocol.reviewer || 'No reviewer assigned'}</p>
                                  <p className="text-xs text-gray-500">
                                    {getFormTypeName(protocol.document_type || '')}
                                  </p>
                                </div>
                                <div className="flex items-center space-x-2">
                                  {getStatusLabel(protocol.status, protocol.due_date)}
                                  {protocol.status !== 'Completed' && isOverdue(protocol.due_date) && protocol.reviewer && (
                                    <button
                                      onClick={() => initiateReassign(protocol, protocol.reviewer || '', protocol.reviewer || '')}
                                      className="text-red-600 hover:text-red-800 font-medium ml-3"
                                    >
                                      Reassign
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-gray-500">
            No protocols found matching the current filters.
          </div>
        )}
      </div>

      {/* Single Reviewer Reassignment Modal */}
      <ReassignmentModal
        isOpen={reassignModalOpen}
        protocolName={reassignmentData?.protocolName || ''}
        currentReviewerName={reassignmentData?.reviewerName || ''}
        reviewerList={reviewerList}
        loading={reassignmentData?.loading || false}
        onCancel={() => setReassignModalOpen(false)}
        onReassign={handleReassign}
      />

      {/* Bulk Reassignment Modal */}
      {bulkReassignModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-bold mb-4">Bulk Reassign Protocols</h3>
            
            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                You are reassigning {selectedProtocols.length} protocols to a new reviewer.
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Only reviewers that are not completed will be reassigned.
              </p>
            </div>
            
            <div className="mb-6">
              <label htmlFor="bulk-new-reviewer" className="block text-sm font-medium text-gray-700 mb-1">
                Select New Reviewer
              </label>
              <select
                id="bulk-new-reviewer"
                value={bulkNewReviewer}
                onChange={(e) => setBulkNewReviewer(e.target.value)}
                className="w-full border border-gray-300 rounded-md py-2 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={bulkReassignmentLoading}
              >
                <option value="">Select a reviewer</option>
                {reviewerList.map(reviewer => (
                  <option key={reviewer.id} value={reviewer.id}>
                    {reviewer.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setBulkReassignModalOpen(false)}
                className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={bulkReassignmentLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleBulkReassign(bulkNewReviewer)}
                className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={bulkReassignmentLoading || !bulkNewReviewer}
              >
                {bulkReassignmentLoading ? (
                  <span className="flex items-center">
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Processing...
                  </span>
                ) : (
                  'Reassign All Selected'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Notification Modal */}
      <NotificationModal
        isOpen={notification.isOpen}
        type={notification.type}
        title={notification.title}
        message={notification.message}
        onClose={() => setNotification({ ...notification, isOpen: false })}
      />
    </div>
  );
} 