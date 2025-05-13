import React, { useState, useEffect } from 'react';
import { collection, getDocs, query, where, orderBy, Timestamp } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { COLORS, STYLES } from '@/lib/colors';

interface SystemNotice {
  id: string;
  title: string;
  subtitle: string;
  message: string;
  keyPoints: string[];
  actionButton?: {
    text: string;
    href: string;
  };
  noticeNumber: number;
  created_at: Timestamp;
  expires_at: Timestamp;
}

export default function SystemNotice() {
  const [notices, setNotices] = useState<SystemNotice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchSystemNotices = async () => {
      try {
        setLoading(true);
        const currentDate = new Date();
        
        const noticesQuery = query(
          collection(db, 'system_notices'),
          where('expires_at', '>', Timestamp.fromDate(currentDate)),
          orderBy('expires_at', 'asc')
        );

        const querySnapshot = await getDocs(noticesQuery);
        const fetchedNotices: SystemNotice[] = [];
        
        querySnapshot.forEach((doc) => {
          fetchedNotices.push({
            id: doc.id,
            ...doc.data()
          } as SystemNotice);
        });

        setNotices(fetchedNotices);
      } catch (err) {
        console.error('Error fetching system notices:', err);
        setError('Failed to load system notices');
      } finally {
        setLoading(false);
      }
    };

    fetchSystemNotices();
  }, []);

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-lg overflow-hidden mb-6 animate-pulse">
        <div className="p-6 border-b border-gray-200">
          <div className="h-6 bg-gray-200 rounded w-3/4 mx-auto"></div>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
            <div className="h-4 bg-gray-200 rounded w-full"></div>
            <div className="h-4 bg-gray-200 rounded w-2/3"></div>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-6">
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
    );
  }

  if (notices.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-xl overflow-hidden mb-6 transition-all duration-300 hover:shadow-2xl">
      <div style={{ background: `linear-gradient(to right, ${COLORS.brand.green[700]}, ${COLORS.brand.green[600]})` }} className="p-6 border-b border-gray-200">
        <h2 className="text-2xl font-bold text-center text-white">
          Important Update from the REC Chair
        </h2>
      </div>

      {notices.map((notice) => (
        <div key={notice.id} className="p-6">
          <div className="bg-red-50 rounded-xl p-6 border border-red-100 shadow-inner">
            <div className="flex items-start space-x-3 mb-6">
              <div className="flex-shrink-0 bg-red-100 rounded-full p-2">
                <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-gray-900 flex items-center">
                  Important Notice #{notice.noticeNumber}
                  <span className="ml-2 text-sm font-normal text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                    New
                  </span>
                </h3>
              </div>
            </div>

            <div className="space-y-6">
              <div>
                <h4 className="text-lg font-semibold text-gray-900 mb-3">{notice.title}</h4>
                <div className="prose prose-sm max-w-none text-gray-700">
                  {notice.message.split('\n').map((paragraph, idx) => (
                    <p key={idx} className="mb-2">{paragraph}</p>
                  ))}
                </div>
              </div>

              {notice.actionButton && (
                <div className="flex justify-start">
                  <a
                    href={notice.actionButton.href}
                    style={STYLES.brandGreenButton}
                    className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-all duration-200 transform hover:-translate-y-0.5"
                  >
                    {notice.actionButton.text}
                    <svg className="ml-2 -mr-1 h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </a>
                </div>
              )}

              {notice.keyPoints && notice.keyPoints.length > 0 && (
                <div className="bg-white bg-opacity-50 rounded-lg p-6">
                  <h5 className="text-lg font-semibold text-gray-900 mb-4">Key Points:</h5>
                  <ul className="space-y-3">
                    {notice.keyPoints.map((point, idx) => (
                      <li key={idx} className="flex items-start">
                        <svg style={{ color: COLORS.brand.green.DEFAULT }} className="h-5 w-5 mr-2 mt-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-gray-700">{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
} 