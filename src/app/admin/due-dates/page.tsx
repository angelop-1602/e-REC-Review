'use client';

import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, doc, updateDoc, getDoc, runTransaction } from 'firebase/firestore';
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

  const showNotification = (type: 'success' | 'error' | 'info' | 'warning', title: string, message: string) => {
    setNotification({
      isOpen: true,
      type,
      title,
      message
    });
  };

  useEffect(() => {
    const fetchProtocols = async () => {
      try {
        setLoading(true);
        
        // Fetch protocols
        const protocolsQuery = query(
          collection(db, 'protocols'),
          orderBy('due_date', 'asc')
        );
        const protocolsSnapshot = await getDocs(protocolsQuery);
        
        const fetchedProtocols: Protocol[] = [];
        const uniqueReleases = new Set<string>();
        
        protocolsSnapshot.forEach((doc) => {
          const protocol = { id: doc.id, ...doc.data() } as Protocol;
          
          // Only add protocols with a valid due date
          if (protocol.due_date && protocol.due_date.trim() !== '') {
            fetchedProtocols.push(protocol);
            
            if (protocol.release_period) {
              uniqueReleases.add(protocol.release_period);
            }
          }
        });
        
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
        
        // Extract unique reviewers from protocols for the reassignment dropdown
        const uniqueReviewers = new Map<string, {id: string; name: string}>();
        
        fetchedProtocols.forEach(protocol => {
          if (protocol.reviewers && protocol.reviewers.length > 0) {
            protocol.reviewers.forEach(reviewer => {
              if (reviewer.id && reviewer.name) {
                uniqueReviewers.set(reviewer.id, {
                  id: reviewer.id,
                  name: reviewer.name
                });
              }
            });
          } else if (protocol.reviewer) {
            uniqueReviewers.set(protocol.reviewer, {
              id: protocol.reviewer,
              name: protocol.reviewer
            });
          }
        });
        
        setReviewerList(Array.from(uniqueReviewers.values()));
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
    setReassignmentData({
      protocolId: protocol.id,
      protocolName: protocol.protocol_name,
      reviewerId,
      reviewerName,
      loading: false
    });
    setReassignModalOpen(true);
  };

  const handleReassign = async (newReviewerId: string) => {
    if (!reassignmentData || !newReviewerId) {
      showNotification('error', 'Error', 'Missing reassignment data or new reviewer');
      return;
    }

    try {
      setReassignmentData({
        ...reassignmentData,
        loading: true
      });

      // Use a transaction to ensure data consistency
      await runTransaction(db, async (transaction) => {
        // Get protocol document
        const protocolRef = doc(db, 'protocols', reassignmentData.protocolId);
        const protocolSnap = await transaction.get(protocolRef);
        
        if (!protocolSnap.exists()) {
          throw new Error('Protocol not found');
        }
        
        const protocolData = protocolSnap.data() as Protocol;
        
        // Find the new reviewer details
        const newReviewer = reviewerList.find(r => r.id === newReviewerId);
        
        if (!newReviewer) {
          throw new Error('New reviewer not found');
        }
        
        // Update the reviewers array with the new assignment
        let updatedReviewers: Reviewer[] = [];
        let documentType = '';
        
        if (protocolData.reviewers && protocolData.reviewers.length > 0) {
          // Find and update the specific reviewer
          updatedReviewers = protocolData.reviewers.map(reviewer => {
            if (reviewer.id === reassignmentData.reviewerId) {
              documentType = reviewer.document_type || '';
              return {
                ...reviewer,
                id: newReviewerId,
                name: newReviewer.name,
                status: 'In Progress'
              };
            }
            return reviewer;
          });
          
          // Update the document with the new reviewers array
          transaction.update(protocolRef, { 
            reviewers: updatedReviewers,
            // Reset status if this was the only overdue reviewer
            status: updatedReviewers.some(r => r.status === 'Completed') ? 'Partially Completed' : 'In Progress'
          });
        } else if (protocolData.reviewer === reassignmentData.reviewerId) {
          // Update single reviewer field
          documentType = protocolData.document_type || '';
          
          transaction.update(protocolRef, {
            reviewer: newReviewerId,
            status: 'In Progress'
          });
        } else {
          throw new Error('Reviewer not found in protocol');
        }
      });

      // Update local state to reflect the change
      setProtocols(prevProtocols => 
        prevProtocols.map(protocol => {
          if (protocol.id === reassignmentData.protocolId) {
            // Handle protocols with reviewers array
            if (protocol.reviewers && protocol.reviewers.length > 0) {
              const updatedReviewers = protocol.reviewers.map(reviewer => {
                if (reviewer.id === reassignmentData.reviewerId) {
                  const newReviewer = reviewerList.find(r => r.id === newReviewerId);
                  return {
                    ...reviewer,
                    id: newReviewerId,
                    name: newReviewer?.name || newReviewerId,
                    status: 'In Progress'
                  };
                }
                return reviewer;
              });
              
              return {
                ...protocol,
                reviewers: updatedReviewers,
                status: updatedReviewers.some(r => r.status === 'Completed') ? 'Partially Completed' : 'In Progress'
              };
            } 
            // Handle single reviewer field
            else if (protocol.reviewer === reassignmentData.reviewerId) {
              return {
                ...protocol,
                reviewer: newReviewerId,
                status: 'In Progress'
              };
            }
          }
          return protocol;
        })
      );

      showNotification(
        'success', 
        'Reassignment Successful', 
        `Protocol "${reassignmentData.protocolName}" has been reassigned from ${reassignmentData.reviewerName} to ${reviewerList.find(r => r.id === newReviewerId)?.name || newReviewerId}.`
      );
      
      setReassignModalOpen(false);
    } catch (error) {
      console.error('Error reassigning protocol:', error);
      showNotification('error', 'Reassignment Failed', `An error occurred: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setReassignmentData(prev => prev ? { ...prev, loading: false } : null);
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
                      <td className="px-6 py-4">
                        <div className="text-sm font-medium text-gray-900">{protocol.protocol_name}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-500">{protocol.release_period}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="text-sm text-gray-500">{formatDate(protocol.due_date)}</div>
                      </td>
                      <td className="px-6 py-4">
                        {getStatusLabel(protocol.status, protocol.due_date)}
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

      {/* Reassignment Modal */}
      {reassignmentData && (
        <ReassignmentModal
          isOpen={reassignModalOpen}
          protocolName={reassignmentData.protocolName}
          currentReviewerName={reassignmentData.reviewerName}
          reviewerList={reviewerList}
          loading={reassignmentData.loading}
          onCancel={() => setReassignModalOpen(false)}
          onReassign={handleReassign}
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