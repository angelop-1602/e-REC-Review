'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import { isOverdue, isDueSoon, formatDate, getFormTypeName } from '@/lib/utils';
import NoticeAlert from '@/components/NoticeAlert';

interface Protocol {
  id: string;
  protocol_name: string;
  release_period: string;
  academic_level: string;
  document_type: string;
  due_date: string;
  reviewer: string;
  reviewers?: { 
    id: string;
    name: string;
    status: string;
    document_type: string;
  }[];
  status: string;
  protocol_file: string;
  created_at: any;
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

  // Get status counts
  const statusCounts = {
    total: protocols.length,
    completed: protocols.filter(p => {
      // If using the reviewers array, check this reviewer's status
      if (p.reviewers && reviewerId) {
        const thisReviewer = p.reviewers.find(r => r.id === reviewerId);
        return thisReviewer && thisReviewer.status === 'Completed';
      }
      // Otherwise use protocol's status
      return p.status === 'Completed';
    }).length,
    inProgress: protocols.filter(p => {
      // If using the reviewers array, check this reviewer's status
      if (p.reviewers && reviewerId) {
        const thisReviewer = p.reviewers.find(r => r.id === reviewerId);
        return thisReviewer && thisReviewer.status === 'In Progress';
      }
      // Otherwise use protocol's status
      return p.status === 'In Progress';
    }).length,
    overdue: protocols.filter(p => p.due_date && isOverdue(p.due_date) && p.status !== 'Completed').length,
    dueSoon: protocols.filter(p => p.due_date && isDueSoon(p.due_date) && p.status !== 'Completed').length,
  };

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
      const reviewer = protocol.reviewers.find(r => r.id === reviewerId);
      return reviewer?.status || 'In Progress';
    }
    return protocol.status;
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
                You don't have any protocols assigned yet.
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
              .sort(([releaseA], [releaseB]) => releaseA.localeCompare(releaseB))
              .map(([releasePeriod, protocolsInRelease]) => (
                <div key={releasePeriod} className="bg-white rounded-lg shadow-md overflow-hidden">
                  <div className="bg-gray-100 px-6 py-4">
                    <h3 className="text-xl font-semibold">{releasePeriod}</h3>
                    <p className="text-sm text-gray-600">{protocolsInRelease.length} protocols</p>
            </div>
            
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                    {protocolsInRelease.map((protocol) => {
                      const reviewerStatus = getReviewerStatus(protocol);
                      const isCompleted = reviewerStatus === 'Completed';
                      const isOverdueProtocol = protocol.due_date && isOverdue(protocol.due_date) && !isCompleted;
                      const isDueSoonProtocol = protocol.due_date && isDueSoon(protocol.due_date) && !isCompleted;
                      
                      return (
                        <div 
                          key={protocol.id} 
                          className={`border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow ${
                            isCompleted ? 'border-green-200' : 
                            isOverdueProtocol ? 'border-red-200' : 
                            isDueSoonProtocol ? 'border-yellow-200' : 
                            'border-gray-200'
                          }`}
                        >
                          <div className={`px-4 py-3 ${
                            isCompleted ? 'bg-green-50' : 
                            isOverdueProtocol ? 'bg-red-50' : 
                            isDueSoonProtocol ? 'bg-yellow-50' : 
                            'bg-gray-50'
                          }`}>
                            <h4 className="font-medium truncate" title={protocol.protocol_name}>
                              {protocol.protocol_name}
                            </h4>
                              </div>
                          
                          <div className="p-4">
                            <p className="text-sm text-gray-600 mb-1">
                              <span className="font-medium">Form Type:</span> {getFormTypeName(getReviewerDocumentType(protocol))}
                            </p>
                            <p className="text-sm text-gray-600 mb-3">
                              <span className="font-medium">Academic Level:</span> {protocol.academic_level || 'N/A'}
                            </p>
                            
                            {protocol.due_date && (
                              <p className={`text-sm mb-3 ${
                                isOverdueProtocol ? 'text-red-600 font-medium' : 
                                isDueSoonProtocol ? 'text-yellow-600 font-medium' : 
                                'text-gray-600'
                              }`}>
                                <span className="font-medium">Due:</span> {formatDate(protocol.due_date)}
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
                              </p>
                            )}
                            
                            <div className="flex justify-between items-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                                isCompleted ? 'bg-green-100 text-green-800' : 
                                'bg-blue-100 text-blue-800'
                              }`}>
                                {isCompleted ? 'Completed' : 'In Progress'}
                              </span>
                              
                              <Link
                                href={`/reviewer/protocols/${protocol.id}`}
                                className="text-sm font-medium text-blue-600 hover:text-blue-800"
                              >
                                View Details
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
              )}
          </div>
        )}
    </div>
  );
} 