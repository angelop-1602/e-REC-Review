'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import { isOverdue, isDueSoon, formatDate, getFormTypeName } from '@/lib/utils';
import ProtocolTable from '@/components/ProtocolTable';
import ProtocolStatusCard from '@/components/ProtocolStatusCard';
import ProtocolDetailsModal from '@/components/ProtocolDetailsModal';
import ReassignmentModal from '@/components/ReassignmentModal';
import NotificationModal from '@/components/NotificationModal';

interface Reviewer {
  id: string;
  name: string;
  status: string;
  document_type: string;
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

  useEffect(() => {
    const fetchProtocols = async () => {
      try {
        setLoading(true);
        const protocolsQuery = query(
          collection(db, 'protocols'),
          orderBy('created_at', 'desc')
        );
        const querySnapshot = await getDocs(protocolsQuery);
        
        const fetchedProtocols: Protocol[] = [];
        const uniqueReleases = new Set<string>();
        const uniqueAcademic = new Set<string>();
        const uniqueReviewers = new Map<string, {id: string; name: string}>();
        
        querySnapshot.forEach((doc) => {
          const data = doc.data() as Protocol;
          fetchedProtocols.push({ 
            ...data,
            id: doc.id 
          });
          
          if (data.release_period) {
            uniqueReleases.add(data.release_period);
          }
          
          if (data.academic_level) {
            uniqueAcademic.add(data.academic_level);
          }
          
          // Extract reviewers for the reassignment dropdown
          if (data.reviewers && data.reviewers.length > 0) {
            data.reviewers.forEach(reviewer => {
              if (reviewer.id && reviewer.name) {
                uniqueReviewers.set(reviewer.id, {
                  id: reviewer.id,
                  name: reviewer.name
                });
              }
            });
          } else if (data.reviewer) {
            uniqueReviewers.set(data.reviewer, {
              id: data.reviewer,
              name: data.reviewer
            });
          }
        });

        // Process the protocols to create a grouped version with counts
        const protocolarrayByName: {[key: string]: Protocol[]} = {};
        fetchedProtocols.forEach(protocol => {
          if (!protocolarrayByName[protocol.protocol_name]) {
            protocolarrayByName[protocol.protocol_name] = [];
          }
          protocolarrayByName[protocol.protocol_name].push(protocol);
        });

        // Create a grouped version of protocols (one entry per protocol_name)
        const processedProtocols = Object.entries(protocolarrayByName).map(([name, items]) => {
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
    const matchesSearch = protocol.protocol_name.toLowerCase().includes(searchTerm.toLowerCase());
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
        const matchesSearch = protocol.protocol_name.toLowerCase().includes(searchTerm.toLowerCase());
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
          const matchesSearch = protocol.protocol_name.toLowerCase().includes(searchTerm.toLowerCase());
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
    setReassignmentData({
      protocol,
      reviewerId,
      reviewerName,
      loading: false
    });
    setReassignModalOpen(true);
  };

  const executeReassignment = async (newReviewerId: string) => {
    if (!reassignmentData || !newReviewerId) {
      showNotification('error', 'Error', 'Missing reassignment data or new reviewer');
      return;
    }

    try {
      // Implementation would be similar to the due-dates page's reassignment functionality
      // This is a placeholder for the functionality that would update the reviewer
      showNotification('success', 'Reassigned', `Protocol "${reassignmentData.protocol.protocol_name}" reassigned successfully.`);
      setReassignModalOpen(false);
    } catch (error) {
      console.error('Error reassigning protocol:', error);
      showNotification('error', 'Error', 'Failed to reassign protocol');
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
            <label htmlFor="search" className="block text-sm font-medium text-gray-700 mb-1">Search Protocol</label>
            <input
              type="text"
              id="search"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by protocol name..."
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
                          Protocol Name
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
                            <div className="text-sm font-medium text-gray-900">{protocol.protocol_name}</div>
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
                            <div className="text-sm text-gray-500">{formatDate(protocol.due_date)}</div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            {getStatusBadge(protocol.status, protocol.due_date)}
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
          protocolName={reassignmentData.protocol.protocol_name}
          currentReviewerName={reassignmentData.reviewerName}
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