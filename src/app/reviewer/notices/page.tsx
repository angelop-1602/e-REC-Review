'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { useState, useEffect } from 'react';
import { collection, getDocs, query, where, Timestamp, QueryConstraint, doc, updateDoc, arrayUnion, arrayRemove, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';
import { format } from 'date-fns';
import SystemNotice from '@/components/SystemNotice';

interface Notice {
  id: string;
  title: string;
  content: string;
  priority: 'none' | 'low' | 'medium' | 'high';
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
  const [showMigrationNotice, setShowMigrationNotice] = useState(true);

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

        // Include both non-expired notices and notices with no expiration (null)
        const noticesQuery = query(
          collection(db, 'notices')
        );

        const querySnapshot = await getDocs(noticesQuery);

        const fetchedNotices: Notice[] = [];
        querySnapshot.forEach((doc) => {
          const noticeData = doc.data();
          
          // Add notice if it has no expiration date or if it hasn't expired yet
          if (!noticeData.expires_at || 
              (noticeData.expires_at && noticeData.expires_at.toDate() > currentDate)) {
            fetchedNotices.push({
              id: doc.id,
              ...noticeData
            } as Notice);
          }
        });

        // Sort notices client-side instead of in the query
        // First by priority (high, medium, low)
        // Then by expiration date (ascending)
        const sortedNotices = fetchedNotices.sort((a, b) => {
          // Priority sort (high to low)
          const priorityOrder = { high: 0, medium: 1, low: 2, none: 3 };
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
        return 'bg-red-50 border-l-4 border-red-500 text-red-800';
      case 'medium':
        return 'bg-orange-50 border-l-4 border-orange-500 text-orange-800';
      case 'low':
        return 'bg-blue-50 border-l-4 border-blue-500 text-blue-800';
      default:
        return 'bg-gray-50 border-l-4 border-gray-300 text-gray-800';
    }
  };

  const getPriorityBadgeColor = (priority: string) => {
    switch (priority) {
      case 'high':
        return 'bg-red-500 text-white';
      case 'medium':
        return 'bg-orange-500 text-white';
      case 'low':
        return 'bg-blue-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  const extractIndexLink = (errorMessage: string) => {
    // Extract URL from error message
    const urlMatch = errorMessage.match(/(https:\/\/console\.firebase\.google\.com\/[^\s]+)/);
    return urlMatch ? urlMatch[1] : null;
  };

  const formatDateNice = (timestamp: any) => {
    if (!timestamp || !timestamp.toDate) return 'Never expires';
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
    <div className="p-2 sm:p-4 md:p-6 space-y-4 sm:space-y-6 max-w-5xl mx-auto">
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between border-b pb-2 text-brand-green-700">
        <h1 className="text-xl sm:text-2xl font-semibold">Notices & Announcements</h1>
        <Link
          href="/reviewer/dashboard"
          className="mt-2 sm:mt-0 text-sm text-blue-600 hover:text-blue-800 flex items-center"
        >
          ← Return to Dashboard
        </Link>
      </div>

      {/* System Notices */}
      <SystemNotice />

      {indexError && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mb-4">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <p className="text-sm text-yellow-700">
                Missing index error. This can be fixed by an administrator.
                {extractIndexLink(indexError) && (
                  <a
                    href={extractIndexLink(indexError)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline text-yellow-700 hover:text-yellow-600"
                  >
                    Create Index
                  </a>
                )}
              </p>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-10">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-brand-green-500"></div>
          <p className="mt-2 text-gray-500">Loading notices...</p>
        </div>
      ) : error ? (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-4">
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
      ) : notices.length === 0 ? (
        <div className="text-center py-10">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          <p className="mt-2 text-gray-500">No active notices at this time.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {notices.map((notice) => (
            <div
              key={notice.id}
              className="bg-white rounded-xl shadow-lg overflow-hidden transition-all duration-300 hover:shadow-xl"
            >
              <div className={`p-6 ${getPriorityColor(notice.priority)} border-b border-opacity-10`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between">
                  <div className="flex items-center">
                    <h2 className="text-xl font-semibold">{notice.title}</h2>
                  </div>
                  <div className="mt-2 sm:mt-0 text-sm">
                    <span className="text-gray-600">
                      {notice.expires_at ? `Expires: ${formatDateNice(notice.expires_at)}` : 'Never expires'}
                    </span>
                  </div>
                </div>
              </div>

              <div className="p-6">
                <div className="prose prose-sm sm:prose max-w-none">
                  {notice.content.split('\n').map((paragraph, idx) => (
                    <p key={idx} className="text-gray-700">{paragraph}</p>
                  ))}
                </div>

                <div className="mt-6 pt-4 border-t border-gray-100 flex flex-wrap items-center justify-between">
                  <div className="text-sm text-gray-500 flex items-center space-x-2">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Posted: {formatDateNice(notice.created_at)}</span>
                  </div>
                  
                  <button
                    onClick={() => handleLikeToggle(notice.id)}
                    disabled={likesLoading[notice.id]}
                    className={`flex items-center space-x-2 px-4 py-2 rounded-full transition-colors duration-200 ${
                      likedNotices[notice.id]
                        ? 'text-blue-600 bg-blue-50 hover:bg-blue-100'
                        : 'text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    {likesLoading[notice.id] ? (
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500 border-r-transparent"></div>
                    ) : (
                      <svg 
                        className={`h-5 w-5 ${likedNotices[notice.id] ? 'fill-current' : 'stroke-current fill-none'}`} 
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                      </svg>
                    )}
                    <span className="font-medium">{getLikesCount(notice)} {getLikesCount(notice) === 1 ? 'Like' : 'Likes'}</span>
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