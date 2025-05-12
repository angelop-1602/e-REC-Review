'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc, Timestamp, runTransaction, query, collectionGroup, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import { isOverdue, isDueSoon, formatDate, getFormTypeName } from '@/lib/utils';
import NoticeAlert from '@/components/NoticeAlert';
import { useRouter } from 'next/navigation';

interface Protocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  status: string;
  protocol_file: string;
  due_date: string;
  created_at: string;
  completed_at?: string;
  reviewer?: string;
  reviewers?: { 
    id: string;
    name: string;
    status: string;
    document_type?: string;
    form_type?: string;
    due_date?: string;
    completed_at?: string;
  }[];
  document_type: string;
  research_title?: string;
  e_link?: string;
  course_program?: string;
  spup_rec_code?: string;
  principal_investigator?: string;
  adviser?: string;
  _path?: string;
}

export default function ReviewerDashboard() {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<string | null>(null);
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [reviewerName, setReviewerName] = useState<string | null>(null);
  const [selectedReleasePeriod, setSelectedReleasePeriod] = useState<string>('all');
  const [releasePeriods, setReleasePeriods] = useState<string[]>([]);
  const [statusCounts, setStatusCounts] = useState({
    total: 0,
    completed: 0,
    inProgress: 0,
    overdue: 0,
    dueSoon: 0
  });
  const [confirmationModal, setConfirmationModal] = useState<{
    isOpen: boolean;
    protocols: Protocol[];
    releasePeriod: string;
    protocolCount: number;
  } | null>(null);
  const [notificationModal, setNotificationModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
  } | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
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
  
  useEffect(() => {
    // Get reviewer ID and name from localStorage
    const id = localStorage.getItem('reviewerId');
    const name = localStorage.getItem('reviewerName');
    
    if (!id || !name) {
      // Redirect to login if not authenticated
      window.location.href = '/';
      return;
    }
    
    console.log(`Reviewer authenticated - ID: ${id}, Name: ${name}`);
    setReviewerId(id);
    setReviewerName(name);
    
    const fetchProtocols = async () => {
      if (!id) return;
      
      try {
        setLoading(true);
      
        const fetchedProtocols: Protocol[] = [];
        const uniqueReleasePeriods = new Set<string>();
        let matchingProtocolCount = 0;
      
        // Query the hierarchical structure
        console.log(`Querying protocols for reviewer: ${id}`);
        
        // First, attempt to use collectionGroup query for most efficient retrieval
        try {
          console.log("Attempting collectionGroup query...");
          
          // Use collection group queries to get all protocol documents across all subcollections
          for (let weekNum = 1; weekNum <= 4; weekNum++) {
            const weekCollection = `week-${weekNum}`;
            
            console.log(`Querying collection group: ${weekCollection}`);
            const protocolsGroupQuery = query(collectionGroup(db, weekCollection));
            const protocolsGroupQuerySnapshot = await getDocs(protocolsGroupQuery);
            
            console.log(`Found ${protocolsGroupQuerySnapshot.size} documents in ${weekCollection}`);
            
            // Process protocols from the collection group query
            for (const protocolDoc of protocolsGroupQuerySnapshot.docs) {
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
              
              console.log(`Protocol: ${data.research_title || data.protocol_name}, ID: ${protocolDoc.id}, Path: ${path}`);
              
              // Check the reviewers array
              const isReviewerInArray = data.reviewers?.some(r => {
                const match = r.id === id || r.name === id || r.name === name;
                if (match) console.log(`Match found in reviewers array for ${path}: ${r.id} / ${r.name}`);
                return match;
              });
              
              if (isReviewerInArray) {
                // Map to format compatible with UI
                const mappedProtocol: Protocol = {
                  ...data,
                  id: protocolDoc.id,
                  // Map new field names to consistent names for the UI
                  protocol_name: data.research_title || '',
                  protocol_file: data.e_link || '',
                  release_period: `${monthId} ${weekId}`,
                  academic_level: data.course_program || '',
                  // Add metadata for tracking
                  _path: `${monthId}/${weekId}/${protocolDoc.id}`
                };
                
                matchingProtocolCount++;
                fetchedProtocols.push(mappedProtocol);
                
                if (mappedProtocol.release_period) {
                  uniqueReleasePeriods.add(mappedProtocol.release_period);
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
                  const data = protocolDoc.data() as Protocol;
                  
                  console.log(`Protocol: ${data.research_title || data.protocol_name}, ID: ${protocolDoc.id}, Reviewers:`, data.reviewers);
                  
                  // Check the reviewers array
                  const isReviewerInArray = data.reviewers?.some(r => {
                    const match = r.id === id || r.name === id || r.name === name;
                    if (match) console.log(`Match found in reviewers array for ${monthId}/${weekId}/${protocolDoc.id}: ${r.id} / ${r.name}`);
                    return match;
                  });
                  
                  if (isReviewerInArray) {
                    // Map to format compatible with UI
                    const mappedProtocol: Protocol = {
                      ...data,
                      id: protocolDoc.id,
                      // Map new field names to consistent names for the UI
                      protocol_name: data.research_title || '',
                      protocol_file: data.e_link || '',
                      release_period: `${monthId} ${weekId}`,
                      academic_level: data.course_program || '',
                      // Add metadata for tracking
                      _path: `${monthId}/${weekId}/${protocolDoc.id}`
                    };
                    
                    matchingProtocolCount++;
                    fetchedProtocols.push(mappedProtocol);
                    
                    if (mappedProtocol.release_period) {
                      uniqueReleasePeriods.add(mappedProtocol.release_period);
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
        
        console.log(`Found ${matchingProtocolCount} total protocols assigned to this reviewer`);
        setDebugInfo(prev => `${prev}\nMatching protocols: ${matchingProtocolCount}`);
        
        // Sort release periods and add them to the state
        console.log(`Found release periods: ${Array.from(uniqueReleasePeriods).join(', ')}`);
        const sortedReleasePeriods = Array.from(uniqueReleasePeriods).sort((a, b) => {
          // Helper function to calculate a "weight" for each period for sorting
          const getWeightForSorting = (period: string): number => {
            let weight = 0;
            
            // Check for year
            const yearMatch = period.match(/\b(20\d{2})\b/);
            if (yearMatch) {
              weight += parseInt(yearMatch[1]) * 1000;
            }
            
            // Check for month
            const months = [
              'January', 'February', 'March', 'April', 'May', 'June', 
              'July', 'August', 'September', 'October', 'November', 'December'
            ];
            
            // Try to find month in the period string
            for (let i = 0; i < months.length; i++) {
              if (period.match(new RegExp(`\\b${months[i]}\\b`, 'i'))) {
                weight += (i + 1) * 10; // +1 to avoid 0 weight for January
                break;
              }
            }
            
            // Check for week number
            const weekMatch = period.match(/(\d+)(?:st|nd|rd|th)/i) || period.match(/week-(\d+)/i);
            if (weekMatch) {
              weight += parseInt(weekMatch[1]);
            }
            
            // Handle "First Release", "Second Release", etc.
            const ordinals: Record<string, number> = { 
              'First': 1, 'Second': 2, 'Third': 3, 'Fourth': 4 
            };
            
            for (const [ordinalName, ordinalValue] of Object.entries(ordinals)) {
              if (period.includes(ordinalName)) {
                weight += ordinalValue;
                break;
              }
            }
            
            console.log(`Calculated weight for "${period}": ${weight}`);
            return weight;
          };
          
          const weightA = getWeightForSorting(a);
          const weightB = getWeightForSorting(b);
          
          // Sort by weight (newer = higher weight = first)
          return weightB - weightA;
        });
        
        console.log(`Sorted release periods: ${sortedReleasePeriods.join(', ')}`);
        setReleasePeriods(sortedReleasePeriods);
        
        setProtocols(fetchedProtocols);
      setError(null);
    } catch (err) {
        console.error("Error fetching protocols:", err);
        setError("Failed to load protocols. Please refresh the page or try again later.");
    } finally {
      setLoading(false);
    }
  };
  
    fetchProtocols();
  }, []);

  // Filter protocols by release period if one is selected
  const filteredProtocols = protocols.filter(protocol => 
    selectedReleasePeriod === 'all' || protocol.release_period === selectedReleasePeriod
  );

  // Group protocols by release period
  const groupedProtocols: { [key: string]: Protocol[] } = {};
  
  filteredProtocols.forEach(protocol => {
    const releasePeriod = protocol.release_period || 'Unknown';
    
    if (!groupedProtocols[releasePeriod]) {
      groupedProtocols[releasePeriod] = [];
    }
    
    groupedProtocols[releasePeriod].push(protocol);
  });

  // Get the reviewer's document type for a specific protocol
  const getReviewerDocumentType = (protocol: Protocol): string => {
    // Log the protocol for debugging
    console.log(`Getting document type for protocol: ${protocol.id}, current document_type: ${protocol.document_type}`);
    
    if (protocol.reviewers && Array.isArray(protocol.reviewers) && reviewerId && reviewerName) {
      // Use more comprehensive matching to find the reviewer
      for (const r of protocol.reviewers) {
        const idMatch = r.id === reviewerId;
        const nameMatch = r.name === reviewerName;
        const nameIncludes = Boolean(r.name && reviewerName && 
                      r.name.toLowerCase().includes(reviewerName.toLowerCase()));
        const reverseIncludes = Boolean(reviewerName && r.name && 
                      reviewerName.toLowerCase().includes(r.name.toLowerCase()));
        
        if (idMatch || nameMatch || nameIncludes || reverseIncludes) {
          // For new structure, check both document_type and form_type fields
          if (r.document_type) {
            console.log(`Found document_type in reviewer: ${r.document_type}`);
            return r.document_type;
          }
          if (r.form_type) {
            console.log(`Found form_type in reviewer: ${r.form_type}`);
            return r.form_type;
          }
        }
      }
    }
    
    // If we couldn't find it in the reviewers array, use the protocol's document_type
    // This is a fallback for both old and new structures
    console.log(`Using protocol document_type: ${protocol.document_type}`);
    return protocol.document_type || '';
  };

  // Get the reviewer's status for a specific protocol
  const getReviewerStatus = (protocol: Protocol): string => {
    if (protocol.reviewers && reviewerId) {
      // Look for the current reviewer in the reviewers array
      const reviewer = protocol.reviewers.find(r => 
        r.id === reviewerId || 
        r.name === reviewerName ||
        (r.name && reviewerName && 
          (r.name.toLowerCase().includes(reviewerName?.toLowerCase() || '') || 
           reviewerName.toLowerCase().includes(r.name.toLowerCase())))
      );
      return reviewer?.status || 'In Progress';
    }
    return protocol.status;
  };
  
  // Sort each protocol group internally by due date (newest first)
  Object.keys(groupedProtocols).forEach(period => {
    groupedProtocols[period].sort((a, b) => {
      // First prioritize overdue/due soon items
      const aIsOverdue = isOverdue(a.due_date) && getReviewerStatus(a) !== 'Completed';
      const bIsOverdue = isOverdue(b.due_date) && getReviewerStatus(b) !== 'Completed';
      const aIsDueSoon = isDueSoon(a.due_date) && getReviewerStatus(a) !== 'Completed';
      const bIsDueSoon = isDueSoon(b.due_date) && getReviewerStatus(b) !== 'Completed';
      
      if (aIsOverdue && !bIsOverdue) return -1;
      if (!aIsOverdue && bIsOverdue) return 1;
      if (aIsDueSoon && !bIsDueSoon && !bIsOverdue) return -1;
      if (!aIsDueSoon && bIsDueSoon && !aIsOverdue) return 1;
      
      // Then sort by due date (closest due date first)
      if (a.due_date && b.due_date) {
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      
      return 0;
    });
  });

  // Sort protocol groups from newest to oldest with improved logic
  const sortedProtocolGroups = Object.keys(groupedProtocols).sort((periodA, periodB) => {
    // Helper function to calculate a "weight" for each period
    // Higher weight = newer period
    const getWeight = (period: string): number => {
      let weight = 0;
      
      // Log the period being processed for debugging
      console.log(`Calculating weight for period: "${period}"`);

      // Handle the new format: "May2025 week-2"
      const newFormatMatch = period.match(/^(\w+)(\d{4})\s+week-(\d+)$/i);
      if (newFormatMatch) {
        const [_, month, year, week] = newFormatMatch;
        
        // Add year weight (most significant factor)
        const yearWeight = parseInt(year) * 1000;
        weight += yearWeight;
        console.log(`  Found year (new format): ${year}, adding weight: ${yearWeight}`);
        
        // Add month weight
        const months = [
          'January', 'February', 'March', 'April', 'May', 'June', 
          'July', 'August', 'September', 'October', 'November', 'December'
        ];
        
        const monthIndex = months.findIndex(m => 
          m.toLowerCase() === month.toLowerCase()
        );
        
        if (monthIndex !== -1) {
          const monthWeight = monthIndex * 10;
          weight += monthWeight;
          console.log(`  Found month (new format): ${month}, adding weight: ${monthWeight}`);
        }
        
        // Add week weight
        const weekWeight = parseInt(week);
        weight += weekWeight;
        console.log(`  Found week (new format): ${week}, adding weight: ${weekWeight}`);
        
        console.log(`  Final weight for "${period}" (new format): ${weight}`);
        return weight;
      }
      
      // First check for year - most significant factor
      const yearMatch = period.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        // Base weight on year - newer year is higher weight
        weight += parseInt(yearMatch[1]) * 1000;
        console.log(`  Found year: ${yearMatch[1]}, adding weight: ${parseInt(yearMatch[1]) * 1000}`);
      }
      
      // Add weight for months - more recent months get higher weight
      const months = [
        'January', 'February', 'March', 'April', 'May', 'June', 
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      
      // First check for full month names
      let monthIndex = -1;
      for (let i = 0; i < months.length; i++) {
        if (period.toLowerCase().includes(months[i].toLowerCase())) {
          monthIndex = i;
          break;
        }
      }
      
      // If no full month name found, check for abbreviated names or just the month name at start
      if (monthIndex === -1) {
        // Look for month at the beginning of the string (e.g., "May 2nd")
        for (let i = 0; i < months.length; i++) {
          const monthRegex = new RegExp(`^${months[i]}\\b`, 'i');
          if (monthRegex.test(period)) {
            monthIndex = i;
            break;
          }
        }
      }
      
      if (monthIndex !== -1) {
        // Add month weight (0-11) * 10 to make it more significant
        weight += monthIndex * 10;
        console.log(`  Found month: ${months[monthIndex]}, adding weight: ${monthIndex * 10}`);
      }
      
      // Add weight for weeks (1st, 2nd, 3rd, 4th, etc.)
      const weekMatch = period.match(/(\d+)(st|nd|rd|th)/i) || period.match(/week-(\d+)/i);
      if (weekMatch) {
        const weekNum = parseInt(weekMatch[1]);
        // Add week weight - higher week number = higher weight
        weight += weekNum;
        console.log(`  Found week: ${weekNum}, adding weight: ${weekNum}`);
      }
      
      // Add weight for ordinals (First, Second, etc.)
      const ordinals: Record<string, number> = { 
        'First': 1, 'Second': 2, 'Third': 3, 'Fourth': 4, 'Fifth': 5, 'Sixth': 6,
        '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6 
      };
      
      // Look for ordinal strings in the period name
      for (const [ordinalName, ordinalValue] of Object.entries(ordinals)) {
        if (period.includes(ordinalName)) {
          // For ordinals, we want First to be newest in the year
          weight -= ordinalValue;
          console.log(`  Found ordinal: ${ordinalName}, subtracting weight: ${ordinalValue}`);
          break;
        }
      }
      
      // Check for quarter references (Q1, Q2, etc)
      const quarterMatch = period.match(/Q([1-4])/i);
      if (quarterMatch) {
        const quarter = parseInt(quarterMatch[1]);
        weight += quarter;
        console.log(`  Found quarter: ${quarter}, adding weight: ${quarter}`);
      }
      
      console.log(`  Final weight for "${period}": ${weight}`);
      return weight;
    };
    
    // Compare weights for sorting
    const weightA = getWeight(periodA);
    const weightB = getWeight(periodB);
    
    // Sort by weight (higher weight = newer period)
    return weightB - weightA;
  });
  
  // Function to show notification modal
  const showNotification = (title: string, message: string, type: 'success' | 'error' | 'info' | 'warning') => {
    setNotificationModal({
      isOpen: true,
      title,
      message,
      type
    });
  };

  // Function to close notification modal
  const closeNotificationModal = () => {
    setNotificationModal(null);
  };

  // Update the markAllProtocolsAsCompleted function to use the notification modal instead of alerts
  const markAllProtocolsAsCompleted = async (protocols: Protocol[]) => {
    try {
      if (!reviewerId || !reviewerName) {
        showNotification(
          "Authentication Error", 
          "Reviewer information is missing. Please try logging in again.", 
          "error"
        );
        return;
      }

      // Show loading indicator
      const loadingMessage = document.createElement('div');
      loadingMessage.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
      loadingMessage.innerHTML = `
        <div class="bg-white p-6 rounded-lg shadow-lg">
          <p class="text-lg font-medium">Marking protocols as completed...</p>
          <p class="text-sm text-gray-500 mt-2">Please wait, this may take a moment.</p>
        </div>
      `;
      document.body.appendChild(loadingMessage);

      // Filter out protocols that are already completed by this reviewer
      const protocolsToUpdate = protocols.filter(protocol => {
        if (protocol.reviewers && Array.isArray(protocol.reviewers)) {
          const thisReviewer = protocol.reviewers.find(r => 
            r.id === reviewerId || r.name === reviewerName ||
            (r.name && reviewerName && (r.name.toLowerCase().includes(reviewerName.toLowerCase()) || 
                                       reviewerName.toLowerCase().includes(r.name.toLowerCase()))))
          );
          return !thisReviewer || thisReviewer.status !== 'Completed';
        }
        return protocol.status !== 'Completed';
      });

      console.log(`Found ${protocolsToUpdate.length} protocols to mark as completed`);
      
      if (protocolsToUpdate.length === 0) {
        document.body.removeChild(loadingMessage);
        showNotification(
          "Already Completed", 
          "All selected protocols are already marked as completed.", 
          "info"
        );
        return;
      }
      
      // Define a completion timestamp to use for all updates
      const completedDate = new Date().toISOString();

      await runTransaction(db, async (transaction) => {
        for (const protocol of protocolsToUpdate) {
          // Handle different document paths based on source
          let protocolRef;
          if (protocol._path) {
            // For new structure, use the stored path
            const pathParts = protocol._path.split('/');
            if (pathParts.length === 3) {
              const [month, week, id] = pathParts;
              protocolRef = doc(db, 'protocols', month, week, id);
              console.log(`Using new structure path: protocols/${month}/${week}/${id}`);
            } else {
              console.error(`Invalid path format for protocol: ${protocol.id}, path: ${protocol._path}`);
              continue; // Skip this protocol and continue with others
            }
          } else {
            // For old structure, use the default path
            protocolRef = doc(db, 'protocols', protocol.id);
            console.log(`Using old structure path: protocols/${protocol.id}`);
          }
          
          // Prepare the updates
          const updates: any = { completed_at: completedDate };
          
          // Update reviewers array if it exists
          if (protocol.reviewers && Array.isArray(protocol.reviewers)) {
            const updatedReviewers = [...protocol.reviewers];
            let userFound = false;
            
            // Update current reviewer's status
            for (let i = 0; i < updatedReviewers.length; i++) {
              const r = updatedReviewers[i];
              const idMatch = r.id === reviewerId;
              const nameMatch = r.name === reviewerName;
              const nameIncludes = Boolean(r.name && reviewerName && 
                             (r.name.toLowerCase().includes(reviewerName.toLowerCase()) || 
                              reviewerName.toLowerCase().includes(r.name.toLowerCase())));
              
              if (idMatch || nameMatch || nameIncludes) {
                updatedReviewers[i] = { 
                  ...r, 
                  status: 'Completed',
                  completed_at: completedDate 
                };
                userFound = true;
                console.log(`Updated reviewer ${r.id} in protocol ${protocol.id}`);
                break;
              }
            }
            
            // If user wasn't found in the array, add them
            if (!userFound && reviewerName && reviewerId) {
              updatedReviewers.push({
                id: reviewerId,
                name: reviewerName,
                status: 'Completed',
                document_type: protocol.document_type,
                form_type: protocol.document_type,
                completed_at: completedDate
              });
              console.log(`Added reviewer ${reviewerId} to protocol ${protocol.id}`);
            }
            
            updates.reviewers = updatedReviewers;
            
            // Check if all reviewers have completed their reviews
            const allCompleted = updatedReviewers.every(r => r.status === 'Completed');
            if (allCompleted) {
              updates.status = 'Completed';
              console.log(`All reviewers completed protocol ${protocol.id}`);
            }
          } else {
            // Legacy behavior - update overall status
            updates.status = 'Completed';
            
            // Also add to reviewers array for future compatibility
            if (reviewerName && reviewerId) {
              updates.reviewers = [{
                id: reviewerId,
                name: reviewerName,
                status: 'Completed',
                document_type: protocol.document_type,
                form_type: protocol.document_type,
                completed_at: completedDate
              }];
              console.log(`Added reviewer ${reviewerId} to legacy protocol ${protocol.id}`);
            }
          }
          
          // Use the transaction to update the document
          transaction.update(protocolRef, updates);
          console.log(`Marked protocol ${protocol.id} as completed for reviewer ${reviewerId}`, updates);
        }
      });
      
      // Remove loading indicator
      document.body.removeChild(loadingMessage);
      
      // Show success message
      showNotification(
        "Protocols Completed", 
        `Successfully marked ${protocolsToUpdate.length} protocols as completed!`, 
        "success"
      );
      
      // Update the local state instead of reloading the page
      // This will immediately update the UI without waiting for a page refresh
      setProtocols(prevProtocols => {
        return prevProtocols.map(protocol => {
          // Check if this protocol was in the updated list
          const wasUpdated = protocolsToUpdate.some(p => p.id === protocol.id);
          
          if (!wasUpdated) return protocol;
          
          // Create a copy of the protocol with updated status
          const updatedProtocol = { ...protocol };
          
          // Update the reviewers array if it exists
          if (updatedProtocol.reviewers && Array.isArray(updatedProtocol.reviewers)) {
            updatedProtocol.reviewers = updatedProtocol.reviewers.map(reviewer => {
              if (reviewer.id === reviewerId || 
                  reviewer.name === reviewerName || 
                  (reviewer.name && reviewerName && 
                    (reviewer.name.toLowerCase().includes(reviewerName.toLowerCase()) || 
                     reviewerName.toLowerCase().includes(reviewer.name.toLowerCase())))) {
                return { ...reviewer, status: 'Completed' };
              }
              return reviewer;
            });
            
            // Check if all reviewers are completed
            const allCompleted = updatedProtocol.reviewers.every(r => r.status === 'Completed');
            if (allCompleted) {
              updatedProtocol.status = 'Completed';
            }
          } else {
            // For legacy protocols
            updatedProtocol.status = 'Completed';
          }
          
          return updatedProtocol;
        });
      });
      
    } catch (err) {
      console.error('Error marking all protocols as completed:', err);
      // Remove loading indicator if it exists
      const loadingMessage = document.querySelector('.fixed.inset-0.bg-black.bg-opacity-50');
      if (loadingMessage && loadingMessage.parentNode) {
        loadingMessage.parentNode.removeChild(loadingMessage);
      }
      
      // Show detailed error
      showNotification(
        "Error", 
        `Failed to mark protocols as completed: ${err instanceof Error ? err.message : 'Unknown error'}`, 
        "error"
      );
    }
  };

  useEffect(() => {
    // Filter protocols by release period if one is selected
    const filteredProtocols = protocols.filter(protocol => 
      selectedReleasePeriod === 'all' || protocol.release_period === selectedReleasePeriod
    );

    // Group protocols by release period
    const groupedProtocols: { [key: string]: Protocol[] } = {};
    
    filteredProtocols.forEach(protocol => {
      const releasePeriod = protocol.release_period || 'Unknown';
      
      if (!groupedProtocols[releasePeriod]) {
        groupedProtocols[releasePeriod] = [];
      }
      
      groupedProtocols[releasePeriod].push(protocol);
    });

    // Update status counts (calculate directly from protocols here)
    const counts = {
      total: protocols.length,
      completed: protocols.filter(p => {
        // If using the reviewers array, check this reviewer's status
        if (p.reviewers && reviewerId) {
          const thisReviewer = p.reviewers.find(r => 
            r.id === reviewerId || 
            r.name === reviewerName ||
            (r.name && reviewerName && 
              (r.name.toLowerCase().includes(reviewerName?.toLowerCase() || '') || 
               reviewerName?.toLowerCase().includes(r.name.toLowerCase() || '')))
          );
          return thisReviewer && thisReviewer.status === 'Completed';
        }
        // Otherwise use protocol's status
        return p.status === 'Completed';
      }).length,
      inProgress: protocols.filter(p => {
        // If using the reviewers array, check this reviewer's status
        if (p.reviewers && reviewerId) {
          const thisReviewer = p.reviewers.find(r => 
            r.id === reviewerId || 
            r.name === reviewerName ||
            (r.name && reviewerName && 
              (r.name.toLowerCase().includes(reviewerName?.toLowerCase() || '') || 
               reviewerName?.toLowerCase().includes(r.name.toLowerCase() || '')))
          );
          return thisReviewer && thisReviewer.status === 'In Progress';
        }
        // Otherwise use protocol's status
        return p.status === 'In Progress';
      }).length,
      overdue: protocols.filter(p => {
        const reviewerStatus = getReviewerStatus(p);
        return p.due_date && isOverdue(p.due_date) && reviewerStatus !== 'Completed';
      }).length,
      dueSoon: protocols.filter(p => {
        const reviewerStatus = getReviewerStatus(p);
        return p.due_date && isDueSoon(p.due_date) && reviewerStatus !== 'Completed';
      }).length,
    };

    setStatusCounts(counts);
  }, [protocols, reviewerId, reviewerName, selectedReleasePeriod]);

  // Add a function to show the confirmation modal
  const showConfirmationModal = (protocols: Protocol[], releasePeriod: string, protocolCount: number) => {
    setConfirmationModal({
      isOpen: true,
      protocols,
      releasePeriod,
      protocolCount
    });
  };

  // Add a function to close the confirmation modal
  const closeConfirmationModal = () => {
    setConfirmationModal(null);
  };

  // Add a function to confirm and proceed with marking protocols as completed
  const confirmMarkAllCompleted = () => {
    if (confirmationModal) {
      markAllProtocolsAsCompleted(confirmationModal.protocols);
      closeConfirmationModal();
    }
  };

  // Get form URL for a protocol
  const getFormUrl = (protocol: Protocol): string => {
    const documentType = getReviewerDocumentType(protocol);
    console.log(`Getting form URL for document type: ${documentType}`);
    
    // Normalize the document type to handle different naming conventions
    const normalizedType = documentType.toUpperCase().replace(/[-_\s]/g, '');
    
    switch(normalizedType) {
      case 'ICA':
        return 'https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__jZdNhdUQlE5MzA3UFRGNzVJMVpVMFo5SFJYVkc0OS4u';
      case 'PRA':
        return 'https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__jZdNhdUQjBQQTdIWDFESFZIU1FaRFo1STlFWjc0Uy4u';
      case 'CFEFR':
        return 'https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__jZdNhdUOUpDVFhBNk9WNFVMUU42VE5XTFBDVkRMQi4u';
      case 'PRAEX':
        return 'https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__jZdNhdUQk85VTIyNUE5VjFQTTVYMzNUNlRXUVA4Si4u';
      default:
        console.log(`No matching form URL found for document type: ${documentType} (normalized: ${normalizedType})`);
        return '';
    }
  };

  // Open form in a new window
  const openForm = (formUrl: string) => {
    if (formUrl) {
      window.open(formUrl, '_blank');
    }
  };

  // Helper to get protocol document reference based on path info
  const getProtocolRef = (protocol: Protocol) => {
    if (protocol._path) {
      // Use the structured path (protocols/{month}/{week}/{id})
      const pathParts = protocol._path.split('/');
      if (pathParts.length === 3) {
        const [month, week, id] = pathParts;
        return doc(db, 'protocols', month, week, id);
      }
    }
    
    // Fallback to default flat path (protocols/{id})
    return doc(db, 'protocols', protocol.id);
  };

  // Functions to mark individual protocols as completed or in progress
  const markProtocolAsInProgress = async (protocol: Protocol) => {
    try {
      if (!reviewerId || !reviewerName) {
        showNotification(
          "Authentication Error", 
          "Reviewer information is missing. Please try logging in again.", 
          "error"
        );
        return;
      }
      
      // Get protocol reference using helper
      const protocolRef = getProtocolRef(protocol);
      
      // Prepare the updates
      const updates: any = { completed_at: null };
      
      // Update the protocol
      console.log(`Marking protocol ${protocol.id} as in progress`);
      
      // Check if the reviewers array exists and update the specific reviewer's status
      const protocolSnap = await getDoc(protocolRef);
      if (!protocolSnap.exists()) {
        showNotification("Error", "Protocol not found.", "error");
        return;
      }
      
      const data = protocolSnap.data() as Protocol;
      
      if (data.reviewers && Array.isArray(data.reviewers)) {
        // Clone the reviewers array
        const updatedReviewers = [...data.reviewers];
        
        // Find and update the reviewer's status
        const reviewerIndex = updatedReviewers.findIndex(r => 
          r.id === reviewerId || r.name === reviewerName || r.name === reviewerId
        );
        
        if (reviewerIndex !== -1) {
          updatedReviewers[reviewerIndex].status = 'In Progress';
          updates.reviewers = updatedReviewers;
        } else {
          // Reviewer not found in array, add them
          updatedReviewers.push({
            id: reviewerId,
            name: reviewerName,
            status: 'In Progress',
            document_type: protocol.document_type,
            form_type: protocol.document_type
          });
          updates.reviewers = updatedReviewers;
          console.log(`Adding reviewer ${reviewerId} (${reviewerName}) to protocol ${protocol.id}`);
        }
      } else if (data.reviewer) {
        // Legacy protocol with a single reviewer field
        // Convert to using the reviewers array
        updates.reviewers = [{
          id: reviewerId,
          name: reviewerName,
          status: 'In Progress',
          document_type: protocol.document_type,
          form_type: protocol.document_type
        }];
        console.log(`Creating new reviewers array for legacy protocol ${protocol.id}`);
      }
      
      // Update protocol status
      updates.status = 'In Progress';
      
      await updateDoc(protocolRef, updates);
      console.log(`Protocol ${protocol.id} marked as in progress`);
      
      // Refresh the protocols list
      window.location.reload();
      
      // Show success notification
      showNotification(
        "Success", 
        "Protocol marked as in progress.", 
        "success"
      );
    } catch (err) {
      console.error("Error marking protocol as in progress:", err);
      showNotification(
        "Error", 
        `Failed to mark protocol as in progress: ${err instanceof Error ? err.message : 'Unknown error'}`, 
        "error"
      );
    }
  };
  
  const markProtocolAsCompleted = async (protocol: Protocol) => {
    try {
      if (!reviewerId || !reviewerName) {
        showNotification(
          "Authentication Error", 
          "Reviewer information is missing. Please try logging in again.", 
          "error"
        );
        return;
      }
      
      // Get protocol reference using helper
      const protocolRef = getProtocolRef(protocol);
      
      // Prepare the updates
      const completedDate = new Date().toISOString();
      const updates: any = { completed_at: completedDate };
      
      // Update the protocol
      console.log(`Marking protocol ${protocol.id} as completed`);
      
      // Check if the reviewers array exists and update the specific reviewer's status
      const protocolSnap = await getDoc(protocolRef);
      if (!protocolSnap.exists()) {
        showNotification("Error", "Protocol not found.", "error");
        return;
      }
      
      const data = protocolSnap.data() as Protocol;
      let allReviewersCompleted = true;
      
      if (data.reviewers && Array.isArray(data.reviewers)) {
        // Clone the reviewers array
        const updatedReviewers = [...data.reviewers];
        
        // Find and update the reviewer's status
        const reviewerIndex = updatedReviewers.findIndex(r => 
          r.id === reviewerId || r.name === reviewerName || r.name === reviewerId
        );
        
        if (reviewerIndex !== -1) {
          updatedReviewers[reviewerIndex] = {
            ...updatedReviewers[reviewerIndex],
            status: 'Completed',
            completed_at: completedDate
          };
          updates.reviewers = updatedReviewers;
        } else {
          // Reviewer not found in array, add them
          updatedReviewers.push({
            id: reviewerId,
            name: reviewerName,
            status: 'Completed',
            document_type: protocol.document_type,
            form_type: protocol.document_type,
            completed_at: completedDate
          });
          updates.reviewers = updatedReviewers;
          console.log(`Added reviewer ${reviewerId} to protocol ${protocol.id}`);
        }
        
        // Check if all reviewers are completed
        allReviewersCompleted = updatedReviewers.every(r => r.status === 'Completed');
      } else if (data.reviewer) {
        // Legacy protocol with a single reviewer field
        // Convert to using the reviewers array
        updates.reviewers = [{
          id: reviewerId,
          name: reviewerName,
          status: 'Completed',
          document_type: protocol.document_type,
          form_type: protocol.document_type,
          completed_at: completedDate
        }];
        console.log(`Added reviewer ${reviewerId} to legacy protocol ${protocol.id}`);
        
        // For legacy protocols with a single reviewer, this is completed
        allReviewersCompleted = true;
      }
      
      // Update overall status if all reviewers are completed
      if (allReviewersCompleted) {
        updates.status = 'Completed';
      }
      
      await updateDoc(protocolRef, updates);
      console.log(`Protocol ${protocol.id} marked as completed`);
      
      // Refresh the protocols list
      window.location.reload();
      
      // Show success notification
      showNotification(
        "Success", 
        "Protocol marked as completed.", 
        "success"
      );
    } catch (err) {
      console.error("Error marking protocol as completed:", err);
      showNotification(
        "Error", 
        `Failed to mark protocol as completed: ${err instanceof Error ? err.message : 'Unknown error'}`, 
        "error"
      );
    }
  };

  // Function to format the release period for display
  const formatReleasePeriod = (period: string): string => {
    // Handle the new format: "May2025 week-2"
    const newFormatMatch = period.match(/^(\w+)(\d{4})\s+week-(\d+)$/i);
    if (newFormatMatch) {
      const [_, month, year, week] = newFormatMatch;
      return `${month} ${year} Week ${week}`;
    }
    
    // Check if it's in the format of "Month Week" (e.g., "May 2nd")
    const monthWeekMatch = period.match(/^(\w+)\s+(\d+(?:st|nd|rd|th))$/i);
    if (monthWeekMatch) {
      const [_, month, week] = monthWeekMatch;
      return `${month} ${week} Week`;
    }
    
    // If it's already in a good format, return as is
    return `${period} Release Period`;
  };
                
                return (
    <div className="p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6">
      <h1 className="text-xl sm:text-2xl font-semibold text-gray-800">Reviewer Dashboard</h1>
      {loading ? (
        <div className="text-center py-10">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-green-500"></div>
          <p className="mt-2 text-gray-500">Loading your protocols...</p>
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
      ) : (
        <>
       
          
          {/* Status Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <div className="rounded-md bg-blue-50 p-3 mr-3">
                  <svg className="h-6 w-6 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                      <div>
                  <div className="text-sm text-gray-500">Total Protocols</div>
                  <div className="text-xl font-bold">{statusCounts.total}</div>
                </div>
              </div>
                      </div>
                      
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
                        <div className="flex items-center">
                <div className="rounded-md bg-green-50 p-3 mr-3">
                  <svg className="h-6 w-6 text-green-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                <div>
                  <div className="text-sm text-gray-500">Completed</div>
                  <div className="text-xl font-bold">{statusCounts.completed}</div>
                </div>
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <div className="rounded-md bg-yellow-50 p-3 mr-3">
                  <svg className="h-6 w-6 text-yellow-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm text-gray-500">In Progress</div>
                  <div className="text-xl font-bold">{statusCounts.inProgress}</div>
                </div>
              </div>
            </div>
            
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <div className="flex items-center">
                <div className="rounded-md bg-red-50 p-3 mr-3">
                  <svg className="h-6 w-6 text-red-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm text-gray-500">Overdue</div>
                  <div className="text-xl font-bold">{statusCounts.overdue}</div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Quick Access Form Links */}
          <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
            <h2 className="text-lg font-medium mb-4">Quick Access Form Links</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <a 
                href="https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__jZdNhdUQlE5MzA3UFRGNzVJMVpVMFo5SFJYVkc0OS4u"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                ICA Form
              </a>
              <a 
                href="https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__jZdNhdUQjBQQTdIWDFESFZIU1FaRFo1STlFWjc0Uy4u"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                PRA Form
              </a>
              <a 
                href="https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__jZdNhdUOUpDVFhBNk9WNFVMUU42VE5XTFBDVkRMQi4u"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                CFEFR Form
              </a>
              <a 
                href="https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__jZdNhdUQk85VTIyNUE5VjFQTTVYMzNUNlRXUVA4Si4u"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                PRA-EX Form
              </a>
            </div>
          </div>
          
          {/* Filter */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-2">
            <div>
              <h2 className="text-lg font-medium">Protocol Reviews</h2>
              <p className="text-sm text-gray-500">Manage your assigned protocol reviews</p>
            </div>
            <div className="w-full sm:w-auto">
              <select
                className="block w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm appearance-none bg-white pr-8 relative"
                style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }}
                value={selectedReleasePeriod}
                onChange={(e) => setSelectedReleasePeriod(e.target.value)}
              >
                <option value="all">All Release Periods</option>
                {releasePeriods.map((period) => (
                  <option key={period} value={period}>{period}</option>
                ))}
              </select>
            </div>
          </div>
          
          {/* Protocol Groups */}
          {Object.keys(groupedProtocols).length === 0 ? (
            <div className="text-center py-10 bg-white rounded-lg shadow-sm">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p className="mt-2 text-gray-500">No protocols assigned to you for this period.</p>
                        </div>
                      ) : (
            <div className="space-y-8">
              {sortedProtocolGroups.map(releasePeriod => {
                const periodProtocols = groupedProtocols[releasePeriod];
                const completedCount = periodProtocols.filter(p => getReviewerStatus(p) === 'Completed').length;
                const canMarkAllCompleted = periodProtocols.some(p => getReviewerStatus(p) !== 'Completed');
                
                // Format the release period title properly
                const formattedReleasePeriod = formatReleasePeriod(releasePeriod);
                
                return (
                  <div key={releasePeriod} className="bg-white rounded-lg shadow-sm overflow-hidden">
                    <div className="p-4 sm:p-6 border-b border-gray-200">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                        <div>
                          <h3 className="text-lg font-medium text-gray-900">{formattedReleasePeriod}</h3>
                          <p className="text-sm text-gray-500 mt-1">
                            {completedCount} of {periodProtocols.length} completed
                          </p>
                        </div>
                        
                        {canMarkAllCompleted && (
                          <button
                            onClick={() => showConfirmationModal(periodProtocols, releasePeriod, periodProtocols.length)}
                            className="mt-2 sm:mt-0 inline-flex items-center px-3 py-1.5 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                          >
                            Mark All as Completed
                          </button>
                        )}
                      </div>
                    </div>
                    
                    <div className="p-4 sm:p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                        {periodProtocols.map((protocol) => {
                            const reviewerStatus = getReviewerStatus(protocol);
                            const isCompleted = reviewerStatus === 'Completed';
                          const isOverdueProtocol = isOverdue(protocol.due_date) && !isCompleted;
                          const isDueSoonProtocol = isDueSoon(protocol.due_date) && !isCompleted;
                          const documentType = getReviewerDocumentType(protocol);
                          const formName = getFormTypeName(documentType);
                          
                          // Get reviewer-specific due date if available
                          const reviewerDueDate = (() => {
                            if (protocol.reviewers && reviewerId) {
                              const reviewer = protocol.reviewers.find(r => 
                                r.id === reviewerId || 
                                r.name === reviewerName ||
                                (r.name && reviewerName && 
                                  (r.name.toLowerCase().includes(reviewerName?.toLowerCase() || '') || 
                                   reviewerName?.toLowerCase().includes(r.name.toLowerCase() || '')))
                              );
                              
                              if (reviewer && reviewer.due_date) {
                                return ensureValidDueDate(reviewer.due_date);
                              }
                            }
                            return protocol.due_date;
                          })();
                            
                            return (
                            <div 
                                key={protocol.id}
                              className={`rounded-lg border ${
                                isOverdueProtocol 
                                  ? 'bg-red-50 border-red-200' 
                                  : isDueSoonProtocol 
                                    ? 'bg-yellow-50 border-yellow-200' 
                                    : isCompleted 
                                      ? 'bg-green-50 border-green-200' 
                                      : 'bg-white border-gray-200'
                              } overflow-hidden shadow-sm h-full flex flex-col`}
                            >
                              <div className="p-4 flex-1">
                                <div className="flex justify-between items-start mb-2">
                                  <h4 className="text-md font-medium text-gray-900 break-words line-clamp-2" title={protocol.protocol_name}>
                                    {protocol.spup_rec_code || protocol.id}
                                  </h4>
                                  <div className="relative group">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-gray-400 hover:text-gray-600 cursor-pointer" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <div className="absolute z-10 right-0 w-64 mt-2 p-3 bg-white rounded-md shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300">
                                      <p className="text-sm font-medium text-gray-900 mb-1">Protocol Details:</p>
                                      <p className="text-xs text-gray-600 mb-1"><span className="font-medium">Title:</span> {protocol.protocol_name}</p>
                                      <p className="text-xs text-gray-600 mb-1"><span className="font-medium">Level:</span> {protocol.academic_level}</p>
                                      <p className="text-xs text-gray-600 mb-1"><span className="font-medium">PI:</span> {protocol.principal_investigator || 'Not specified'}</p>
                                      <p className="text-xs text-gray-600 mb-1"><span className="font-medium">Adviser:</span> {protocol.adviser || 'Not specified'}</p>
                                      <p className="text-xs text-gray-600"><span className="font-medium">Release:</span> {protocol.release_period}</p>
                                    </div>
                                  </div>
                                </div>
                                
                                <div className="space-y-2 text-sm">
                                  <div className="flex items-center gap-1">
                                    <span className="font-medium text-gray-500">PI:</span>
                                    <span className="text-gray-700 line-clamp-1" title={protocol.principal_investigator || 'Not specified'}>
                                      {protocol.principal_investigator || 'Not specified'}
                                    </span>
                                  </div>
                                  
                                  <div className="flex items-center gap-1">
                                    <span className="font-medium text-gray-500">Due:</span>
                                    <span className={`${isOverdueProtocol ? 'text-red-700 font-semibold' : 'text-gray-700'}`}>
                                      {formatDate(reviewerDueDate)}
                                      {isOverdueProtocol && <span className="ml-1 text-xs font-medium inline-block bg-red-100 text-red-800 rounded-full px-2 py-0.5">Overdue</span>}
                                      {isDueSoonProtocol && <span className="ml-1 text-xs font-medium inline-block bg-yellow-100 text-yellow-800 rounded-full px-2 py-0.5">Soon</span>}
                                    </span>
                                  </div>
                                  
                                  <div className="flex items-center gap-1">
                                    <span className="font-medium text-gray-500">Form:</span>
                                    <span className="text-gray-700">{formName || 'N/A'}</span>
                                  </div>
                                  
                                  <div className="flex items-center gap-1">
                                    <span className="font-medium text-gray-500">Status:</span>
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                                      isCompleted
                                        ? 'bg-green-100 text-green-800'
                                        : isOverdueProtocol
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-blue-100 text-blue-800'
                                    }`}>
                                      {isCompleted ? 'Completed' : 'In Progress'}
                                  </span>
                    </div>
                  </div>
        </div>
                              
                              <div className="border-t border-gray-200 p-3 flex flex-col gap-2">
                                <a 
                                  href={protocol.protocol_file}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center justify-center px-3 py-1.5 border border-blue-300 text-sm font-medium rounded shadow-sm text-blue-700 bg-blue-50 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 w-full"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                                  View Document
                                </a>
                                
                                {isCompleted ? (
                                  <button
                                    onClick={() => markProtocolAsInProgress(protocol)}
                                    className="inline-flex items-center justify-center px-3 py-1 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-yellow-600 hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-yellow-500"
                                  >
                                    Mark In Progress
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => markProtocolAsCompleted(protocol)}
                                    className="inline-flex items-center justify-center px-3 py-1 border border-transparent text-xs font-medium rounded shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                                  >
                                    Mark Completed
                                  </button>
                                )}
                </div>
                </div>
                          );
                        })}
              </div>
            </div>
                  </div>
                );
              })}
            </div>
          )}
          
          {/* Confirmation Modal */}
          {confirmationModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-2">Mark All as Completed?</h3>
                <p className="text-sm text-gray-500 mb-4">
                  This will mark all {confirmationModal.protocolCount} protocols in the {confirmationModal.releasePeriod} release period as completed. Are you sure?
                </p>
                <div className="flex flex-col sm:flex-row-reverse gap-2">
              <button
                    onClick={confirmMarkAllCompleted}
                    className="inline-flex justify-center px-4 py-2 text-sm font-medium text-white bg-green-600 border border-transparent rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                    Confirm
              </button>
              <button
                    onClick={closeConfirmationModal}
                    className="inline-flex justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                    Cancel
              </button>
            </div>
          </div>
        </div>
      )}
          
          {/* Notification Modal */}
          {notificationModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
              <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
                <div className="flex items-start mb-4">
                  <div className="flex-shrink-0">
              {notificationModal.type === 'success' && (
                      <svg className="h-6 w-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {notificationModal.type === 'error' && (
                      <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {notificationModal.type === 'warning' && (
                      <svg className="h-6 w-6 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
              {notificationModal.type === 'info' && (
                      <svg className="h-6 w-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
            </div>
                  <div className="ml-3">
                    <h3 className="text-lg font-medium text-gray-900">{notificationModal.title}</h3>
                    <p className="mt-1 text-sm text-gray-500">{notificationModal.message}</p>
                  </div>
                </div>
            <div className="flex justify-end">
              <button
                onClick={closeNotificationModal}
                    className="inline-flex justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Close
              </button>
            </div>
          </div>
        </div>
          )}
        </>
      )}
    </div>
  );
} 