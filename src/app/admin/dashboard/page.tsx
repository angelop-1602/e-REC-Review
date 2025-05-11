'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import { isOverdue, isDueSoon, formatDate, getFormTypeName } from '@/lib/utils';
import NoticeAlert from '@/components/NoticeAlert';

// Define a specific type for protocols
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

export default function AdminDashboard() {
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedReleaseFilter, setSelectedReleaseFilter] = useState<string>('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('all');
  const [releasePeriods, setReleasePeriods] = useState<string[]>([]);

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
        querySnapshot.forEach((doc) => {
          fetchedProtocols.push({ 
            id: doc.id, 
            ...doc.data() 
          } as Protocol);
        });
        
        setProtocols(fetchedProtocols);
        
        // Extract unique release periods
        const uniqueReleasePeriods = Array.from(
          new Set(fetchedProtocols.map(p => p.release_period))
        ).sort();
        
        setReleasePeriods(uniqueReleasePeriods);
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
    // Filter by release period
    if (selectedReleaseFilter !== 'all' && protocol.release_period !== selectedReleaseFilter) {
      return false;
    }
    
    // Filter by status
    if (selectedStatusFilter !== 'all') {
      if (selectedStatusFilter === 'overdue') {
        // Check if protocol is overdue
        return protocol.due_date && isOverdue(protocol.due_date);
      } else if (selectedStatusFilter === 'due-soon') {
        // Check if protocol is due soon (within 3 days)
        return protocol.due_date && isDueSoon(protocol.due_date);
      } else {
        // Normal status filter
        return protocol.status === selectedStatusFilter;
      }
    }
    
    return true;
  });

  // Group protocols by release period
  const groupedProtocols: { [key: string]: Protocol[] } = {};
  
  filteredProtocols.forEach(protocol => {
    const releasePeriod = protocol.release_period || 'Unknown';
    
    if (!groupedProtocols[releasePeriod]) {
      groupedProtocols[releasePeriod] = [];
    }
    
    groupedProtocols[releasePeriod].push(protocol);
  });

  // Get counts of protocols by status
  const statusCounts = {
    total: protocols.length,
    completed: protocols.filter(p => p.status === 'Completed').length,
    inProgress: protocols.filter(p => p.status === 'In Progress').length,
    overdue: protocols.filter(p => p.due_date && isOverdue(p.due_date)).length,
    dueSoon: protocols.filter(p => p.due_date && isDueSoon(p.due_date)).length,
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6 flex justify-between items-center">
        <h1 className="text-2xl font-bold">Admin Dashboard</h1>
        <NoticeAlert userType="admin" />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-lg shadow-md p-4 text-center">
          <h3 className="text-lg font-semibold mb-1">Total</h3>
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
        <div className="bg-white rounded-lg shadow-md p-4 text-center">
          <h3 className="text-lg font-semibold mb-1 text-orange-600">Due Soon</h3>
          <p className="text-3xl font-bold text-orange-600">{statusCounts.dueSoon}</p>
        </div>
      </div>
      
      <div className="mb-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex space-x-4 w-full sm:w-auto">
          <Link 
            href="/admin/protocols" 
            className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
          >
            All Protocols
          </Link>
          <Link 
            href="/admin/csv-upload" 
            className="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600"
          >
            Upload CSV
          </Link>
        </div>
        <div className="flex space-x-3 w-full sm:w-auto">
          <select
            value={selectedReleaseFilter}
            onChange={(e) => setSelectedReleaseFilter(e.target.value)}
            className="border border-gray-300 rounded py-2 px-3"
          >
            <option value="all">All Releases</option>
            {releasePeriods.map(period => (
              <option key={period} value={period}>{period}</option>
            ))}
          </select>
          <select
            value={selectedStatusFilter}
            onChange={(e) => setSelectedStatusFilter(e.target.value)}
            className="border border-gray-300 rounded py-2 px-3"
          >
            <option value="all">All Status</option>
            <option value="In Progress">In Progress</option>
            <option value="Completed">Completed</option>
            <option value="overdue">Overdue</option>
            <option value="due-soon">Due Soon</option>
          </select>
        </div>
      </div>

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
          {Object.keys(groupedProtocols).length === 0 ? (
            <div className="text-center py-8 bg-white rounded-lg shadow-md">
              <p className="text-gray-500">No protocols found with the selected filters</p>
            </div>
          ) : (
            Object.entries(groupedProtocols)
              .sort(([releaseA], [releaseB]) => releaseA.localeCompare(releaseB))
              .map(([releasePeriod, protocolsInRelease]) => (
                <div key={releasePeriod} className="bg-white rounded-lg shadow-md overflow-hidden">
                  <div className="bg-gray-100 px-6 py-4">
                    <h2 className="text-xl font-semibold">{releasePeriod}</h2>
                    <p className="text-sm text-gray-600">{protocolsInRelease.length} protocols</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Protocol
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Academic Level
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Reviewers
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Form Type
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Status
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Due Date
                          </th>
                          <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-200">
                        {protocolsInRelease.map((protocol) => (
                          <tr key={protocol.id}>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="font-medium text-gray-900">{protocol.protocol_name}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-sm text-gray-500">{protocol.academic_level}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-500">
                                {protocol.reviewers ? protocol.reviewers.length : 1} reviewer(s)
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-500">
                                {protocol.document_type ? getFormTypeName(protocol.document_type) : (
                                  protocol.reviewers && protocol.reviewers[0]?.document_type ? 
                                  getFormTypeName(protocol.reviewers[0].document_type) : 'N/A'
                                )}
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                                protocol.status === 'Completed' ? 'bg-green-100 text-green-800' : 
                                protocol.due_date && isOverdue(protocol.due_date) ? 'bg-red-100 text-red-800' :
                                protocol.due_date && isDueSoon(protocol.due_date) ? 'bg-yellow-100 text-yellow-800' :
                                'bg-blue-100 text-blue-800'
                              }`}>
                                {protocol.status === 'Completed' ? 'Completed' : 
                                 protocol.due_date && isOverdue(protocol.due_date) ? 'Overdue' :
                                 protocol.due_date && isDueSoon(protocol.due_date) ? 'Due Soon' :
                                 'In Progress'}
                              </span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-sm text-gray-500">{protocol.due_date ? formatDate(protocol.due_date) : 'N/A'}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <Link 
                                href={`/admin/protocols/${protocol.id}`}
                                className="text-sm font-medium text-gray-500 hover:text-gray-900"
                              >
                                View
                              </Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}