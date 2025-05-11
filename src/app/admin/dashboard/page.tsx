'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import { isOverdue, isDueSoon, formatDate } from '@/lib/utils';
import ProtocolStatusCard from '@/components/ProtocolStatusCard';

interface Reviewer {
  id: string;
  name: string;
  status: string;
  document_type?: string;
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
        const groupedProtocols = Object.entries(protocolGroups).map(([name, items]) => {
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
            completedReviewerCount
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
        
        // Calculate overdue protocols - only include protocols that have a due date
        const overdue = groupedProtocols.filter(p => {
          return p.status !== 'Completed' && 
                 p.due_date && 
                 p.due_date.trim() !== '' && 
                 p.due_date < todayStr;
        });
        
        // Calculate upcoming due protocols (due in the next 7 days) - only include protocols that have a due date
        const nextWeek = new Date();
        nextWeek.setDate(today.getDate() + 7);
        const nextWeekStr = nextWeek.toISOString().split('T')[0];
        
        const upcoming = groupedProtocols.filter(p => {
          return p.status !== 'Completed' && 
                 p.due_date && 
                 p.due_date.trim() !== '' && 
                 p.due_date >= todayStr && 
                 p.due_date <= nextWeekStr;
        });
        
        // Sort by due date (ascending for overdue and upcoming)
        const sortedOverdue = [...overdue].sort((a, b) => a.due_date.localeCompare(b.due_date));
        const sortedUpcoming = [...upcoming].sort((a, b) => a.due_date.localeCompare(b.due_date));
        
        // Get recent protocols (sorted by created_at, desc)
        const sortedRecent = [...groupedProtocols]
          .sort((a, b) => {
            const dateA = new Date(a.created_at).getTime();
            const dateB = new Date(b.created_at).getTime();
            return dateB - dateA;
          })
          .slice(0, 5);
        
        // Calculate reviewer stats - only count protocols with due dates for overdue stats
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
              
              if (reviewer.status !== 'Completed' && 
                  protocol.due_date && 
                  protocol.due_date.trim() !== '' && 
                  protocol.due_date < todayStr) {
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
            
            if (protocol.status !== 'Completed' && 
                protocol.due_date && 
                protocol.due_date.trim() !== '' && 
                protocol.due_date < todayStr) {
              reviewerStats.overdue++;
            }
            
            reviewersMap.set(protocol.reviewer, reviewerStats);
          }
        });
        
        // Convert Map to Array and sort by assigned count (desc)
        const sortedReviewers = Array.from(reviewersMap.entries())
          .map(([reviewerId, stats]) => ({
            reviewerId,
            ...stats
          }))
          .sort((a, b) => b.assigned - a.assigned)
          .slice(0, 5); // Get top 5 for display
        
