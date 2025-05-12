'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState, useEffect } from 'react';
import { collection, getDocs, query, collectionGroup, doc, getDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { isOverdue, isDueSoon, formatDate } from '@/lib/utils';
import ProtocolTable from '@/components/ProtocolTable';
import ProtocolStatusCard from '@/components/ProtocolStatusCard';
import ProtocolDetailsModal from '@/components/ProtocolDetailsModal';
import ReassignmentModal from '@/components/ReassignmentModal';
import NotificationModal from '@/components/NotificationModal';

interface Reviewer {
  id: string;
  name: string;
  status: string;
  document_type?: string;
  form_type?: string;
  due_date?: string;
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
  reviewerCount?: number;
  completedReviewerCount?: number;
  relatedProtocols?: Protocol[];
  research_title?: string;
  e_link?: string;
  course_program?: string;
  spup_rec_code?: string;
  principal_investigator?: string;
  adviser?: string;
  _path?: string;
}

export default function ProtocolsPage() {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [groupedProtocols, setGroupedProtocols] = useState<{[key: string]: Protocol[]}>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterRelease, setFilterRelease] = useState('all');
  const [filterAcademic, setFilterAcademic] = useState('all');
  const [releaseOptions, setReleaseOptions] = useState<string[]>([]);
  const [academicOptions, setAcademicOptions] = useState<string[]>([]);
  const [viewType, setViewType] = useState<'table' | 'grouped'>('table');
  const [selectedProtocol, setSelectedProtocol] = useState<Protocol | null>(null);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [reviewerList, setReviewerList] = useState<{id: string; name: string}[]>([]);
  const [reassignmentData, setReassignmentData] = useState<{
    protocol: Protocol;
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
  const [statusCounts, setStatusCounts] = useState({
    total: 0,
    completed: 0,
    inProgress: 0,
    overdue: 0,
    dueSoon: 0
  });

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

  // Helper function to get detailed due date information from a protocol
  const getDueDateInfo = (protocol: Protocol) => {
    // If protocol has no reviewers array or it's empty, use the protocol's due date
    if (!protocol.reviewers || protocol.reviewers.length === 0) {
      const dueDateStr = ensureValidDueDate(protocol.due_date);
      return {
        date: dueDateStr,
        displayDate: formatDate(dueDateStr),
        isOverdue: isOverdue(dueDateStr),
        isDueSoon: isDueSoon(dueDateStr),
        status: isOverdue(dueDateStr) ? 'overdue' : isDueSoon(dueDateStr) ? 'due-soon' : 'on-schedule',
        hasActiveReviewers: false,
        totalReviewers: 0,
        overdueReviewers: 0,
        dueSoonReviewers: 0,
        reviewerInfo: []
      };
    }
    
    // Get current date to identify in-progress reviews
    const today = new Date().toISOString().split('T')[0];
    
    // Filter to only include active (non-completed) reviewers
    const activeReviewers = protocol.reviewers.filter(r => r.status !== 'Completed');
    
    // Create reviewer info with due date status
    const reviewerInfo = protocol.reviewers.map(reviewer => {
      const reviewerDueDate = ensureValidDueDate(reviewer.due_date) || ensureValidDueDate(protocol.due_date);
      const isReviewerOverdue = reviewer.status !== 'Completed' && isOverdue(reviewerDueDate);
      const isReviewerDueSoon = reviewer.status !== 'Completed' && !isOverdue(reviewerDueDate) && isDueSoon(reviewerDueDate);
      
      return {
        id: reviewer.id,
        name: reviewer.name,
        status: reviewer.status,
        dueDate: reviewerDueDate,
        displayDate: formatDate(reviewerDueDate),
        isOverdue: isReviewerOverdue,
        isDueSoon: isReviewerDueSoon
      };
    });
    
    // Count overdue and due soon reviewers
    const overdueReviewers = reviewerInfo.filter(r => r.isOverdue).length;
    const dueSoonReviewers = reviewerInfo.filter(r => r.isDueSoon).length;
    
    // If all reviewers are completed, show the latest due date from all reviewers
    if (activeReviewers.length === 0) {
      const allDueDates = protocol.reviewers
        .map(r => ensureValidDueDate(r.due_date))
        .filter(date => date !== '')
        .sort((a, b) => b.localeCompare(a)); // Sort desc
        
      const dueDateStr = allDueDates.length > 0 ? allDueDates[0] : ensureValidDueDate(protocol.due_date);
      
      return {
        date: dueDateStr,
        displayDate: formatDate(dueDateStr),
        isOverdue: false, // All completed, so not overdue
        isDueSoon: false, // All completed, so not due soon
        status: 'completed',
        hasActiveReviewers: false,
        totalReviewers: protocol.reviewers.length,
        overdueReviewers: 0,
        dueSoonReviewers: 0,
        reviewerInfo
      };
    }
    
    // Find the earliest upcoming due date among active reviewers
    const upcomingDueDates = activeReviewers
      .map(r => ensureValidDueDate(r.due_date))
      .filter(date => date !== '' && date >= today)
      .sort(); // Sort asc
      
    // If there are upcoming due dates, use the earliest one
    if (upcomingDueDates.length > 0) {
      const dueDateStr = upcomingDueDates[0];
      const isDueSoonValue = isDueSoon(dueDateStr);
      
      return {
        date: dueDateStr,
        displayDate: formatDate(dueDateStr),
        isOverdue: false,
        isDueSoon: isDueSoonValue,
        status: isDueSoonValue ? 'due-soon' : 'on-schedule',
        hasActiveReviewers: true,
        totalReviewers: protocol.reviewers.length,
        overdueReviewers,
        dueSoonReviewers,
        reviewerInfo
      };
    }
    
    // If there are no upcoming due dates, get the most recent overdue date
    const overdueDates = activeReviewers
      .map(r => ensureValidDueDate(r.due_date))
      .filter(date => date !== '' && date < today)
      .sort((a, b) => b.localeCompare(a)); // Sort desc
      
    if (overdueDates.length > 0) {
      const dueDateStr = overdueDates[0];
      
      return {
        date: dueDateStr,
        displayDate: formatDate(dueDateStr),
        isOverdue: true,
        isDueSoon: false,
        status: 'overdue',
        hasActiveReviewers: true,
        totalReviewers: protocol.reviewers.length,
        overdueReviewers,
        dueSoonReviewers,
        reviewerInfo
      };
    }
    
    // Fallback to protocol's due date if no reviewer due dates are available
    const dueDateStr = ensureValidDueDate(protocol.due_date);
    return {
      date: dueDateStr,
      displayDate: formatDate(dueDateStr),
      isOverdue: isOverdue(dueDateStr),
      isDueSoon: isDueSoon(dueDateStr),
      status: isOverdue(dueDateStr) ? 'overdue' : isDueSoon(dueDateStr) ? 'due-soon' : 'on-schedule',
      hasActiveReviewers: true,
      totalReviewers: protocol.reviewers.length,
      overdueReviewers,
      dueSoonReviewers,
      reviewerInfo
    };
  };

  // Backwards compatibility with existing code
  const getLatestDueDate = (protocol: Protocol): string => {
    return getDueDateInfo(protocol).date;
  };

  useEffect(() => {
    const fetchProtocols = async () => {
      try {
        setLoading(true);
        
        // Initialize array to hold all protocols
        const fetchedProtocols: Protocol[] = [];
        const uniqueReleases = new Set<string>();
        const uniqueAcademic = new Set<string>();
        const uniqueReviewers = new Map<string, {id: string; name: string}>();
        
        // Query the new hierarchical structure
        console.log('Fetching protocols from Firebase...');
        
        // First, attempt to use collectionGroup query for most efficient retrieval
        try {
          console.log("Attempting collectionGroup query...");
          
          // Use collection group queries to get all protocol documents across all subcollections
          // For each potential week collection (week-1, week-2, etc.)
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
                // Add missing required fields with defaults if not present in data
                status: data.status || 'In Progress',
                created_at: data.created_at || new Date().toISOString(),
                // Add metadata for tracking
                _path: `${monthId}/${weekId}/${protocolDoc.id}`
              };
              
              fetchedProtocols.push(mappedProtocol);
              
              // Add to our sets of unique values
              uniqueReleases.add(mappedProtocol.release_period);
              if (mappedProtocol.academic_level) {
                uniqueAcademic.add(mappedProtocol.academic_level);
              }
              
              // Extract reviewers for reassignment dropdown
              if (data.reviewers && data.reviewers.length > 0) {
                data.reviewers.forEach((reviewer: Reviewer) => {
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
                  
                  fetchedProtocols.push(mappedProtocol);
                  
                  // Add to our sets of unique values
                  uniqueReleases.add(mappedProtocol.release_period);
                  if (mappedProtocol.academic_level) {
                    uniqueAcademic.add(mappedProtocol.academic_level);
                  }
                  
                  // Extract reviewers for reassignment dropdown
                  if (data.reviewers && data.reviewers.length > 0) {
                    data.reviewers.forEach((reviewer: Reviewer) => {
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
            } catch (err) {
              console.error(`Error fetching protocols for month ${monthId}:`, err);
              // Continue with other months even if one fails
            }
          }
        }
        
        console.log(`Fetched a total of ${fetchedProtocols.length} protocols.`);

        // Process the protocols to create a grouped version with counts
        const protocolarrayByName: {[key: string]: Protocol[]} = {};
        fetchedProtocols.forEach(protocol => {
          const key = protocol.research_title || protocol.protocol_name || 'Unknown';
          if (!protocolarrayByName[key]) {
            protocolarrayByName[key] = [];
          }
          protocolarrayByName[key].push(protocol);
        });

        // Create a grouped version of protocols (one entry per protocol_name)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const processedProtocols = Object.entries(protocolarrayByName).map(([_, items]) => {
          // Use the first protocol as the base
          const baseProtocol = { ...items[0] };
          
          // Count completed and total reviewers
          const reviewerCount = items.reduce((count, p) => {
            if (p.reviewers && p.reviewers.length > 0) {
              return count + p.reviewers.length;
            } else if (p.reviewer) {
              return count + 1;
            }
            return count;
          }, 0);
          
          const completedReviewerCount = items.reduce((count, p) => {
            if (p.reviewers && p.reviewers.length > 0) {
              return count + p.reviewers.filter(r => r.status === 'Completed').length;
            } else if (p.status === 'Completed') {
              return count + 1;
            }
            return count;
          }, 0);
          
          // Determine overall status
          let overallStatus = 'In Progress';
          if (reviewerCount > 0 && completedReviewerCount === reviewerCount) {
            overallStatus = 'Completed';
          } else if (completedReviewerCount > 0) {
            overallStatus = 'Partially Completed';
          }
          
          return {
            ...baseProtocol,
            status: overallStatus,
            reviewerCount,
            completedReviewerCount,
            relatedProtocols: items
          };
        });

        // Sort release periods in chronological order, keeping numerical ones first (First, Second, etc.)
        // then followed by monthly ones (January, February, etc.)
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
        
        // Group protocols by release period
        const byReleasePeriod: {[key: string]: Protocol[]} = {};
        processedProtocols.forEach(protocol => {
          const releasePeriod = protocol.release_period || 'Unknown';
          if (!byReleasePeriod[releasePeriod]) {
            byReleasePeriod[releasePeriod] = [];
          }
          byReleasePeriod[releasePeriod].push(protocol);
        });

        // Update status counts
        const counts = {
          total: processedProtocols.length,
          completed: processedProtocols.filter(p => p.status === 'Completed').length,
          inProgress: processedProtocols.filter(p => p.status === 'In Progress' || p.status === 'Partially Completed').length,
          overdue: processedProtocols.filter(p => p.status !== 'Completed' && isOverdue(p.due_date)).length,
          dueSoon: processedProtocols.filter(p => p.status !== 'Completed' && !isOverdue(p.due_date) && isDueSoon(p.due_date)).length
        };
        
        setProtocols(processedProtocols);
        setGroupedProtocols(byReleasePeriod);
        setReleaseOptions(sortedReleases);
        setAcademicOptions(Array.from(uniqueAcademic).sort());
        setStatusCounts(counts);
        setReviewerList(Array.from(uniqueReviewers.values()));
      } catch (err) {
        console.error("Error fetching protocols:", err);
        setError("Failed to load protocols");
      } finally {
        setLoading(false);
      }
    };

    fetchProtocols();
  }, []);

  const filteredProtocols = protocols.filter((protocol) => {
    const matchesSearch = 
      (protocol.spup_rec_code && protocol.spup_rec_code.toLowerCase().includes(searchTerm.toLowerCase())) ||
      protocol.id.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || 
      protocol.status === filterStatus || 
      (filterStatus === 'overdue' && isOverdue(protocol.due_date) && protocol.status !== 'Completed') ||
      (filterStatus === 'due-soon' && isDueSoon(protocol.due_date) && protocol.status !== 'Completed');
    const matchesRelease = filterRelease === 'all' || protocol.release_period === filterRelease;
    const matchesAcademic = filterAcademic === 'all' || protocol.academic_level === filterAcademic;
    
    return matchesSearch && matchesStatus && matchesRelease && matchesAcademic;
  });

  // Filter and sort grouped protocols
  const filteredGroupedProtocols: {[key: string]: Protocol[]} = {};
  if (filterRelease !== 'all') {
    if (groupedProtocols[filterRelease]) {
      filteredGroupedProtocols[filterRelease] = groupedProtocols[filterRelease].filter(protocol => {
        const matchesSearch = 
          (protocol.spup_rec_code && protocol.spup_rec_code.toLowerCase().includes(searchTerm.toLowerCase())) ||
          protocol.id.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesStatus = filterStatus === 'all' || 
          protocol.status === filterStatus || 
          (filterStatus === 'overdue' && isOverdue(protocol.due_date) && protocol.status !== 'Completed') ||
          (filterStatus === 'due-soon' && isDueSoon(protocol.due_date) && protocol.status !== 'Completed');
        const matchesAcademic = filterAcademic === 'all' || protocol.academic_level === filterAcademic;
        
        return matchesSearch && matchesStatus && matchesAcademic;
      });
    }
  } else {
    releaseOptions.forEach(release => {
      if (groupedProtocols[release]) {
        const filtered = groupedProtocols[release].filter(protocol => {
          const matchesSearch = 
            (protocol.spup_rec_code && protocol.spup_rec_code.toLowerCase().includes(searchTerm.toLowerCase())) ||
            protocol.id.toLowerCase().includes(searchTerm.toLowerCase());
          const matchesStatus = filterStatus === 'all' || 
            protocol.status === filterStatus || 
            (filterStatus === 'overdue' && isOverdue(protocol.due_date) && protocol.status !== 'Completed') ||
            (filterStatus === 'due-soon' && isDueSoon(protocol.due_date) && protocol.status !== 'Completed');
          const matchesAcademic = filterAcademic === 'all' || protocol.academic_level === filterAcademic;
          
          return matchesSearch && matchesStatus && matchesAcademic;
        });
        
        if (filtered.length > 0) {
          filteredGroupedProtocols[release] = filtered;
        }
      }
    });
  }

  const handleViewProtocol = (protocol: Protocol) => {
    setSelectedProtocol(protocol);
    setDetailsModalOpen(true);
  };

  const handleReassign = (protocol: Protocol, reviewerId: string, reviewerName: string) => {
    // Find the reviewer's current due date
    let currentDueDate = '';
    if (protocol.reviewers && protocol.reviewers.length > 0) {
      const reviewer = protocol.reviewers.find(r => r.id === reviewerId);
      if (reviewer && reviewer.due_date) {
        currentDueDate = ensureValidDueDate(reviewer.due_date);
      }
    }
    
    setReassignmentData({
      protocol,
      reviewerId,
      reviewerName,
      loading: false,
      currentDueDate: currentDueDate || protocol.due_date
    });
    setReassignModalOpen(true);
  };

  const executeReassignment = async (newReviewerId: string, newDueDate?: string) => {
    if (!reassignmentData || !newReviewerId) {
      showNotification('error', 'Error', 'Missing reassignment data or new reviewer');
      return;
    }

    try {
      setReassignmentData({
        ...reassignmentData,
        loading: true
      });
      
      const { protocol, reviewerId, currentDueDate } = reassignmentData;
      
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
      else if (protocolData.reviewer === reviewerId) {
        // Create a reviewers array with the new reviewer
        updatedReviewers = [{
          id: newReviewer.id,
          name: newReviewer.name,
          status: 'In Progress',
          document_type: protocolData.document_type || '',
          form_type: protocolData.document_type || '',
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
          if (p.id === protocol.id) {
            return {
              ...p,
              reviewers: updatedReviewers
            };
          }
          return p;
        })
      );

      // Show success message
      showNotification('success', 'Reassigned', `Protocol "${protocol.spup_rec_code || protocol.protocol_name}" reassigned successfully with due date: ${formatDate(dueDateToUse)}`);
      setReassignModalOpen(false);
      setReassignmentData(null);
    } catch (error) {
      console.error('Error reassigning protocol:', error);
      showNotification('error', 'Error', 'Failed to reassign protocol');
    } finally {
      if (reassignmentData) {
        setReassignmentData({
          ...reassignmentData,
          loading: false
        });
      }
    }
  };

  // Function to render status badge with appropriate styling
  const getStatusBadge = (status: string, dueDate: string) => {
    if (status === 'Completed') {
      return <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Completed</span>;
    } else if (isOverdue(dueDate)) {
      return <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">Overdue</span>;
    } else if (isDueSoon(dueDate)) {
      return <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">Due Soon</span>;
    } else if (status === 'Partially Completed') {
      return <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">Partially Completed</span>;
    } else {
      return <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">In Progress</span>;
    }
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

  if (error) {
    return (
      <div className="p-8">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert">
          <strong className="font-bold">Error!</strong>
          <span className="block sm:inline"> {error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Protocol Management</h1>
        <p className="text-gray-600">
          Manage, filter and view all submitted protocols. Click on a protocol to view more details.
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
        <ProtocolStatusCard 
          title="Total Protocols" 
          count={statusCounts.total} 
          icon={
            <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          }
          color="blue"
        />
        <ProtocolStatusCard 
          title="Completed" 
          count={statusCounts.completed} 
          icon={
            <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
          }
          color="green"
        />
        <ProtocolStatusCard 
          title="In Progress" 
          count={statusCounts.inProgress} 
          icon={
            <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          }
          color="blue"
        />
        <ProtocolStatusCard 
          title="Overdue" 
          count={statusCounts.overdue} 
          icon={
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          }
          color="red"
        />
        <ProtocolStatusCard 
          title="Due Soon" 
          count={statusCounts.dueSoon} 
          icon={
            <svg className="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          }
          color="yellow"
        />
      </div>

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-lg shadow mb-6">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-4">
          <div className="col-span-2">
            <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">Search by SPUP REC Code</label>
            <input
              type="text"
              id="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by SPUP REC Code..."
              className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">Filter by Status</label>
            <select
              id="status"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Statuses</option>
              <option value="Completed">Completed</option>
              <option value="In Progress">In Progress</option>
              <option value="Partially Completed">Partially Completed</option>
              <option value="overdue">Overdue</option>
              <option value="due-soon">Due Soon</option>
            </select>
          </div>
          <div>
            <label htmlFor="release" className="block text-sm font-medium text-gray-700 mb-1">Filter by Release</label>
            <select
              id="release"
              value={filterRelease}
              onChange={(e) => setFilterRelease(e.target.value)}
              className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Releases</option>
              {releaseOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="academic" className="block text-sm font-medium text-gray-700 mb-1">Filter by Academic Level</label>
            <select
              id="academic"
              value={filterAcademic}
              onChange={(e) => setFilterAcademic(e.target.value)}
              className="border border-gray-300 rounded-md w-full p-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Levels</option>
              {academicOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        </div>
        
        {/* View Toggle */}
        <div className="flex justify-end">
          <div className="inline-flex rounded-md shadow-sm" role="group">
            <button
              type="button"
              onClick={() => setViewType('table')}
              className={`px-4 py-2 text-sm font-medium border rounded-l-lg ${
                viewType === 'table'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Table View
            </button>
            <button
              type="button"
              onClick={() => setViewType('grouped')}
              className={`px-4 py-2 text-sm font-medium border rounded-r-lg ${
                viewType === 'grouped'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Grouped by Release
            </button>
          </div>
           
        </div>
      </div>

      {/* Table View */}
      {viewType === 'table' ? (
        filteredProtocols.length > 0 ? (
          <ProtocolTable 
            protocols={filteredProtocols} 
            onViewDetails={handleViewProtocol}
            loading={loading}
          />
        ) : (
          <div className="bg-white p-8 rounded-lg shadow text-center">
            <p className="text-gray-500">No protocols found matching the current filters.</p>
          </div>
        )
      ) : (
        /* Grouped View */
        Object.keys(filteredGroupedProtocols).length > 0 ? (
          <div className="space-y-8">
            {Object.entries(filteredGroupedProtocols).map(([releasePeriod, protocols]) => (
              <div key={releasePeriod} className="bg-white rounded-lg shadow overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b">
                  <h3 className="text-lg font-medium text-gray-900">{releasePeriod}</h3>
                  <p className="text-sm text-gray-500">{protocols.length} protocols</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          SPUP REC Code
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Academic Level
                        </th>
                        <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Reviewers
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
                      {protocols.map((protocol) => (
                        <tr key={protocol.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-900">{protocol.spup_rec_code || protocol.id}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">{protocol.academic_level}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div className="text-sm text-gray-500">
                              {protocol.reviewerCount ? `${protocol.completedReviewerCount}/${protocol.reviewerCount} completed` : 'None assigned'}
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {(() => {
                              const dueInfo = getDueDateInfo(protocol);
                              if (protocol.status === 'Completed') {
                                return (
                                  <div className="text-sm text-green-600">{dueInfo.displayDate} (Completed)</div>
                                );
                              } else if (dueInfo.overdueReviewers > 0) {
                                return (
                                  <div>
                                    <div className="text-sm text-red-600 font-medium">{dueInfo.displayDate}</div>
                                    <div className="text-xs text-red-600">
                                      {dueInfo.overdueReviewers > 1 
                                        ? `${dueInfo.overdueReviewers} reviewers overdue` 
                                        : '1 reviewer overdue'}
                                    </div>
                                  </div>
                                );
                              } else if (dueInfo.dueSoonReviewers > 0) {
                                return (
                                  <div>
                                    <div className="text-sm text-yellow-600 font-medium">{dueInfo.displayDate}</div>
                                    <div className="text-xs text-yellow-600">
                                      {dueInfo.dueSoonReviewers > 1 
                                        ? `${dueInfo.dueSoonReviewers} reviewers due soon` 
                                        : '1 reviewer due soon'}
                                    </div>
                                  </div>
                                );
                              } else {
                                return (
                                  <div>
                                    <div className="text-sm text-gray-500">{dueInfo.displayDate}</div>
                                    {dueInfo.hasActiveReviewers && (
                                      <div className="text-xs text-gray-500">
                                        {dueInfo.reviewerInfo.filter(r => r.status !== 'Completed').length} active reviewer(s)
                                      </div>
                                    )}
                                  </div>
                                );
                              }
                            })()}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getStatusBadge(protocol.status, getLatestDueDate(protocol))}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                            <button
                              onClick={() => handleViewProtocol(protocol)}
                              className="text-blue-600 hover:text-blue-900 mr-3"
                            >
                              View Details
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-white p-8 rounded-lg shadow text-center">
            <p className="text-gray-500">No protocols found matching the current filters.</p>
          </div>
        )
      )}

      {/* Protocol Details Modal */}
      <ProtocolDetailsModal
        isOpen={detailsModalOpen}
        protocol={selectedProtocol}
        onClose={() => setDetailsModalOpen(false)}
        onReassign={handleReassign}
      />

      {/* Reassignment Modal */}
      {reassignmentData && (
        <ReassignmentModal
          isOpen={reassignModalOpen}
          protocolName={reassignmentData.protocol.spup_rec_code || reassignmentData.protocol.protocol_name}
          currentReviewerName={reassignmentData.reviewerName}
          currentDueDate={reassignmentData.currentDueDate}
          reviewerList={reviewerList}
          loading={reassignmentData.loading}
          onCancel={() => setReassignModalOpen(false)}
          onReassign={executeReassignment}
        />
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