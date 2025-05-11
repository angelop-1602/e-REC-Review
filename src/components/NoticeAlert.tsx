'use client';

import { useState, useEffect } from 'react';
import { collection, query, where, getDocs, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import Link from 'next/link';

interface NoticeAlertProps {
  userType: 'admin' | 'reviewer';
}

export default function NoticeAlert({ userType }: NoticeAlertProps) {
  const [noticeCount, setNoticeCount] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const fetchNoticeCount = async () => {
      try {
        // Get current date for filtering out expired notices
        const currentDate = new Date();
        const sevenDaysAgo = new Date(currentDate.getTime() - 7 * 24 * 60 * 60 * 1000);

        // Use a simpler query with only one where clause to avoid requiring composite index
        const noticesQuery = query(
          collection(db, 'notices'),
          where('expires_at', '>', Timestamp.fromDate(currentDate))
        );

        const querySnapshot = await getDocs(noticesQuery);

        // Filter on the client side for notices created in the last 7 days
        const recentNotices = querySnapshot.docs.filter(doc => {
          const data = doc.data();
          return data.created_at &&
            data.created_at.toDate() > sevenDaysAgo;
        });

        setNoticeCount(recentNotices.length);
      } catch (err) {
        console.error('Error fetching notice count:', err);
        // Just silently fail - no notice count will be shown
      } finally {
        setLoading(false);
      }
    };

    fetchNoticeCount();
  }, []);

  if (loading || noticeCount === 0) {
    return null;
  }

  const noticePath = userType === 'admin' ? '/admin/notices' : '/reviewer/notices';

  return (
    <Link
  href={noticePath}
  className="relative inline-block hover:opacity-80 transition-opacity"
  aria-label={`${noticeCount} new notice${noticeCount > 1 ? 's' : ''}`}
>
  {/* Bell Icon */}
  <svg
    xmlns="http://www.w3.org/2000/svg"
    className="h-6 w-6 text-[#036635]"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
    />
  </svg>

  {/* Badge */}
  {noticeCount > 0 && (
    <span
      className="
        absolute -top-1 -right-1 
        flex items-center justify-center 
        bg-[#FECC07] text-[#036635] 
        text-xs font-bold 
        rounded-full 
        h-5 w-5
      "
    >
      {noticeCount}
    </span>
  )}
</Link>

  );
} 