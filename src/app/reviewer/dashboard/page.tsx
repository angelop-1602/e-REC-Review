'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, doc, updateDoc, Timestamp, runTransaction } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import { isOverdue, isDueSoon, formatDate, getFormTypeName } from '@/lib/utils';
import NoticeAlert from '@/components/NoticeAlert';

interface Protocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  reviewer: string;
  reviewers?: { 
    id: string;
    name: string;
    status: string;
    document_type?: string;
  }[];
  due_date: string;
  status: string;
  protocol_file: string;
  document_type: string;
  created_at: string;
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
        
        // Query protocols that include this reviewer
      const protocolsRef = collection(db, 'protocols');
        console.log(`Querying protocols for reviewer: ${id}`);
        const querySnapshot = await getDocs(protocolsRef);
      
      console.log(`Total protocols in database: ${querySnapshot.size}`);
        setDebugInfo(`Total protocols in database: ${querySnapshot.size}`);
      
        const fetchedProtocols: Protocol[] = [];
        const uniqueReleasePeriods = new Set<string>();
        let matchingProtocolCount = 0;
      
      querySnapshot.forEach((doc) => {
        const data = doc.data() as Protocol;
          console.log(`Protocol: ${data.protocol_name}, Reviewers:`, data.reviewers);
          
          // Check if the reviewer is in the reviewers array
          const isReviewerInArray = data.reviewers?.some(r => {
            const match = r.id === id || r.name === id || r.name === name;
            if (match) console.log(`Match found in reviewers array: ${r.id} / ${r.name}`);
            return match;
          });
          
          // Check if the reviewer is in the legacy reviewer field
          const isReviewerLegacy = data.reviewer === id || data.reviewer === name;
          if (isReviewerLegacy) console.log(`Match found in legacy reviewer field: ${data.reviewer}`);
          
          const isReviewer = isReviewerInArray || isReviewerLegacy;
          
          if (isReviewer) {
            matchingProtocolCount++;
            fetchedProtocols.push({
              ...data,
              id: doc.id
            });
            
            if (data.release_period) {
              uniqueReleasePeriods.add(data.release_period);
            }
          }
        });
        
        console.log(`Found ${matchingProtocolCount} protocols assigned to this reviewer`);
        setDebugInfo(prev => `${prev}\nMatching protocols: ${matchingProtocolCount}`);
        
        setProtocols(fetchedProtocols);
        setReleasePeriods(Array.from(uniqueReleasePeriods).sort());
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
    if (protocol.reviewers && Array.isArray(protocol.reviewers) && reviewerId && reviewerName) {
      // Use more comprehensive matching like getReviewerFormType
      for (const r of protocol.reviewers) {
        const idMatch = r.id === reviewerId;
        const nameMatch = r.name === reviewerName;
        const nameIncludes = Boolean(r.name && reviewerName && 
                      r.name.toLowerCase().includes(reviewerName.toLowerCase()));
        const reverseIncludes = Boolean(reviewerName && r.name && 
                      reviewerName.toLowerCase().includes(r.name.toLowerCase()));
        
        if (idMatch || nameMatch || nameIncludes || reverseIncludes) {
          if (r.document_type) {
            return r.document_type;
          }
        }
      }
    }
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
      
      // First check for year - most significant factor
      const yearMatch = period.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        // Base weight on year - newer year is higher weight
        weight += parseInt(yearMatch[1]) * 1000;
      }
      
      // Add weight for months - more recent months get higher weight
      const months = [
        'January', 'February', 'March', 'April', 'May', 'June', 
        'July', 'August', 'September', 'October', 'November', 'December'
      ];
      
      const monthIndex = months.findIndex(month => 
        period.toLowerCase().includes(month.toLowerCase())
      );
      
      if (monthIndex !== -1) {
        // Add month weight (0-11)
        weight += monthIndex;
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
          break;
        }
      }
      
      // Check for quarter references (Q1, Q2, etc)
      const quarterMatch = period.match(/Q([1-4])/i);
      if (quarterMatch) {
        const quarter = parseInt(quarterMatch[1]);
        weight += quarter;
      }
      
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
                                       reviewerName.toLowerCase().includes(r.name.toLowerCase())))
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

      await runTransaction(db, async (transaction) => {
        for (const protocol of protocolsToUpdate) {
          const protocolRef = doc(db, 'protocols', protocol.id);
          const currentTime = new Date().toISOString();
          
          // Prepare the updates
          const updates: any = { completed_at: currentTime };
          
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
                updatedReviewers[i] = { ...r, status: 'Completed' };
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
                document_type: protocol.document_type
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
                document_type: protocol.document_type
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
    switch(documentType) {
      case 'ICA':
        return 'https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__jZdNhdUQlE5MzA3UFRGNzVJMVpVMFo5SFJYVkc0OS4u';
      case 'PRA':
        return 'https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__jZdNhdUQjBQQTdIWDFESFZIU1FaRFo1STlFWjc0Uy4u';
      case 'CFEFR':
        return 'https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__jZdNhdUOUpDVFhBNk9WNFVMUU42VE5XTFBDVkRMQi4u';
      case 'PRA-EX':
      case 'PRA_EX':
        return 'https://forms.office.com/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAN__jZdNhdUQk85VTIyNUE5VjFQTTVYMzNUNlRXUVA4Si4u';
      default:
        return '';
    }
  };

  // Open form in a new window
  const openForm = (formUrl: string) => {
    if (formUrl) {
      window.open(formUrl, '_blank');
    }
  };

  // Functions to mark individual protocols as completed or in progress
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

      const protocolRef = doc(db, 'protocols', protocol.id);
      const currentTime = new Date().toISOString();
      
      // Prepare the updates
      const updates: any = { completed_at: currentTime };
      
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
            updatedReviewers[i] = { ...r, status: 'Completed' };
            userFound = true;
            break;
          }
        }
        
        // If user wasn't found in the array, add them
        if (!userFound && reviewerName && reviewerId) {
          updatedReviewers.push({
            id: reviewerId,
            name: reviewerName,
            status: 'Completed',
            document_type: protocol.document_type
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
        if (reviewerName && reviewerId) {
          updates.reviewers = [{
            id: reviewerId,
            name: reviewerName,
            status: 'Completed',
            document_type: protocol.document_type
          }];
        }
      }
      
      await updateDoc(protocolRef, updates);
      
      // Update the local state
      setProtocols(prevProtocols => {
        return prevProtocols.map(p => {
          if (p.id === protocol.id) {
            const updatedProtocol = { ...p };
            
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
          }
          return p;
        });
      });
      
      showNotification(
        "Protocol Completed", 
        "Successfully marked protocol as completed!", 
        "success"
      );
      
    } catch (err) {
      console.error('Error marking protocol as completed:', err);
      showNotification(
        "Error", 
        `Failed to mark protocol as completed: ${err instanceof Error ? err.message : 'Unknown error'}`, 
        "error"
      );
    }
  };
  
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
      
      const protocolRef = doc(db, 'protocols', protocol.id);
      
      // Prepare the updates
      const updates: any = { completed_at: null };
      
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
            updatedReviewers[i] = { ...r, status: 'In Progress' };
            userFound = true;
            break;
          }
        }
        
        // If user wasn't found in the array, add them
        if (!userFound && reviewerName && reviewerId) {
          updatedReviewers.push({
            id: reviewerId,
            name: reviewerName,
            status: 'In Progress',
            document_type: protocol.document_type
          });
        }
        
        updates.reviewers = updatedReviewers;
        
        // Set overall status to In Progress
        updates.status = 'In Progress';
      } else {
        // Legacy behavior - update overall status
        updates.status = 'In Progress';
        
        // Also add to reviewers array for future compatibility
        if (reviewerName && reviewerId) {
          updates.reviewers = [{
            id: reviewerId,
            name: reviewerName,
            status: 'In Progress',
            document_type: protocol.document_type
          }];
        }
      }
      
      await updateDoc(protocolRef, updates);
      
      // Update the local state
      setProtocols(prevProtocols => {
        return prevProtocols.map(p => {
          if (p.id === protocol.id) {
            const updatedProtocol = { ...p };
            
            if (updatedProtocol.reviewers && Array.isArray(updatedProtocol.reviewers)) {
              updatedProtocol.reviewers = updatedProtocol.reviewers.map(reviewer => {
                if (reviewer.id === reviewerId || 
                    reviewer.name === reviewerName || 
                    (reviewer.name && reviewerName && 
                      (reviewer.name.toLowerCase().includes(reviewerName.toLowerCase()) || 
                      reviewerName.toLowerCase().includes(reviewer.name.toLowerCase())))) {
                  return { ...reviewer, status: 'In Progress' };
                }
                return reviewer;
              });
            }
            
            updatedProtocol.status = 'In Progress';
            return updatedProtocol;
          }
          return p;
        });
      });
      
      showNotification(
        "Status Updated", 
        "Protocol marked as in progress.", 
        "success"
      );
      
    } catch (err) {
      console.error('Error marking protocol as in progress:', err);
      showNotification(
        "Error", 
        `Failed to update protocol status: ${err instanceof Error ? err.message : 'Unknown error'}`, 
        "error"
      );
    }
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
                
                return (
                  <div key={releasePeriod} className="bg-white rounded-lg shadow-sm overflow-hidden">
                    <div className="p-4 sm:p-6 border-b border-gray-200">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                        <div>
                          <h3 className="text-lg font-medium text-gray-900">{releasePeriod} Release Period</h3>
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
                                <h4 className="text-md font-medium text-gray-900 break-words mb-2 line-clamp-2" title={protocol.protocol_name}>
                                  {protocol.protocol_name}
                                </h4>
                                
                                <div className="space-y-2 text-sm">
                                  <div className="flex items-center gap-1">
                                    <span className="font-medium text-gray-500">Level:</span>
                                    <span className="text-gray-700">{protocol.academic_level}</span>
                                  </div>
                                  
                                  <div className="flex items-center gap-1">
                                    <span className="font-medium text-gray-500">Due:</span>
                                    <span className={`${isOverdueProtocol ? 'text-red-700 font-semibold' : 'text-gray-700'}`}>
                                      {formatDate(protocol.due_date)}
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