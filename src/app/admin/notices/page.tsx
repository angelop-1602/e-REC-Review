'use client';

import { useState, useEffect } from 'react';
import { collection, addDoc, getDocs, query, orderBy, doc, deleteDoc, Timestamp, updateDoc, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebaseconfig';
import { format } from 'date-fns';
import { COLORS, STYLES } from '@/lib/colors';

interface Notice {
  id: string;
  title: string;
  content: string;
  priority: 'none' | 'low' | 'medium' | 'high';
  created_at: Timestamp;
  expires_at: Timestamp;
  likes?: string[]; // Array of reviewer IDs who liked this notice
}

interface NoticeStats {
  totalNotices: number;
  activeNotices: number;
  totalLikes: number;
  highPriorityCount: number;
  mostLikedNotice: Notice | null;
  averageLikesPerNotice: number;
}

export default function AdminNoticesPage() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [stats, setStats] = useState<NoticeStats>({
    totalNotices: 0,
    activeNotices: 0,
    totalLikes: 0,
    highPriorityCount: 0,
    mostLikedNotice: null,
    averageLikesPerNotice: 0
  });
  
  // Form states
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [priority, setPriority] = useState<'none' | 'low' | 'medium' | 'high'>('none');
  const [expiryDate, setExpiryDate] = useState('');
  const [noExpiry, setNoExpiry] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentNoticeId, setCurrentNoticeId] = useState<string | null>(null);
  
  useEffect(() => {
    // Set default expiry date to 30 days from now
    const defaultExpiry = new Date();
    defaultExpiry.setDate(defaultExpiry.getDate() + 30);
    setExpiryDate(defaultExpiry.toISOString().split('T')[0]);
    
    fetchNotices();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  
  const fetchNotices = async () => {
    try {
      setLoading(true);
      const noticesQuery = query(collection(db, 'notices'), orderBy('created_at', 'desc'));
      const querySnapshot = await getDocs(noticesQuery);
      
      const fetchedNotices: Notice[] = [];
      querySnapshot.forEach((doc) => {
        fetchedNotices.push({
          id: doc.id,
          ...doc.data()
        } as Notice);
      });
      
      setNotices(fetchedNotices);
      calculateStats(fetchedNotices);
    } catch (err) {
      console.error('Error fetching notices:', err);
      setError('Failed to load notices');
    } finally {
      setLoading(false);
    }
  };
  
  const calculateStats = (notices: Notice[]) => {
    const currentDate = new Date();
    let totalLikes = 0;
    let mostLikedNotice: Notice | null = null;
    let highPriorityCount = 0;
    let activeNoticesCount = 0;
    
    // Calculate total likes and find most liked notice
    notices.forEach(notice => {
      const likesCount = notice.likes?.length || 0;
      totalLikes += likesCount;
      
      // Count high priority notices
      if (notice.priority === 'high') {
        highPriorityCount++;
      }
      
      // Count active notices (not expired)
      if (notice.expires_at && notice.expires_at.toDate() > currentDate) {
        activeNoticesCount++;
      }
      
      // Find most liked notice
      if (!mostLikedNotice || (likesCount > (mostLikedNotice.likes?.length || 0))) {
        if (likesCount > 0) {
          mostLikedNotice = notice;
        }
      }
    });
    
    // Calculate average likes per notice
    const averageLikes = notices.length > 0 ? totalLikes / notices.length : 0;
    
    setStats({
      totalNotices: notices.length,
      activeNotices: activeNoticesCount,
      totalLikes,
      highPriorityCount,
      mostLikedNotice,
      averageLikesPerNotice: parseFloat(averageLikes.toFixed(1))
    });
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title || !content || (!noExpiry && !expiryDate)) {
      setError('Please fill in all required fields');
      return;
    }
    
    try {
      setIsSubmitting(true);
      setError(null);
      
      // Use null for no expiration, otherwise convert the date to a timestamp
      const expiryTimestamp = noExpiry ? null : Timestamp.fromDate(new Date(expiryDate));
      
      if (editMode && currentNoticeId) {
        // Update existing notice
        const noticeRef = doc(db, 'notices', currentNoticeId);
        const noticeDoc = await getDoc(noticeRef);
        
        if (!noticeDoc.exists()) {
          throw new Error('Notice not found');
        }
        
        // Preserve likes array and created_at timestamp
        const existingData = noticeDoc.data();
        
        await updateDoc(noticeRef, {
          title,
          content,
          priority,
          expires_at: expiryTimestamp,
          // Keep the original created_at and likes
          created_at: existingData.created_at,
          likes: existingData.likes || []
        });
        
        setSuccess('Notice updated successfully!');
      } else {
        // Create new notice
        await addDoc(collection(db, 'notices'), {
          title,
          content,
          priority,
          created_at: Timestamp.now(),
          expires_at: expiryTimestamp,
          likes: [] // Initialize with empty likes array
        });
        
        setSuccess('Notice created successfully!');
      }
      
      // Reset form and state
      resetForm();
      
      // Refresh the notices list
      fetchNotices();
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccess(null);
      }, 3000);
      
    } catch (err) {
      console.error(`Error ${editMode ? 'updating' : 'creating'} notice:`, err);
      setError(`Failed to ${editMode ? 'update' : 'create'} notice`);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleEdit = async (notice: Notice) => {
    // Set form to edit mode and populate with notice data
    setEditMode(true);
    setCurrentNoticeId(notice.id);
    setTitle(notice.title);
    setContent(notice.content);
    setPriority(notice.priority);
    
    // Check if notice has an expiration date
    if (notice.expires_at) {
      setNoExpiry(false);
      // Format the expiry date for the date input
      if (notice.expires_at.toDate) {
        const expiryDate = notice.expires_at.toDate();
        setExpiryDate(expiryDate.toISOString().split('T')[0]);
      }
    } else {
      setNoExpiry(true);
    }
    
    // Show the form
    setShowForm(true);
    
    // Scroll to the form
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  
  const resetForm = () => {
    // Reset all form fields and state
    setTitle('');
    setContent('');
    setPriority('none');
    setNoExpiry(false);
    
    // Set default expiry date to 30 days from now
    const defaultExpiry = new Date();
    defaultExpiry.setDate(defaultExpiry.getDate() + 30);
    setExpiryDate(defaultExpiry.toISOString().split('T')[0]);
    
    setEditMode(false);
    setCurrentNoticeId(null);
    setShowForm(false);
  };
  
  const handleDelete = async (noticeId: string) => {
    if (!confirm('Are you sure you want to delete this notice?')) {
      return;
    }
    
    try {
      setLoading(true);
      await deleteDoc(doc(db, 'notices', noticeId));
      setSuccess('Notice deleted successfully!');
      // Refresh the notices list
      fetchNotices();
      
      // Clear success message after 3 seconds
      setTimeout(() => {
        setSuccess(null);
      }, 3000);
      
    } catch (err) {
      console.error('Error deleting notice:', err);
      setError('Failed to delete notice');
    } finally {
      setLoading(false);
    }
  };
  
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
  
  const formatDateNice = (timestamp: Timestamp) => {
    if (!timestamp || !timestamp.toDate) return 'Never expires';
    return format(timestamp.toDate(), 'MMM d, yyyy h:mm a');
  };
  
  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 style={STYLES.brandGreenText} className="text-2xl font-bold">Important Notices</h1>
        {!showForm && (
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            style={STYLES.brandGreenButton}
            className="py-2 px-4 rounded hover:opacity-90 transition-colors"
          >
            Create New Notice
          </button>
        )}
      </div>
      
      {/* Stats Cards */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 style={STYLES.brandGreenText} className="text-lg font-semibold mb-4">Notice Engagement Summary</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div style={STYLES.brandGreenBackground} className="p-4 rounded-lg">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg style={{ color: COLORS.brand.green.DEFAULT }} className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              </div>
              <div className="flex-1 text-center">
                <span style={STYLES.brandGreenText} className="text-sm font-medium">Total Notices</span>
                <div className="mt-1">
                  <p style={STYLES.brandGreenText} className="text-center text-2xl font-bold">{stats.totalNotices}</p>
                </div>
              </div>
            </div>
          </div>
          
          <div style={STYLES.brandYellowBackground} className="p-4 rounded-lg">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg style={{ color: COLORS.brand.yellow.DEFAULT }} className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10h4.764a2 2 0 011.789 2.894l-3.5 7A2 2 0 0115.263 21h-4.017c-.163 0-.326-.02-.485-.06L7 20m7-10V5a2 2 0 00-2-2h-.095c-.5 0-.905.405-.905.905 0 .714-.211 1.412-.608 2.006L7 11v9m7-10h-2M7 20H5a2 2 0 01-2-2v-6a2 2 0 012-2h2.5" />
                </svg>
              </div>
              <div className="flex-1 text-center">
                <span style={STYLES.brandYellowText} className="text-sm font-medium">Total Likes</span>
                <div className="mt-1">
                  <p style={STYLES.brandYellowText} className="text-center text-2xl font-bold">{stats.totalLikes}</p>
                </div>
              </div>
            </div>
          </div>
          
          <div style={STYLES.brandGreenBackground} className="p-4 rounded-lg">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg style={{ color: COLORS.brand.green.DEFAULT }} className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="flex-1 text-center">
                <span style={STYLES.brandGreenText} className="text-sm font-medium">High Priority</span>
                <div className="mt-1">
                  <p style={STYLES.brandGreenText} className="text-center text-2xl font-bold">{stats.highPriorityCount}</p>
                </div>
              </div>
            </div>
          </div>
          
          <div style={STYLES.brandYellowBackground} className="p-4 rounded-lg">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <svg style={{ color: COLORS.brand.yellow.DEFAULT }} className="h-5 w-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </div>
              <div className="flex-1 text-center">
                <span style={STYLES.brandYellowText} className="text-sm font-medium">Most Popular</span>
                <div className="mt-1">
                  {stats.mostLikedNotice ? (
                    <>
                      <p style={STYLES.brandYellowText} className="text-center text-base font-medium truncate" title={stats.mostLikedNotice.title}>
                        {stats.mostLikedNotice.title}
                      </p>
                      <p style={STYLES.brandYellowText} className="text-center text-xs text-gray-500 mt-1">
                        {stats.mostLikedNotice.likes?.length || 0} likes
                      </p>
                    </>
                  ) : (
                    <p style={STYLES.brandYellowText} className="text-center text-sm text-gray-500">No liked notices yet</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {success && (
        <div style={{ backgroundColor: COLORS.brand.green[100], color: COLORS.brand.green[800] }} className="p-3 rounded">
          {success}
        </div>
      )}
      
      {error && (
        <div className="p-3 bg-red-100 text-red-800 rounded">
          {error}
        </div>
      )}
      
      {showForm && (
        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold text-brand-green-700">
              {editMode ? 'Edit Notice' : 'Create New Notice'}
            </h2>
          </div>
          
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="mb-4">
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full p-2 border rounded focus:ring-brand-green focus:border-brand-green"
                required
              />
            </div>
            
            <div className="mb-4">
              <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-1">
                Content <span className="text-red-500">*</span>
              </label>
              <textarea
                id="content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="w-full p-2 border rounded h-32 focus:ring-brand-green focus:border-brand-green"
                required
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label htmlFor="priority" className="block text-sm font-medium text-gray-700 mb-1">
                  Priority
                </label>
                <select
                  id="priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as 'none' | 'low' | 'medium' | 'high')}
                  className="w-full p-2 border rounded focus:ring-brand-green focus:border-brand-green"
                >
                  <option value="none">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              
              <div>
                <label htmlFor="expiry" className="block text-sm font-medium text-gray-700 mb-1">
                  Expiry Date {!noExpiry && <span className="text-red-500">*</span>}
                </label>
                <div className="space-y-2">
                  <div className="flex items-center">
                    <input 
                      type="checkbox" 
                      id="noExpiry" 
                      checked={noExpiry} 
                      onChange={(e) => setNoExpiry(e.target.checked)}
                      className="h-4 w-4 text-brand-green border-gray-300 rounded focus:ring-brand-green"
                    />
                    <label htmlFor="noExpiry" className="ml-2 block text-sm text-gray-700">
                      No expiration (notice will remain active indefinitely)
                    </label>
                  </div>
                  {!noExpiry && (
                    <input
                      type="date"
                      id="expiry"
                      value={expiryDate}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={(e) => setExpiryDate(e.target.value)}
                      className="w-full p-2 border rounded focus:ring-brand-green focus:border-brand-green"
                      required={!noExpiry}
                    />
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-end space-x-4 border-t border-gray-200 pt-4 mt-6">
              <button
                type="button"
                onClick={resetForm}
                className="min-w-[100px] px-6 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-green-500 transition-colors"
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className={`min-w-[100px] px-6 py-2.5 text-sm font-medium text-white rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 transition-colors ${
                  editMode 
                    ? 'bg-brand-yellow hover:bg-brand-yellow-dark focus:ring-brand-yellow-500' 
                    : 'bg-brand-green hover:bg-brand-green-dark focus:ring-brand-green-500'
                } disabled:opacity-50`}
              >
                {isSubmitting 
                  ? (editMode ? 'Saving...' : 'Creating...') 
                  : (editMode ? 'Save' : 'Create')}
              </button>
            </div>
          </form>
        </div>
      )}
      
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div style={STYLES.brandGreenBackground} className="p-4 border-b border-gray-200">
          <h2 style={STYLES.brandGreenText} className="text-lg font-semibold">All Notices</h2>
        </div>
        
        {loading ? (
          <div className="p-4 text-center">
            <p>Loading notices...</p>
          </div>
        ) : notices.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            <p>No notices found. Create one to get started.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {notices.map((notice) => (
              <div key={notice.id} className="p-5 hover:bg-gray-50">
                <div className={`flex justify-between items-start mb-3 p-3 rounded-md ${getPriorityColor(notice.priority)}`}>
                  <div className="flex-1">
                    <div className="flex items-center">
                      <h3 className="text-lg font-medium">{notice.title}</h3>
                    </div>
                    <div className="mt-1 text-sm text-gray-500 flex items-center space-x-3">
                      <span>Created: {formatDateNice(notice.created_at)}</span>
                      <span>{notice.expires_at ? `Expires: ${formatDateNice(notice.expires_at)}` : 'Never expires'}</span>
                    </div>
                  </div>
                  <div className="flex space-x-3">
                    <button
                      onClick={() => handleEdit(notice)}
                      className="text-blue-600 hover:text-blue-800 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(notice.id)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <p className="text-gray-700 whitespace-pre-line pl-3">{notice.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
} 