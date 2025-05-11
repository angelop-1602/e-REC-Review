'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import { getFormTypeName } from '@/lib/utils';

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
  reviewer: string;
  reviewers?: Reviewer[];
  due_date: string;
  status: string;
  protocol_file: string;
  document_type: string;
  created_at: string;
  reviewerCount?: number;
  completedReviewerCount?: number;
  relatedProtocols?: Protocol[];
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overdueProtocols, setOverdueProtocols] = useState<Protocol[]>([]);
  const [upcomingDueProtocols, setUpcomingDueProtocols] = useState<Protocol[]>([]);
  const [recentProtocols, setRecentProtocols] = useState<Protocol[]>([]);
  const [reviewerStats, setReviewerStats] = useState<{
    reviewerId: string;
    name: string;
    assigned: number;
    completed: number;
    overdue: number;
  }[]>([]);
  const [stats, setStats] = useState({
    totalProtocols: 0,
    totalReviews: 0,
    overdueCount: 0,
    completedCount: 0,
    inProgressCount: 0,
    dueSoonCount: 0
  });
  
  useEffect(() => {
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        const protocolsRef = collection(db, 'protocols');
        const protocolsSnap = await getDocs(protocolsRef);
        
        const protocols: Protocol[] = [];
        protocolsSnap.forEach((doc) => {
          protocols.push({ ...doc.data(), id: doc.id } as Protocol);
        });
        
        // Group protocols by protocol_name
        const protocolGroups = protocols.reduce((acc, protocol) => {
          if (!acc[protocol.protocol_name]) {
            acc[protocol.protocol_name] = [];
          }
          acc[protocol.protocol_name].push(protocol);
          return acc;
        }, {} as Record<string, Protocol[]>);
        
        // Create a grouped version of protocols (one entry per protocol_name)
        const groupedProtocols = Object.entries(protocolGroups).map((entry) => {
          // Use the first protocol as the base
          const protocolItems = entry[1];
          const baseProtocol = protocolItems[0];
          
          // Count completed and total reviewers
          const reviewerCount = protocolItems.reduce((count, p) => {
            if (p.reviewers && p.reviewers.length > 0) {
              return count + p.reviewers.length;
            } else if (p.reviewer) {
              return count + 1;
            }
            return count;
          }, 0);
          
          const completedReviewerCount = protocolItems.reduce((count, p) => {
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
            // Store all related protocols for reference
            relatedProtocols: protocolItems
          };
        });
        
        // Calculate stats
        const uniqueProtocolCount = Object.keys(protocolGroups).length;
        const completed = groupedProtocols.filter(p => p.status === 'Completed').length;
        const partiallyCompleted = groupedProtocols.filter(p => p.status === 'Partially Completed').length;
        const inProgress = groupedProtocols.filter(p => p.status === 'In Progress').length;
        
        // Get current date
        const today = new Date();
        const todayStr = today.toISOString().split('T')[0];
        
        // Calculate overdue protocols
        const overdue = groupedProtocols.filter(p => {
          return p.status !== 'Completed' && p.due_date < todayStr;
        });
        
        // Calculate upcoming due protocols (due in the next 7 days)
        const nextWeek = new Date();
        nextWeek.setDate(today.getDate() + 7);
        const nextWeekStr = nextWeek.toISOString().split('T')[0];
        
        const upcoming = groupedProtocols.filter(p => {
          return p.status !== 'Completed' && 
                 p.due_date >= todayStr && 
                 p.due_date <= nextWeekStr;
        });
        
        // Sort by due date (ascending for overdue and upcoming)
        const sortedOverdue = [...overdue].sort((a, b) => a.due_date.localeCompare(b.due_date));
        const sortedUpcoming = [...upcoming].sort((a, b) => a.due_date.localeCompare(b.due_date));
        
        // Get recent protocols (sorted by created_at, desc)
        const sortedRecent = [...groupedProtocols]
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
          .slice(0, 5);
        
        // Calculate reviewer stats
        const reviewersMap = new Map<string, {
          name: string;
          assigned: number;
          completed: number;
          overdue: number;
        }>();
        
        protocols.forEach(protocol => {
          // Handle protocols with reviewers array
          if (protocol.reviewers && protocol.reviewers.length > 0) {
            protocol.reviewers.forEach(reviewer => {
              const reviewerStats = reviewersMap.get(reviewer.id) || {
                name: reviewer.name,
                assigned: 0,
                completed: 0,
                overdue: 0
              };
              
              reviewerStats.assigned++;
              
              if (reviewer.status === 'Completed') {
                reviewerStats.completed++;
              }
              
              if (reviewer.status !== 'Completed' && protocol.due_date < todayStr) {
                reviewerStats.overdue++;
              }
              
              reviewersMap.set(reviewer.id, reviewerStats);
            });
          } 
          // Handle protocols with single reviewer field
          else if (protocol.reviewer) {
            const reviewerStats = reviewersMap.get(protocol.reviewer) || {
              name: protocol.reviewer,
              assigned: 0,
              completed: 0,
              overdue: 0
            };
            
            reviewerStats.assigned++;
            
            if (protocol.status === 'Completed') {
              reviewerStats.completed++;
            }
            
            if (protocol.status !== 'Completed' && protocol.due_date < todayStr) {
              reviewerStats.overdue++;
            }
            
            reviewersMap.set(protocol.reviewer, reviewerStats);
          }
        });
        
        // Convert map to array and sort by assigned count (descending)
        const reviewerStatsArray = Array.from(reviewersMap.entries()).map(([reviewerId, stats]) => ({
          reviewerId,
          ...stats
        }));
        
        reviewerStatsArray.sort((a, b) => b.assigned - a.assigned);
        
        setStats({
          totalProtocols: uniqueProtocolCount,
          totalReviews: protocols.length,
          overdueCount: overdue.length,
          completedCount: completed,
          inProgressCount: inProgress + partiallyCompleted,
          dueSoonCount: upcoming.length
        });
        
        setOverdueProtocols(sortedOverdue.slice(0, 5)); // Show top 5
        setUpcomingDueProtocols(sortedUpcoming.slice(0, 5)); // Show top 5
        setRecentProtocols(sortedRecent); // Show top 5
        setReviewerStats(reviewerStatsArray.slice(0, 10)); // Show top 10 reviewers
        
      } catch (err) {
        console.error('Error fetching dashboard data:', err);
        setError('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };
    
    fetchDashboardData();
  }, []);
  
  // Helper function to check if a protocol is overdue
  const isOverdue = (dueDate: string) => {
    const today = new Date();
    const due = new Date(dueDate);
    return today > due;
  };
  
  if (loading) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md flex justify-center">
        <p>Loading dashboard data...</p>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-md text-red-600">
        <p>{error}</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold border-b-2 border-gray-200 pb-2 mb-4">Admin Dashboard</h1>
      
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <div className="bg-white p-4 rounded-lg shadow-md">
          <h2 className="text-lg font-semibold">Total Protocols</h2>
          <p className="text-3xl font-bold">{stats.totalProtocols}</p>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow-md">
          <h2 className="text-lg font-semibold">Total Reviews</h2>
          <p className="text-3xl font-bold">{stats.totalReviews}</p>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow-md">
          <h2 className="text-lg font-semibold">In Progress</h2>
          <p className="text-3xl font-bold">{stats.inProgressCount}</p>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow-md">
          <h2 className="text-lg font-semibold">Completed</h2>
          <p className="text-3xl font-bold">{stats.completedCount}</p>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow-md">
          <h2 className="text-lg font-semibold">Overdue</h2>
          <p className="text-3xl font-bold text-red-600">{stats.overdueCount}</p>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow-md">
          <h2 className="text-lg font-semibold">Due Soon</h2>
          <p className="text-3xl font-bold text-yellow-600">{stats.dueSoonCount}</p>
        </div>
      </div>
      
      {/* Quick Action Buttons */}
      <div className="flex flex-wrap gap-4">
        <Link 
          href="/admin/protocols" 
          className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600"
        >
          View All Protocols
        </Link>
        
        <Link 
          href="/admin/reviewers" 
          className="bg-purple-500 text-white py-2 px-4 rounded hover:bg-purple-600"
        >
          Manage Reviewers
        </Link>
        
        <Link 
          href="/admin/upload" 
          className="bg-green-500 text-white py-2 px-4 rounded hover:bg-green-600"
        >
          Upload CSV
        </Link>
        
        <Link 
          href="/admin/protocols?filter=overdue" 
          className="bg-red-500 text-white py-2 px-4 rounded hover:bg-red-600"
        >
          View Overdue Protocols
        </Link>
      </div>
      
      {/* Dashboard Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Overdue Protocols */}
        <div className="bg-white p-6 rounded-lg shadow-md lg:col-span-2">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Overdue Reviews</h2>
            <Link href="/admin/protocols?filter=overdue" className="text-blue-500 hover:underline text-sm">
              View All
            </Link>
          </div>
          
          {overdueProtocols.length === 0 ? (
            <p className="text-gray-500">No overdue protocols</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="py-2 px-4 text-left">Protocol Name</th>
                    <th className="py-2 px-4 text-left">Document Type</th>
                    <th className="py-2 px-4 text-left">Due Date</th>
                    <th className="py-2 px-4 text-left">Status</th>
                    <th className="py-2 px-4 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {overdueProtocols.map((protocol) => (
                    <tr key={protocol.id} className="border-b hover:bg-gray-50">
                      <td className="py-2 px-4">
                        <div className="font-medium">{protocol.protocol_name}</div>
                        <div className="text-xs text-gray-500">
                          {protocol.academic_level} · {protocol.release_period}
                        </div>
                      </td>
                      <td className="py-2 px-4">
                        {protocol.relatedProtocols && protocol.relatedProtocols.length > 0 ? (
                          <>
                            {/* If we have multiple document types, show them as a compact list */}
                            {new Set(protocol.relatedProtocols.flatMap(p => 
                              p.reviewers?.map(r => r.document_type) || [p.document_type]
                            )).size > 1 ? (
                              <div className="flex flex-wrap gap-1">
                                {Array.from(new Set(protocol.relatedProtocols.flatMap(p => 
                                  p.reviewers?.map(r => r.document_type) || [p.document_type]
                                ))).map((type, idx) => (
                                  <span key={idx} className="inline-block bg-gray-100 rounded-full px-2 py-0.5 text-xs">
                                    {type ? getFormTypeName(type) : 'N/A'}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              protocol.document_type ? getFormTypeName(protocol.document_type) : 'N/A'
                            )}
                          </>
                        ) : (
                          protocol.document_type ? getFormTypeName(protocol.document_type) : 'N/A'
                        )}
                      </td>
                      <td className="py-2 px-4 text-red-600 font-medium">
                        {protocol.due_date}
                        <span className="block text-xs">
                          {Math.floor((new Date().getTime() - new Date(protocol.due_date).getTime()) / (1000 * 60 * 60 * 24))} days overdue
                        </span>
                      </td>
                      <td className="py-2 px-4">
                        <div className="flex items-center space-x-2">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            protocol.status === 'Completed' 
                              ? 'bg-green-100 text-green-800' 
                              : protocol.status === 'Partially Completed'
                                ? 'bg-blue-100 text-blue-800'
                                : 'bg-yellow-100 text-yellow-800'
                          }`}>
                            {protocol.status}
                          </span>
                          <span className="text-xs text-gray-500">
                            ({protocol.completedReviewerCount}/{protocol.reviewerCount})
                          </span>
                        </div>
                      </td>
                      <td className="py-2 px-4">
                        <div className="flex space-x-2">
                          <Link
                            href={`/admin/protocols/${protocol.id}`}
                            className="bg-blue-500 text-white px-3 py-1 rounded text-xs hover:bg-blue-600"
                          >
                            View
                          </Link>
                          <Link
                            href={`/admin/protocols/${protocol.id}`}
                            className="bg-red-500 text-white px-3 py-1 rounded text-xs hover:bg-red-600"
                          >
                            Manage
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        
        {/* Right column: Reviewer Stats */}
        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Reviewer Statistics</h2>
            <Link href="/admin/reviewers" className="text-blue-500 hover:underline text-sm">
              View All
            </Link>
          </div>
          
          {reviewerStats.length === 0 ? (
            <p className="text-gray-500">No reviewer data available</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="py-2 px-4 text-left">Reviewer</th>
                    <th className="py-2 px-4 text-left">Assigned</th>
                    <th className="py-2 px-4 text-left">Completed</th>
                    <th className="py-2 px-4 text-left">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {reviewerStats.map((reviewer) => (
                    <tr key={reviewer.reviewerId} className="border-b">
                      <td className="py-2 px-4">{reviewer.name}</td>
                      <td className="py-2 px-4">{reviewer.assigned}</td>
                      <td className="py-2 px-4 text-green-600">{reviewer.completed}</td>
                      <td className="py-2 px-4 text-red-600">{reviewer.overdue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      
      {/* Upcoming Due Protocols */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Upcoming Reviews (Next 7 Days)</h2>
          <Link href="/admin/protocols?filter=upcoming" className="text-blue-500 hover:underline text-sm">
            View All
          </Link>
        </div>
        
        {upcomingDueProtocols.length === 0 ? (
          <p className="text-gray-500">No upcoming reviews due in the next 7 days</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-100">
                  <th className="py-2 px-4 text-left">Protocol Name</th>
                  <th className="py-2 px-4 text-left">Document Type</th>
                  <th className="py-2 px-4 text-left">Due Date</th>
                  <th className="py-2 px-4 text-left">Status</th>
                  <th className="py-2 px-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {upcomingDueProtocols.map((protocol) => (
                  <tr key={protocol.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-4">
                      <div className="font-medium">{protocol.protocol_name}</div>
                      <div className="text-xs text-gray-500">
                        {protocol.academic_level} · {protocol.release_period}
                      </div>
                    </td>
                    <td className="py-2 px-4">
                      {protocol.relatedProtocols && protocol.relatedProtocols.length > 0 ? (
                        <>
                          {/* If we have multiple document types, show them as a compact list */}
                          {new Set(protocol.relatedProtocols.flatMap(p => 
                            p.reviewers?.map(r => r.document_type) || [p.document_type]
                          )).size > 1 ? (
                            <div className="flex flex-wrap gap-1">
                              {Array.from(new Set(protocol.relatedProtocols.flatMap(p => 
                                p.reviewers?.map(r => r.document_type) || [p.document_type]
                              ))).map((type, idx) => (
                                <span key={idx} className="inline-block bg-gray-100 rounded-full px-2 py-0.5 text-xs">
                                  {type ? getFormTypeName(type) : 'N/A'}
                                </span>
                              ))}
                            </div>
                          ) : (
                            protocol.document_type ? getFormTypeName(protocol.document_type) : 'N/A'
                          )}
                        </>
                      ) : (
                        protocol.document_type ? getFormTypeName(protocol.document_type) : 'N/A'
                      )}
                    </td>
                    <td className="py-2 px-4 text-yellow-600 font-medium">
                      {protocol.due_date}
                      <span className="block text-xs">
                        Due in {Math.ceil((new Date(protocol.due_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))} days
                      </span>
                    </td>
                    <td className="py-2 px-4">
                      <div className="flex items-center space-x-2">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          protocol.status === 'Completed' 
                            ? 'bg-green-100 text-green-800' 
                            : protocol.status === 'Partially Completed'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {protocol.status}
                        </span>
                        <span className="text-xs text-gray-500">
                          ({protocol.completedReviewerCount}/{protocol.reviewerCount})
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-4">
                      <div className="flex space-x-2">
                        <Link
                          href={`/admin/protocols/${protocol.id}`}
                          className="bg-blue-500 text-white px-3 py-1 rounded text-xs hover:bg-blue-600"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      
      {/* Recent Protocols */}
      <div className="bg-white p-6 rounded-lg shadow-md">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Recently Added Protocols</h2>
          <Link href="/admin/protocols?sort=recent" className="text-blue-500 hover:underline text-sm">
            View All
          </Link>
        </div>
        
        {recentProtocols.length === 0 ? (
          <p className="text-gray-500">No protocols found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-100">
                  <th className="py-2 px-4 text-left">Protocol Name</th>
                  <th className="py-2 px-4 text-left">Document Type</th>
                  <th className="py-2 px-4 text-left">Added On</th>
                  <th className="py-2 px-4 text-left">Status</th>
                  <th className="py-2 px-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentProtocols.map((protocol) => (
                  <tr key={protocol.id} className="border-b hover:bg-gray-50">
                    <td className="py-2 px-4">
                      <div className="font-medium">{protocol.protocol_name}</div>
                      <div className="text-xs text-gray-500">
                        {protocol.academic_level} · {protocol.release_period}
                      </div>
                    </td>
                    <td className="py-2 px-4">
                      {protocol.relatedProtocols && protocol.relatedProtocols.length > 0 ? (
                        <>
                          {/* If we have multiple document types, show them as a compact list */}
                          {new Set(protocol.relatedProtocols.flatMap(p => 
                            p.reviewers?.map(r => r.document_type) || [p.document_type]
                          )).size > 1 ? (
                            <div className="flex flex-wrap gap-1">
                              {Array.from(new Set(protocol.relatedProtocols.flatMap(p => 
                                p.reviewers?.map(r => r.document_type) || [p.document_type]
                              ))).map((type, idx) => (
                                <span key={idx} className="inline-block bg-gray-100 rounded-full px-2 py-0.5 text-xs">
                                  {type ? getFormTypeName(type) : 'N/A'}
                                </span>
                              ))}
                            </div>
                          ) : (
                            protocol.document_type ? getFormTypeName(protocol.document_type) : 'N/A'
                          )}
                        </>
                      ) : (
                        protocol.document_type ? getFormTypeName(protocol.document_type) : 'N/A'
                      )}
                    </td>
                    <td className="py-2 px-4">
                      {new Date(protocol.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 px-4">
                      <div className="flex items-center space-x-2">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          protocol.status === 'Completed' 
                            ? 'bg-green-100 text-green-800' 
                            : protocol.status === 'Partially Completed'
                              ? 'bg-blue-100 text-blue-800'
                              : isOverdue(protocol.due_date)
                                ? 'bg-red-100 text-red-800'
                                : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {protocol.status}
                        </span>
                        <span className="text-xs text-gray-500">
                          ({protocol.completedReviewerCount}/{protocol.reviewerCount})
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-4">
                      <div className="flex space-x-2">
                        <Link
                          href={`/admin/protocols/${protocol.id}`}
                          className="bg-blue-500 text-white px-3 py-1 rounded text-xs hover:bg-blue-600"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
} 