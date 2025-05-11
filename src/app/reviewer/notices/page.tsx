'use client';

import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy, Timestamp, QueryConstraint, doc, updateDoc, arrayUnion, arrayRemove, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import { format } from 'date-fns';

interface Notice {
  id: string;
  title: string;
  content: string;
  priority: 'low' | 'medium' | 'high';
  created_at: any;
  expires_at: any;
  likes?: string[]; // Array of reviewer IDs who liked this notice
}

export default function ReviewerNoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [reviewerId, setReviewerId] = useState<string | null>(null);
  const [likedNotices, setLikedNotices] = useState<Record<string, boolean>>({});
  const [likesLoading, setLikesLoading] = useState<Record<string, boolean>>({});
  
  useEffect(() => {
    // Get reviewer ID from localStorage
    const id = localStorage.getItem('reviewerId');
    if (id) {
      setReviewerId(id);
    }
    
    const fetchNotices = async () => {
      try {
        setLoading(true);
        
        // Get current date for filtering out expired notices
        const currentDate = new Date();
        
        // Create a simpler query that doesn't require composite indexing
        // Only filter by expiration date
        const constraints: QueryConstraint[] = [
          where('expires_at', '>', Timestamp.fromDate(currentDate))
        ];
        
        const noticesQuery = query(
          collection(db, 'notices'),
          ...constraints
        );
        
        const querySnapshot = await getDocs(noticesQuery);
        
        const fetchedNotices: Notice[] = [];
        querySnapshot.forEach((doc) => {
          fetchedNotices.push({
            id: doc.id,
            ...doc.data()
          } as Notice);
        });
        
        // Sort notices client-side instead of in the query
        // First by priority (high, medium, low)
        // Then by expiration date (ascending)
        const sortedNotices = fetchedNotices.sort((a, b) => {
          // Priority sort (high to low)
          const priorityOrder = { high: 0, medium: 1, low: 2 };
          const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
          
          if (priorityDiff !== 0) return priorityDiff;
          
          // Then by expiration date (ascending)
          if (a.expires_at && b.expires_at) {
            return a.expires_at.toDate().getTime() - b.expires_at.toDate().getTime();
          }
          return 0;
        });
        
        setNotices(sortedNotices);
        
        // Initialize liked status for each notice
        const initialLikedStatus: Record<string, boolean> = {};
        sortedNotices.forEach(notice => {
          initialLikedStatus[notice.id] = notice.likes?.includes(id || '') || false;
        });
        setLikedNotices(initialLikedStatus);
      } catch (err: any) {
        console.error('Error fetching notices:', err);
        
        // Check if it's a missing index error
        if (err.name === 'FirebaseError' && err.message && err.message.includes('index')) {
          setIndexError(err.message);
        } else {
          setError('Failed to load notices');
        }
      } finally {
        setLoading(false);
      }
    };
    
    fetchNotices();
  }, []);
  
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-50 border-red-300 text-red-700';
      case 'medium':
        return 'bg-brand-yellow-50 border-brand-yellow-300 text-brand-yellow-700';
      default:
        return 'bg-brand-green-50 border-brand-green-300 text-brand-green-700';
    }
  };
  
  const getPriorityBadgeColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-100 text-red-800';
      case 'medium':
        return 'bg-brand-yellow-100 text-brand-yellow-700';
      default:
        return 'bg-brand-green-100 text-brand-green-700';
    }
  };
  
  const extractIndexLink = (errorMessage: string) => {
    // Extract URL from error message
    const urlMatch = errorMessage.match(/(https:\/\/console\.firebase\.google\.com\/[^\s]+)/);
    return urlMatch ? urlMatch[1] : null;
  };
  
  const formatDateNice = (timestamp: any) => {
    if (!timestamp || !timestamp.toDate) return 'Unknown';
    const date = timestamp.toDate();
    return format(date, 'MMM d, yyyy');
  };
  
  const getLikesCount = (notice: Notice) => {
    return notice.likes?.length || 0;
  };
  
  const handleLikeToggle = async (noticeId: string) => {
    if (!reviewerId) {
      alert('You must be logged in to like notices');
      return;
    }
    
    // Set loading state for this specific notice
    setLikesLoading(prev => ({ ...prev, [noticeId]: true }));
    
    try {
      const noticeRef = doc(db, 'notices', noticeId);
      const noticeDoc = await getDoc(noticeRef);
      
      if (!noticeDoc.exists()) {
        throw new Error('Notice not found');
      }
      
      const noticeData = noticeDoc.data();
      const isLiked = likedNotices[noticeId];
      
      // Update Firestore
      await updateDoc(noticeRef, {
        likes: isLiked ? arrayRemove(reviewerId) : arrayUnion(reviewerId)
      });
      
      // Update local state
      setLikedNotices(prev => ({
        ...prev,
        [noticeId]: !isLiked
      }));
      
      // Update likes count in notices array
      setNotices(prev => prev.map(notice => {
        if (notice.id === noticeId) {
          const currentLikes = notice.likes || [];
          const updatedLikes = isLiked
            ? currentLikes.filter(id => id !== reviewerId)
            : [...currentLikes, reviewerId];
          
          return {
            ...notice,
            likes: updatedLikes
          };
        }
        return notice;
      }));
      
    } catch (err) {
      console.error('Error toggling like:', err);
      alert('Failed to update like status');
    } finally {
      setLikesLoading(prev => ({ ...prev, [noticeId]: false }));
    }
  };
  
  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold border-b pb-2 text-brand-green-700">Important Notices</h1>
      
      {loading ? (
        <div className="p-4 text-center">
          <p>Loading notices...</p>
        </div>
      ) : indexError ? (
        <div className="p-6 bg-brand-yellow-50 text-brand-yellow-800 rounded-lg border border-brand-yellow-300">
          <h3 className="font-medium text-lg mb-2">Database Index Required</h3>
          <p className="mb-4">The database needs an index created to show notices properly. Please inform the administrator.</p>
          {extractIndexLink(indexError) && (
            <div className="text-sm bg-white p-3 rounded border border-brand-yellow-200 overflow-auto">
              <p>Admin: Create the index by clicking this link:</p>
              <a 
                href={extractIndexLink(indexError) || '#'} 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-brand-green hover:underline break-all"
              >
                {extractIndexLink(indexError)}
              </a>
            </div>
          )}
        </div>
      ) : error ? (
        <div className="p-4 bg-red-100 text-red-800 rounded">
          {error}
        </div>
      ) : notices.length === 0 ? (
        <div className="p-6 bg-white rounded-lg shadow-md text-center">
          <p className="text-gray-500">No important notices at this time.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {notices.map((notice) => (
            <div 
              key={notice.id} 
              className={`bg-white overflow-hidden rounded-lg shadow-md hover:shadow-lg transition-all duration-300 border-l-4 ${getPriorityColor(notice.priority)}`}
            >
              <div className="p-5">
                <div className="flex justify-between items-start mb-3">
                  <h2 className="text-xl font-bold text-brand-green-700">{notice.title}</h2>
                  <span className={`px-3 py-1 text-xs font-semibold rounded-full ${getPriorityBadgeColor(notice.priority)}`}>
                    {notice.priority === 'high' ? 'Important' : notice.priority.charAt(0).toUpperCase() + notice.priority.slice(1)}
                  </span>
                </div>
                
                <div className="flex items-center text-sm text-gray-500 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-brand-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  <span>Posted: {formatDateNice(notice.created_at)}</span>
                  
                  <span className="mx-2">•</span>
                  
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-brand-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>Expires: {formatDateNice(notice.expires_at)}</span>
                </div>
                
                <div className="prose prose-sm max-w-none mb-4">
                  <p className="whitespace-pre-line text-gray-700">{notice.content}</p>
                </div>
                
                <div className="flex justify-end items-center pt-3 mt-3 border-t border-gray-100">
                  <button
                    onClick={() => handleLikeToggle(notice.id)}
                    disabled={likesLoading[notice.id]}
                    className={`flex items-center space-x-1 px-3 py-1.5 rounded-full text-sm transition-colors ${
                      likedNotices[notice.id]
                        ? 'bg-brand-yellow-100 text-brand-yellow-700 hover:bg-brand-yellow-200'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    <svg 
                      xmlns="http://www.w3.org/2000/svg" 
                      className={`h-4 w-4 ${likedNotices[notice.id] ? 'fill-brand-yellow-500' : 'fill-none'}`} 
                      viewBox="0 0 24 24" 
                      stroke="currentColor"
                    >
                      <path 
                        strokeLinecap="round" 
                        strokeLinejoin="round" 
                        strokeWidth={likedNotices[notice.id] ? 0 : 2}
                        d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" 
                      />
                    </svg>
                    <span>{likesLoading[notice.id] ? '...' : getLikesCount(notice)}</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 