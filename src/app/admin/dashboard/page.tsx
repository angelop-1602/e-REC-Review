'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, collectionGroup } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import { isOverdue, isDueSoon, formatDate } from '@/lib/utils';
import ProtocolStatusCard from '@/components/ProtocolStatusCard';
import dynamic from 'next/dynamic';

// Dynamically import Chart.js to avoid SSR issues
const Chart = dynamic(
  () => import('react-chartjs-2').then((mod) => mod.Bar),
  { ssr: false }
);

// Dynamically import Chart.js registry
const ChartRegistry = dynamic(
  () => import('@/components/ChartRegistry'),
  { ssr: false }
);

interface Reviewer {
  id: string;
  name: string;
  status: string;
  document_type?: string;
  form_type?: string;
  due_date?: string;
  completed_at?: string;
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
  research_title?: string;
  e_link?: string;
  course_program?: string;
  spup_rec_code?: string;
  principal_investigator?: string;
  adviser?: string;
  _path?: string;
}

export default function AdminDashboard() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, setOverdueProtocols] = useState<Protocol[]>([]);
  const [upcomingDueProtocols, setUpcomingDueProtocols] = useState<Protocol[]>([]);
  const [recentProtocols, setRecentProtocols] = useState<Protocol[]>([]);
  const [overdueReviewers, setOverdueReviewers] = useState<{
    protocolId: string;
    spupRecCode: string;
    reviewerId: string;
    reviewerName: string;
    dueDate: string;
    protocolPath?: string;
  }[]>([]);
  const [, setReviewerStats] = useState<{
    reviewerId: string;
    name: string;
    assigned: number;
    completed: number;
    overdue: number;
  }[]>([]);
  const [fastestReviewers, setFastestReviewers] = useState<{
    reviewerId: string;
    name: string;
    averageCompletionDays: number;
    completedCount: number;
  }[]>([]);
  const [stats, setStats] = useState({
    totalProtocols: 0,
    totalReviews: 0,
    overdueCount: 0,
    completedCount: 0,
    inProgressCount: 0,
    dueSoonCount: 0
  });
  const [chartData, setChartData] = useState<{
    labels: string[];
    datasets: {
      label: string;
      data: number[];
      backgroundColor: string;
    }[];
  }>({
    labels: [],
    datasets: []
  });
  
  // Helper function to ensure due dates are in the correct format
  const ensureValidDueDate = (dueDate: string | Date | { toDate(): Date } | undefined): string => {
    if (!dueDate) return '';
    
    // If it's already a string in YYYY-MM-DD format, return it
    if (typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      return dueDate;
    }
    
    // If it's a timestamp object from Firestore
    if (dueDate && typeof dueDate === 'object' && 'toDate' in dueDate) {
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
    const fetchDashboardData = async () => {
      try {
        setLoading(true);
        
        // Initialize array to hold all protocols
        const protocols: Protocol[] = [];
        
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
              
              protocols.push(mappedProtocol);
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
                  
                  protocols.push(mappedProtocol);
                }
              }
            } catch (err) {
              console.error(`Error fetching protocols for month ${monthId}:`, err);
              // Continue with other months even if one fails
            }
          }
        }
        
        console.log(`Fetched a total of ${protocols.length} protocols.`);
        
        // Group protocols by protocol_name
        const protocolGroups = protocols.reduce((acc, protocol) => {
          const key = protocol.protocol_name || 'Unknown';
          if (!acc[key]) {
            acc[key] = [];
          }
          acc[key].push(protocol);
          return acc;
        }, {} as Record<string, Protocol[]>);
        
        // Create a grouped version of protocols (one entry per protocol_name)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const groupedProtocols = Object.entries(protocolGroups).map(([_, items]) => {
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
        
        // Prepare chart data for completion status by release period
        const releaseStats = new Map<string, { completed: number, inProgress: number }>();
        
        groupedProtocols.forEach(protocol => {
          if (!protocol.release_period) return;
          
          const stats = releaseStats.get(protocol.release_period) || { completed: 0, inProgress: 0 };
          
          if (protocol.status === 'Completed') {
            stats.completed++;
          } else {
            stats.inProgress++;
          }
          
          releaseStats.set(protocol.release_period, stats);
        });
        
        // Convert to chart format - sort by release period
        const sortedReleases = Array.from(releaseStats.keys()).sort((a, b) => {
          // Sort first/second/third/fourth releases first
          const orderMap: {[key: string]: number} = {
            'First Release': 1, 'Second Release': 2, 'Third Release': 3, 'Fourth Release': 4
          };
          
          const aOrder = orderMap[a] || 99;
          const bOrder = orderMap[b] || 99;
          
          if (aOrder !== bOrder) return aOrder - bOrder;
          
          // Then sort by month for monthly releases
          return a.localeCompare(b);
        });
        
        const completedData = sortedReleases.map(release => releaseStats.get(release)?.completed || 0);
        const inProgressData = sortedReleases.map(release => releaseStats.get(release)?.inProgress || 0);
        
        setChartData({
          labels: sortedReleases,
          datasets: [
            {
              label: 'Completed',
              data: completedData,
              backgroundColor: 'rgba(34, 197, 94, 0.7)'
            },
            {
              label: 'In Progress',
              data: inProgressData,
              backgroundColor: 'rgba(59, 130, 246, 0.7)'
            }
          ]
        });
        
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
        
        // Extract overdue reviewers from all protocols
        const extractedOverdueReviewers: {
          protocolId: string;
          spupRecCode: string;
          reviewerId: string;
          reviewerName: string;
          dueDate: string;
          protocolPath?: string;
        }[] = [];
        
        // Collect data for calculating fastest reviewers
        const reviewerCompletionTimes: Record<string, {
          reviewerId: string,
          name: string,
          completionTimes: number[],  // Time in days
          completedCount: number
        }> = {};
        
        protocols.forEach(protocol => {
          if (protocol.reviewers && protocol.reviewers.length > 0) {
            protocol.reviewers.forEach(reviewer => {
              // Process overdue reviewers
              const reviewerDueDate = ensureValidDueDate(reviewer.due_date || '');
              if (reviewer.status !== 'Completed' && reviewerDueDate && isOverdue(reviewerDueDate)) {
                extractedOverdueReviewers.push({
                  protocolId: protocol.id,
                  spupRecCode: protocol.spup_rec_code || protocol.id,
                  reviewerId: reviewer.id,
                  reviewerName: reviewer.name,
                  dueDate: reviewerDueDate,
                  protocolPath: protocol._path
                });
              }
              
              // Process completed reviews for speed calculation
              if (reviewer.status === 'Completed' && reviewer.completed_at && reviewer.due_date) {
                const dueDate = new Date(ensureValidDueDate(reviewer.due_date));
                const completedDate = new Date(reviewer.completed_at);
                
                // Skip invalid dates
                if (isNaN(dueDate.getTime()) || isNaN(completedDate.getTime())) {
                  return;
                }
                
                // Get days between assignment and completion
                // If completed before due date, this will be negative (good)
                // If completed after due date, this will be positive (not good)
                const daysDifference = (completedDate.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24);
                
                // Store the reviewer's completion time
                if (!reviewerCompletionTimes[reviewer.id]) {
                  reviewerCompletionTimes[reviewer.id] = {
                    reviewerId: reviewer.id,
                    name: reviewer.name,
                    completionTimes: [],
                    completedCount: 0
                  };
                }
                
                reviewerCompletionTimes[reviewer.id].completionTimes.push(daysDifference);
                reviewerCompletionTimes[reviewer.id].completedCount++;
              }
            });
          }
        });
        
        // Sort by due date (oldest first)
        extractedOverdueReviewers.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
        setOverdueReviewers(extractedOverdueReviewers);
        
        // Calculate average completion times and find fastest reviewers
        const fastestReviewersArray = Object.values(reviewerCompletionTimes)
          .filter(reviewer => reviewer.completedCount >= 3) // Only include reviewers with at least 3 completed reviews
          .map(reviewer => ({
            reviewerId: reviewer.reviewerId,
            name: reviewer.name,
            averageCompletionDays: reviewer.completionTimes.reduce((sum, time) => sum + time, 0) / reviewer.completionTimes.length,
            completedCount: reviewer.completedCount
          }))
          .sort((a, b) => a.averageCompletionDays - b.averageCompletionDays) // Sort by average time (ascending)
          .slice(0, 5); // Get top 5
        
        setFastestReviewers(fastestReviewersArray);
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
            <h3 className="text-lg font-medium text-gray-900">Overdue Reviewers</h3>
            <Link 
              href="/admin/due-dates?filter=overdue" 
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              View All
            </Link>
          </div>
          <div className="p-4">
            {overdueReviewers.length > 0 ? (
              <ul className="divide-y divide-gray-200">
                {overdueReviewers.slice(0, 5).map((item, index) => (
                  <li key={index} className="py-3">
                    <div className="flex justify-between">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {item.spupRecCode}
                        </p>
                        <p className="text-xs text-gray-500">
                          Reviewer: <span className="font-medium">{item.reviewerName}</span>
                        </p>
                        <p className="text-xs text-gray-500">
                          Due: {formatDate(item.dueDate)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded-full mb-2">Overdue</span>
                        <Link 
                          href={`/admin/protocols/${item.protocolId}/reviewer/${item.reviewerName}/reassign`}
                          className="text-blue-600 hover:text-blue-800 text-xs"
                        >
                          Reassign
                        </Link>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-center py-4 text-gray-500">No overdue reviewers.</p>
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
                        <p className="text-sm font-medium text-gray-900">
                          {protocol.spup_rec_code || protocol.id}
                        </p>
                        <p className="text-xs text-gray-500">
                          {protocol.principal_investigator || 'No Principal Investigator'}
                        </p>
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
                        <p className="text-sm font-medium text-gray-900">
                          {protocol.spup_rec_code || protocol.id}
                        </p>
                        <p className="text-xs text-gray-500">
                          {protocol.principal_investigator || 'No Principal Investigator'}
                        </p>
                        <p className="text-xs text-gray-500">
                          Added: {(() => {
                            try {
                              if (typeof protocol.created_at === 'string') {
                                return formatDate(protocol.created_at.split('T')[0]);
                              } else if (protocol.created_at) {
                                return formatDate(new Date(protocol.created_at).toISOString().split('T')[0]);
                              }
                              return 'Unknown date';
                            } catch {
                              return 'Unknown date';
                            }
                          })()} · {protocol.release_period}
                        </p>
                      </div>
                      <div>
                        {getStatusBadge(protocol.status, getLatestDueDate(protocol))}
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
        
        {/* Fastest Reviewers */}
        <div className="bg-white rounded-lg shadow-md">
          <div className="px-6 py-4 border-b border-gray-200">
            <h3 className="text-lg font-medium text-gray-900">Fastest Reviewers</h3>
          </div>
          <div className="p-4">
            {fastestReviewers.length > 0 ? (
              <ul className="divide-y divide-gray-200">
                {fastestReviewers.map((reviewer, index) => (
                  <li key={index} className="py-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{reviewer.name}</p>
                        <p className="text-xs text-gray-500">
                          {reviewer.completedCount} reviews completed
                        </p>
                      </div>
                      <div className="flex items-center">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          reviewer.averageCompletionDays <= 0 
                            ? 'bg-green-100 text-green-800' 
                            : reviewer.averageCompletionDays <= 2
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {reviewer.averageCompletionDays <= 0 
                            ? `${Math.abs(reviewer.averageCompletionDays).toFixed(1)} days early`
                            : `${reviewer.averageCompletionDays.toFixed(1)} days to complete`}
                        </span>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-center py-4 text-gray-500">No reviewer completion data available.</p>
            )}
          </div>
        </div>
      </div>
      
      {/* Add Completion Chart by Release Period */}
      <div className="bg-white rounded-lg shadow p-6 my-8">
        <h2 className="text-xl font-bold mb-4">Protocol Completion by Release Period</h2>
        
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        ) : error ? (
          <div className="text-red-500 text-center">{error}</div>
        ) : chartData.labels.length === 0 ? (
          <div className="text-gray-500 text-center py-8">No data available for chart</div>
        ) : (
          <div className="h-80">
            <ChartRegistry />
            <Chart
              data={chartData}
              options={{
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                  x: {
                    stacked: true,
                    title: {
                      display: true,
                      text: 'Release Period'
                    }
                  },
                  y: {
                    stacked: true,
                    title: {
                      display: true,
                      text: 'Number of Protocols'
                    },
                    ticks: {
                      precision: 0
                    }
                  }
                },
                plugins: {
                  legend: {
                    position: 'top'
                  },
                  tooltip: {
                    callbacks: {
                      title: (tooltipItems) => {
                        return tooltipItems[0].label;
                      }
                    }
                  }
                }
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