        // Set all the state
        setOverdueProtocols(sortedOverdue.slice(0, 5));
        setUpcomingDueProtocols(sortedUpcoming.slice(0, 5));
        setRecentProtocols(sortedRecent);
        setReviewerStats(sortedReviewers);
        setStats({
          totalProtocols: uniqueProtocolCount,
          totalReviews: protocols.length,
          overdueCount: overdue.length,
          completedCount: completed,
          inProgressCount: inProgress + partiallyCompleted,
          dueSoonCount: upcoming.length
        });
      } catch (err) {
        console.error("Error fetching dashboard data:", err);
        setError("Failed to load dashboard data");
      } finally {
        setLoading(false);
      }
    };
    
    fetchDashboardData();
  }, []);

  const getStatusBadge = (status: string, dueDate: string) => {
    if (status === 'Completed') {
      return <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded-full">Completed</span>;
    } else if (dueDate && dueDate.trim() !== '' && isOverdue(dueDate)) {
      return <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full">Overdue</span>;
    } else if (dueDate && dueDate.trim() !== '' && isDueSoon(dueDate)) {
      return <span className="bg-yellow-100 text-yellow-800 text-xs px-2 py-1 rounded-full">Due Soon</span>;
    } else if (status === 'Partially Completed') {
      return <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">Partially Completed</span>;
    } else {
      return <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full">In Progress</span>;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-md">
        <p className="font-bold">Error!</p>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Admin Dashboard</h1>
        <p className="text-gray-600">Welcome to the e-REC Administration Dashboard. Here you can monitor the status of all protocols and reviewer assignments.</p>
      </div>
      
      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <ProtocolStatusCard 
          title="Total Protocols" 
          count={stats.totalProtocols} 
          icon={
            <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          }
          color="blue"
        />
        <ProtocolStatusCard 
          title="Completed" 
          count={stats.completedCount} 
          icon={
            <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
          }
          color="green"
        />
        <ProtocolStatusCard 
          title="Overdue" 
          count={stats.overdueCount} 
          icon={
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          }
          color="red"
        />
        <ProtocolStatusCard 
          title="Due Soon" 
          count={stats.dueSoonCount} 
          icon={
            <svg className="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          }
          color="yellow"
        />
      </div>
      
      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        <Link href="/admin/protocols" className="bg-white p-6 rounded-lg shadow hover:shadow-md transition duration-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium">Manage Protocols</h3>
            <svg className="w-8 h-8 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
          </div>
          <p className="text-gray-600 text-sm">View and manage all protocols in the system. Track completion status and reviewer assignments.</p>
        </Link>
        
        <Link href="/admin/due-dates" className="bg-white p-6 rounded-lg shadow hover:shadow-md transition duration-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium">Due Date Tracking</h3>
            <svg className="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
            </svg>
          </div>
          <p className="text-gray-600 text-sm">Monitor due dates, manage overdue protocols, and reassign reviews when needed.</p>
        </Link>
        
        <Link href="/admin/csv-upload" className="bg-white p-6 rounded-lg shadow hover:shadow-md transition duration-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium">Upload Protocols</h3>
            <svg className="w-8 h-8 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
            </svg>
          </div>
          <p className="text-gray-600 text-sm">Upload CSV files to generate new protocol entries. Convert data to JSON format for storage.</p>
        </Link>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Overdue Protocols */}
        <div className="bg-white rounded-lg shadow-md">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">Overdue Protocols</h3>
            <Link 
              href="/admin/due-dates?filter=overdue" 
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              View All
            </Link>
          </div>
          <div className="p-4">
            {overdueProtocols.length > 0 ? (
              <ul className="divide-y divide-gray-200">
                {overdueProtocols.map((protocol) => (
                  <li key={protocol.id} className="py-3">
                    <div className="flex justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{protocol.protocol_name}</p>
                        <p className="text-xs text-gray-500">
                          Due: {formatDate(protocol.due_date)} · {protocol.release_period}
                        </p>
                      </div>
                      <div>
                        {getStatusBadge(protocol.status, protocol.due_date)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-center py-4 text-gray-500">No overdue protocols.</p>
            )}
          </div>
        </div>
        
        {/* Upcoming Due Protocols */}
        <div className="bg-white rounded-lg shadow-md">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">Due Soon</h3>
            <Link 
              href="/admin/due-dates?filter=due-soon" 
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              View All
            </Link>
          </div>
          <div className="p-4">
            {upcomingDueProtocols.length > 0 ? (
              <ul className="divide-y divide-gray-200">
                {upcomingDueProtocols.map((protocol) => (
                  <li key={protocol.id} className="py-3">
                    <div className="flex justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{protocol.protocol_name}</p>
                        <p className="text-xs text-gray-500">
                          Due: {formatDate(protocol.due_date)} · {protocol.release_period}
                        </p>
                      </div>
                      <div>
                        {getStatusBadge(protocol.status, protocol.due_date)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-center py-4 text-gray-500">No protocols due soon.</p>
            )}
          </div>
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-8">
        {/* Recent Protocols */}
        <div className="bg-white rounded-lg shadow-md">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h3 className="text-lg font-medium text-gray-900">Recently Added</h3>
            <Link href="/admin/protocols" className="text-blue-600 hover:text-blue-800 text-sm">
              View All
            </Link>
          </div>
          <div className="p-4">
            {recentProtocols.length > 0 ? (
              <ul className="divide-y divide-gray-200">
                {recentProtocols.map((protocol) => (
                  <li key={protocol.id} className="py-3">
                    <div className="flex justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{protocol.protocol_name}</p>
                        <p className="text-xs text-gray-500">
                          Added: {(() => {
                            try {
                              if (typeof protocol.created_at === 'string') {
                                return formatDate(protocol.created_at.split('T')[0]);
                              } else if (protocol.created_at) {
                                return formatDate(new Date(protocol.created_at).toISOString().split('T')[0]);
                              }
                              return 'Unknown date';
                            } catch (e) {
                              return 'Unknown date';
                            }
                          })()} · {protocol.release_period}
                        </p>
                      </div>
                      <div>
                        {getStatusBadge(protocol.status, protocol.due_date)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-center py-4 text-gray-500">No recent protocols.</p>
            )}
          </div>
        </div>
        
        {/* Top Reviewers */}
        <div className="bg-white rounded-lg shadow-md">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Top Reviewers</h3>
          </div>
          <div className="p-4">
            {reviewerStats.length > 0 ? (
              <ul className="divide-y divide-gray-200">
                {reviewerStats.map((reviewer, index) => (
                  <li key={index} className="py-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{reviewer.name}</p>
                        <p className="text-xs text-gray-500">
                          {reviewer.completed} completed of {reviewer.assigned} assigned
                        </p>
                      </div>
                      <div className="flex items-center">
                        {reviewer.overdue > 0 && (
                          <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full mr-2">
                            {reviewer.overdue} overdue
                          </span>
                        )}
                        <div className="w-16 bg-gray-200 rounded-full h-2.5">
                          <div 
                            className="bg-blue-600 h-2.5 rounded-full" 
                            style={{ width: `${reviewer.completed / reviewer.assigned * 100}%` }}
                          ></div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-center py-4 text-gray-500">No reviewer data available.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
