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
    if (protocol.reviewers && reviewerId) {
      const reviewer = protocol.reviewers.find(r => r.id === reviewerId);
      return reviewer?.document_type || '';
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

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Reviewer Dashboard</h1>
        <div className="flex justify-between items-center">
          <p className="text-gray-600">Welcome back, {reviewerName}. Here are your assigned protocols.</p>
          <NoticeAlert userType="reviewer" />
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow-md p-4 text-center">
          <h3 className="text-lg font-semibold mb-1">Total Assigned</h3>
          <p className="text-3xl font-bold">{statusCounts.total}</p>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4 text-center">
          <h3 className="text-lg font-semibold mb-1 text-green-600">Completed</h3>
          <p className="text-3xl font-bold text-green-600">{statusCounts.completed}</p>
            </div>
        <div className="bg-white rounded-lg shadow-md p-4 text-center">
          <h3 className="text-lg font-semibold mb-1 text-blue-600">In Progress</h3>
          <p className="text-3xl font-bold text-blue-600">{statusCounts.inProgress}</p>
          </div>
        <div className="bg-white rounded-lg shadow-md p-4 text-center">
          <h3 className="text-lg font-semibold mb-1 text-red-600">Overdue</h3>
          <p className="text-3xl font-bold text-red-600">{statusCounts.overdue}</p>
        </div>
      </div>
      
      {releasePeriods.length > 0 && (
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-xl font-bold">My Protocols</h2>
          <select
            value={selectedReleasePeriod}
            onChange={(e) => setSelectedReleasePeriod(e.target.value)}
            className="border border-gray-300 rounded py-2 px-4"
          >
            <option value="all">All Release Periods</option>
            {releasePeriods.map(period => (
              <option key={period} value={period}>{period}</option>
            ))}
          </select>
        </div>
      )}
        
        {loading ? (
        <div className="text-center py-8">
          <p>Loading protocols...</p>
          </div>
        ) : error ? (
        <div className="text-center py-8">
          <p className="text-red-500">{error}</p>
          </div>
        ) : (
        <div className="space-y-8">
          {protocols.length === 0 ? (
            <div className="text-center py-8 bg-white rounded-lg shadow-md">
              <h3 className="text-xl font-semibold mb-2">No protocols found</h3>
              <p className="text-gray-600 mb-4">
                You don&apos;t have any protocols assigned yet.
              </p>
              {debugInfo && (
                <div className="mt-4 p-4 bg-gray-50 rounded-lg mx-auto max-w-xl text-left">
                  <p className="font-medium mb-2">Debug Information:</p>
                  <pre className="text-xs bg-gray-100 p-3 rounded overflow-auto">
                    Reviewer ID: {reviewerId}
                    Reviewer Name: {reviewerName}
                    {debugInfo}
                  </pre>
                  <p className="text-sm mt-4">
                              <Link
                      href="/"
                      className="text-blue-600 hover:text-blue-800 underline"
                    >
                      Try logging in again
                    </Link> or contact the administrator to assign protocols to you.
                  </p>
                </div>
              )}
            </div>
          ) : Object.keys(groupedProtocols).length === 0 ? (
            <div className="text-center py-8 bg-white rounded-lg shadow-md">
              <p className="text-gray-500">No protocols found with the selected filters</p>
            </div>
          ) : (
            Object.entries(groupedProtocols)
              .sort(([releaseA], [releaseB]) => {
                // Sort by newest first - attempt to extract date or release number
                // For formats like "May 1st Week", "April 2nd Week", etc.
                const monthOrder: Record<string, number> = {
                  'January': 1, 'February': 2, 'March': 3, 'April': 4, 'May': 5, 'June': 6,
                  'July': 7, 'August': 8, 'September': 9, 'October': 10, 'November': 11, 'December': 12
                };
                
                // Check if release periods contain month names
                const monthA = Object.keys(monthOrder).find(month => releaseA.includes(month));
                const monthB = Object.keys(monthOrder).find(month => releaseB.includes(month));
                
                // If both contain month names, compare them
                if (monthA && monthB) {
                  const monthValueA = monthOrder[monthA];
                  const monthValueB = monthOrder[monthB];
                  
                  // If months are different, sort by month (newer months first)
                  if (monthValueA !== monthValueB) {
                    return monthValueB - monthValueA; // Reverse order for newest first
                  }
                  
                  // Extract week numbers if present
                  const weekMatchA = releaseA.match(/(\d+)(?:st|nd|rd|th)/);
                  const weekMatchB = releaseB.match(/(\d+)(?:st|nd|rd|th)/);
                  
                  if (weekMatchA && weekMatchB) {
                    return parseInt(weekMatchB[1]) - parseInt(weekMatchA[1]); // Newest week first
                  }
                }
                
                // For numbered releases like "First Release", "Second Release", etc.
                const releaseNumbers: Record<string, number> = {
                  'First': 1, 'Second': 2, 'Third': 3, 'Fourth': 4, 'Fifth': 5
                };
                
                // Check for numbered releases
                for (const word of Object.keys(releaseNumbers)) {
                  const aHasWord = releaseA.includes(word);
                  const bHasWord = releaseB.includes(word);
                  
                  if (aHasWord && bHasWord) {
                    // Both have numbered releases, assume newer ones have higher numbers
                    return releaseNumbers[word] - releaseNumbers[word]; // Same number, so 0
                  }
                  if (aHasWord && !bHasWord) {
                    return 1; // A is older (lower number), should come later
                  }
                  if (!aHasWord && bHasWord) {
                    return -1; // B is older (lower number), should come later
                  }
                }
                
                // Fall back to alphabetical sorting in reverse (assuming newer has higher lexical value)
                return releaseB.localeCompare(releaseA);
              })
              .map(([releasePeriod, protocolsInRelease]) => {
                // Count incomplete protocols for this reviewer
                const incompleteProtocolCount = protocolsInRelease.filter(p => {
                  if (p.reviewers && reviewerId) {
                    const thisReviewer = p.reviewers.find(r => r.id === reviewerId);
                    return !thisReviewer || thisReviewer.status !== 'Completed';
                  }
                  return p.status !== 'Completed';
                }).length;
                
                return (
                  <div key={releasePeriod} className="bg-white rounded-lg shadow-md overflow-hidden">
                    <div className="bg-gray-100 px-6 py-4 flex justify-between items-center">
                      <div>
                        <h2 className="text-xl font-semibold">{releasePeriod}</h2>
                        <p className="text-sm text-gray-600">{protocolsInRelease.length} protocols</p>
                      </div>
                      
                      {incompleteProtocolCount > 0 ? (
                        <div className="flex items-center">
                          <button
                            onClick={() => showConfirmationModal(protocolsInRelease, releasePeriod, incompleteProtocolCount)}
                            className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded flex items-center"
                            title="Mark all protocols in this group as completed"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Review All
                          </button>
                          <div className="ml-2 text-xs bg-gray-200 text-gray-700 rounded-full px-2 py-1">
                            Will complete {incompleteProtocolCount} protocols
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-1">
                          All protocols completed
                        </div>
                      )}
                    </div>
                    
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                          <tr>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Protocol</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Academic Level</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due Date</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Form Type</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                          </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                          {protocolsInRelease.map((protocol) => {
                            const reviewerStatus = getReviewerStatus(protocol);
                            const isCompleted = reviewerStatus === 'Completed';
                            const isOverdueProtocol = protocol.due_date && isOverdue(protocol.due_date) && !isCompleted;
                            const isDueSoonProtocol = protocol.due_date && isDueSoon(protocol.due_date) && !isCompleted;
                            
                            return (
                              <tr 
                                key={protocol.id}
                                className={`${
                                  isOverdueProtocol ? 'bg-red-50' :
                                  isDueSoonProtocol ? 'bg-yellow-50' :
                                  isCompleted ? 'bg-green-50' : ''
                                }`}
                              >
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{protocol.protocol_name}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{protocol.academic_level || 'N/A'}</td>
                                <td className={`px-6 py-4 whitespace-nowrap text-sm ${isOverdueProtocol ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                                  {formatDate(protocol.due_date)}
                                  {isOverdueProtocol && (
                                    <span className="ml-2 text-xs bg-red-100 text-red-800 px-2 py-0.5 rounded-full">
                                      Overdue
                                    </span>
                                  )}
                                  {isDueSoonProtocol && (
                                    <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full">
                                      Due Soon
                                    </span>
                                  )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{getFormTypeName(getReviewerDocumentType(protocol))}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                    isCompleted ? 'bg-green-100 text-green-800' : 
                                    isOverdueProtocol ? 'bg-red-100 text-red-800' :
                                    isDueSoonProtocol ? 'bg-yellow-100 text-yellow-800' :
                                    'bg-blue-100 text-blue-800'
                                  }`}>
                                    {isCompleted ? 'Completed' : 
                                     isOverdueProtocol ? 'Overdue' :
                                     isDueSoonProtocol ? 'Due Soon' :
                                     'In Progress'}
                                  </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                                  <Link
                                    href={`/reviewer/protocols/${protocol.id}`}
                                    className="text-blue-600 hover:text-blue-800 mr-4"
                                  >
                                    View Details
                                  </Link>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })
          )}
        </div>
      )}
      {confirmationModal && confirmationModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full m-4 shadow-xl">
            <h3 className="text-lg font-medium mb-4">Mark All Protocols as Completed</h3>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-4 mb-4">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-yellow-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <p className="text-sm text-yellow-700">
                    This action will mark <strong>all {confirmationModal.protocolCount} incomplete protocols</strong> in the "{confirmationModal.releasePeriod}" group as completed, regardless of whether you've actually reviewed them.
                  </p>
                </div>
              </div>
            </div>
            
            <p className="mb-4 text-sm text-gray-600">
              Please confirm that you have reviewed all protocols in this group and wish to mark them as completed.
            </p>
            
            <p className="mb-6 text-sm text-gray-500">
              <strong>Note:</strong> This action cannot be undone.
            </p>
            
            <div className="flex justify-end space-x-3">
              <button
                onClick={closeConfirmationModal}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
              >
                Cancel
              </button>
              <button
                onClick={confirmMarkAllCompleted}
                className="px-4 py-2 border border-transparent rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
              >
                Confirm & Complete All
              </button>
            </div>
          </div>
        </div>
      )}
      {notificationModal && notificationModal.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full m-4 shadow-xl">
            <div className="flex items-center mb-4">
              {notificationModal.type === 'success' && (
                <svg className="h-6 w-6 text-green-500 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {notificationModal.type === 'error' && (
                <svg className="h-6 w-6 text-red-500 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {notificationModal.type === 'warning' && (
                <svg className="h-6 w-6 text-yellow-400 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              )}
              {notificationModal.type === 'info' && (
                <svg className="h-6 w-6 text-blue-500 mr-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              <h3 className="text-lg font-medium">{notificationModal.title}</h3>
            </div>
            
            <p className="mb-6 text-sm text-gray-600">
              {notificationModal.message}
            </p>
            
            <div className="flex justify-end">
              <button
                onClick={closeNotificationModal}
                className={`px-4 py-2 border border-transparent rounded-md shadow-sm text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  notificationModal.type === 'success' ? 'bg-green-600 hover:bg-green-700 focus:ring-green-500' :
                  notificationModal.type === 'error' ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' :
                  notificationModal.type === 'warning' ? 'bg-yellow-600 hover:bg-yellow-700 focus:ring-yellow-500' :
                  'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
                }`}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 